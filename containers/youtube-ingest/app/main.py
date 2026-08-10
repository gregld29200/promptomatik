# TeachInspire — YouTube ingest sidecar for the Transcription Studio.
#
# Exactly two endpoints, and NOT a general-purpose downloader:
#   GET  /health   -> { ok, ytdlp }        (readiness + stale-version alerting)
#   POST /extract  -> 16 kHz mono Opus     (metadata first, cap enforced, then audio)
#
# The Worker (worker/lib/transcription-youtube.ts) is the only intended caller.
# Every request must carry `Authorization: Bearer <INGEST_SHARED_SECRET>`; a
# missing or wrong token is a bare 401. The service is stateless: each request
# works in its own temp directory, deleted when the response finishes, success
# or failure. The audio's only durable home is R2, written by the Worker.
#
# Error contract (the Worker's failureForStatus mirrors this table):
#   404 -> the VIDEO cannot be served: private, deleted, geo-blocked, age-gated
#   403 -> YouTube refused US: bot check, datacenter IP ("sign in to confirm")
#   413 -> over maxDurationSeconds, known from METADATA before any download;
#          body carries { code: "source_too_long", durationSeconds }
#   422 -> not a single video (playlist, channel, non-YouTube URL)
#   5xx -> anything else; the Worker treats it as retryable

import asyncio
import base64
import os
import re
import shutil
import tempfile
from importlib.metadata import version as pkg_version

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

SECRET = os.environ.get("INGEST_SHARED_SECRET", "")

# One extraction at a time, on purpose. ffmpeg transcodes CPU-bound; two
# concurrent runs on a small machine make both miss the Worker's deadline.
# Concurrency is the platform's job (more machines), not this process's.
EXTRACT_LOCK = asyncio.Lock()

# Hard wall-clock ceiling for one extraction. The Worker aborts at 9 minutes;
# dying slightly later here keeps orphaned work from running forever.
EXTRACT_TIMEOUT_SECONDS = 9.5 * 60

YOUTUBE_HOSTS = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
)


class ExtractRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)
    maxDurationSeconds: int = Field(gt=0, le=24 * 3600)


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    if not SECRET or header != f"Bearer {SECRET}":
        # No body: nothing to learn from a rejected probe.
        raise HTTPException(status_code=401)


def is_youtube_url(url: str) -> bool:
    m = re.match(r"^https?://([^/]+)/", url)
    return bool(m) and m.group(1).lower() in YOUTUBE_HOSTS


def classify_download_error(message: str) -> int:
    """Map yt-dlp's prose to the error contract. The strings are yt-dlp's own
    and stable across releases; anything unrecognised is 502 (retryable)."""
    lowered = message.lower()
    if any(
        marker in lowered
        for marker in (
            "sign in to confirm",  # the datacenter-IP bot check — §5.1
            "confirm you're not a bot",
            "http error 429",
            "http error 403",
        )
    ):
        return 403
    if any(
        marker in lowered
        for marker in (
            "video unavailable",
            "private video",
            "has been removed",
            "not available in your country",
            "age-restricted",
            "age restricted",
            "members-only",
            "premieres in",
            "this live event",
        )
    ):
        return 404
    return 502


@app.get("/health")
def health(request: Request):
    require_auth(request)
    return {
        "ok": True,
        "ytdlp": pkg_version("yt-dlp"),
        # Boolean only — never the proxy URL, which carries credentials.
        "proxy": bool(os.environ.get("YTDLP_PROXY", "").strip()),
    }


@app.get("/proxy-check")
def proxy_check(request: Request):
    """Diagnose the proxy IN ISOLATION from YouTube.

    Added because a `407` from the proxy and a `403` from YouTube both surface
    as one opaque `download_error`, and guessing between them wasted a round
    trip. This reports the PARSED SHAPE of YTDLP_PROXY (so a mangled URL, a
    stray character or a wrong port is visible) and then makes one trivial
    request through it to an IP echo, returning the proxy's own verdict.

    The password is never returned — only its length and whether it contains
    characters a shell may have eaten.
    """
    require_auth(request)

    raw = os.environ.get("YTDLP_PROXY", "").strip()
    if not raw:
        return {"configured": False}

    from urllib.parse import urlsplit

    parts = urlsplit(raw)
    password = parts.password or ""
    shape = {
        "configured": True,
        "scheme": parts.scheme,
        "host": parts.hostname,
        "port": parts.port,
        # The username is not a secret and its exact form is the usual culprit
        # (DataImpulse appends targeting like `__cr.fr` to it).
        "username": parts.username,
        "password_length": len(password),
        "password_has_shell_risky_chars": any(c in password for c in "$'\"`\\ "),
        "raw_length": len(raw),
        "raw_has_whitespace": any(c.isspace() for c in raw),
    }

    # One request through the proxy, to something that just echoes the IP.
    import urllib.error
    import urllib.request

    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": raw, "https": raw})
    )
    try:
        with opener.open("https://api.ipify.org?format=json", timeout=25) as response:
            body = response.read(200).decode("utf-8", "replace")
        return {**shape, "proxy_ok": True, "exit_ip": body}
    except urllib.error.HTTPError as error:
        return {**shape, "proxy_ok": False, "http_status": error.code, "detail": str(error)[:300]}
    except Exception as error:  # URLError wraps the 407 tunnel refusal
        return {**shape, "proxy_ok": False, "detail": str(error)[:300]}


@app.post("/extract")
async def extract(request: Request, body: ExtractRequest):
    require_auth(request)

    if not is_youtube_url(body.url):
        return JSONResponse({"code": "unsupported_source"}, status_code=422)

    async with EXTRACT_LOCK:
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(run_extract, body.url, body.maxDurationSeconds),
                timeout=EXTRACT_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            return JSONResponse({"code": "timeout"}, status_code=502)


def run_extract(url: str, max_duration_seconds: int):
    workdir = tempfile.mkdtemp(dir=os.environ.get("TMPDIR", "/scratch"))
    cleanup = BackgroundTask(shutil.rmtree, workdir, ignore_errors=True)

    def fail(status: int, payload: dict):
        # The response never starts, so nothing keeps the directory alive.
        shutil.rmtree(workdir, ignore_errors=True)
        return JSONResponse(payload, status_code=status)

    common = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,  # one URL, one video — playlists are the caller's 422
        "socket_timeout": 30,
        "retries": 2,
        "paths": {"home": workdir, "temp": workdir},
        # From a datacenter IP, YouTube bot-checks the default `web` client
        # ("Sign in to confirm you're not a bot"). The mobile/TV clients use a
        # different, less-guarded API surface and often extract where `web`
        # will not. The list is tried in order; each is a separate attempt.
        "extractor_args": {
            "youtube": {"player_client": ["tv", "ios", "android", "web"]}
        },
    }

    # The real fix for the datacenter bot-check: route through a RESIDENTIAL
    # proxy YouTube does not flag. Set YTDLP_PROXY as a Fly secret to a
    # `http://user:pass@host:port` (or socks5://) URL from a residential proxy
    # provider. Absent, we still try direct — which works for some videos and
    # fails with the honest youtube_blocked for the rest.
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    if proxy:
        common["proxy"] = proxy

    # ---- Step 1: metadata only. Duration is checked BEFORE a single audio
    # byte is fetched, so a 4-hour stream costs one metadata call.
    try:
        with yt_dlp.YoutubeDL({**common, "skip_download": True}) as probe:
            info = probe.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as error:
        return fail(classify_download_error(str(error)), {"code": "download_error"})
    except Exception:
        return fail(502, {"code": "probe_error"})

    if info is None or info.get("_type") in ("playlist", "multi_video"):
        return fail(422, {"code": "unsupported_source"})

    duration = info.get("duration")
    if duration is None:
        # A live stream or premiere reports no duration; refusing beats
        # downloading something unbounded.
        return fail(404, {"code": "no_duration"})
    if duration > max_duration_seconds:
        return fail(413, {"code": "source_too_long", "durationSeconds": int(duration)})

    # ---- Step 2: bestaudio, downmixed to what the providers actually bill
    # once: 16 kHz mono Opus at 32 kbps (~13 MB/hour — a 90-minute cap sits
    # inside both our 64 MB ceiling and Groq's free-tier 25 MB).
    outtmpl = os.path.join(workdir, "audio.%(ext)s")
    download_opts = {
        **common,
        "format": "bestaudio/best",
        "outtmpl": outtmpl,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "opus"}
        ],
        "postprocessor_args": {"extractaudio": ["-ar", "16000", "-ac", "1", "-b:a", "32k"]},
    }
    try:
        with yt_dlp.YoutubeDL(download_opts) as downloader:
            downloader.extract_info(url, download=True)
    except yt_dlp.utils.DownloadError as error:
        return fail(classify_download_error(str(error)), {"code": "download_error"})
    except Exception:
        return fail(502, {"code": "extract_error"})

    audio_path = os.path.join(workdir, "audio.opus")
    if not os.path.exists(audio_path):
        # yt-dlp names the file after the postprocessor codec; anything else
        # in the directory means the pipeline changed under us.
        candidates = [f for f in os.listdir(workdir) if f.startswith("audio.")]
        if not candidates:
            return fail(502, {"code": "no_output"})
        audio_path = os.path.join(workdir, candidates[0])

    title = str(info.get("title") or "")
    return FileResponse(
        audio_path,
        media_type="audio/ogg",
        background=cleanup,  # the temp dir outlives the streamed response, then dies
        headers={
            "X-Duration-Seconds": str(int(duration)),
            # UTF-8 titles cannot ride raw in a latin-1 header; base64 can.
            "X-Title-B64": base64.b64encode(title.encode("utf-8")).decode("ascii"),
        },
    )
