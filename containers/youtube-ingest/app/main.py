# TeachInspire — YouTube ingest sidecar for the Transcription Studio.
#
# ASYNC BY DESIGN, and that is load-bearing. The first version answered
# POST /extract with the audio itself, which meant minutes of a silent HTTP
# response while yt-dlp worked — and Fly's edge kills a connection that moves
# no bytes for ~60 s, then auto-stops the "idle" machine MID-DOWNLOAD
# (measured on activation day: a 42 MiB extraction died at 85% with
# `Operation timed out (os error 110)`). So:
#
#   POST /extract            -> 202 { taskId } immediately
#   GET  /extract/{taskId}   -> { status: working | ready | failed, ... }
#   GET  /extract/{taskId}/file -> the 16 kHz mono Opus, then cleanup
#
# The Worker polls every few seconds; each poll is a real request, which also
# keeps the scale-to-zero machine alive for exactly as long as the work needs.
#
# NOT a general-purpose downloader. Bearer INGEST_SHARED_SECRET on every
# endpoint; only YouTube hosts; one video per call. Files live in /scratch
# under the task id and die when served, when failed, or after TTL.
#
# Failure vocabulary (the Worker maps `status_code` with failureForStatus):
#   404 -> the VIDEO cannot be served: private, deleted, geo-blocked, age-gated
#   403 -> YouTube refused US: bot check — retryable upstream
#   413 -> over maxDurationSeconds, decided from METADATA before any download;
#          payload carries durationSeconds
#   422 -> not a single video (playlist, channel, non-YouTube URL)
#   502 -> anything else; retryable upstream

import base64
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from importlib.metadata import version as pkg_version

import yt_dlp
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

SECRET = os.environ.get("INGEST_SHARED_SECRET", "")

# One extraction at a time: ffmpeg is CPU-bound and two concurrent transcodes
# on a small machine make both miss their deadline. Queued tasks simply stay
# "working" a little longer — the Worker's poll budget absorbs that.
EXTRACT_LOCK = threading.Lock()

# A task older than this is garbage whatever its state: the Worker gives up at
# 9 minutes, so nothing legitimate ever comes back for a 15-minute-old file.
TASK_TTL_SECONDS = 15 * 60

YOUTUBE_HOSTS = (
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
)

# taskId -> {status, created, workdir, path?, duration?, title?, bytes?,
#            status_code?, code?}   Guarded by TASKS_LOCK; plain dict state is
# fine because this is ONE process on ONE machine — a restart loses tasks, the
# Worker's poll then sees 404 and retries the whole job, which is correct.
TASKS: dict = {}
TASKS_LOCK = threading.Lock()


class ExtractRequest(BaseModel):
    url: str = Field(min_length=10, max_length=2048)
    maxDurationSeconds: int = Field(gt=0, le=24 * 3600)


def require_auth(request: Request) -> None:
    header = request.headers.get("authorization", "")
    if not SECRET or header != f"Bearer {SECRET}":
        raise HTTPException(status_code=401)


def is_youtube_url(url: str) -> bool:
    m = re.match(r"^https?://([^/]+)/", url)
    return bool(m) and m.group(1).lower() in YOUTUBE_HOSTS


def classify_download_error(message: str) -> int:
    """Map yt-dlp's prose to the contract. Unrecognised -> 502 (retryable)."""
    lowered = message.lower()
    if any(
        marker in lowered
        for marker in (
            "sign in to confirm",
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


def sweep_stale_tasks() -> None:
    """Lazy GC, run on every POST: nothing here deserves a scheduler."""
    horizon = time.time() - TASK_TTL_SECONDS
    with TASKS_LOCK:
        stale = [tid for tid, t in TASKS.items() if t["created"] < horizon]
        for tid in stale:
            task = TASKS.pop(tid)
            shutil.rmtree(task["workdir"], ignore_errors=True)


def run_extract(task_id: str, url: str, max_duration_seconds: int) -> None:
    """The worker thread. Every exit path leaves the task terminal."""
    with TASKS_LOCK:
        task = TASKS.get(task_id)
    if task is None:
        return
    workdir = task["workdir"]

    def fail(status_code: int, code: str, **extra) -> None:
        shutil.rmtree(workdir, ignore_errors=True)
        with TASKS_LOCK:
            if task_id in TASKS:
                TASKS[task_id].update(status="failed", status_code=status_code, code=code, **extra)

    common = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 2,
        "paths": {"home": workdir, "temp": workdir},
        # Datacenter IPs get bot-checked on the default web client; the
        # mobile/TV clients are tried first. The residential proxy below is
        # what actually makes extraction reliable — see README.
        "extractor_args": {"youtube": {"player_client": ["tv", "ios", "android", "web"]}},
    }
    proxy = os.environ.get("YTDLP_PROXY", "").strip()
    if proxy:
        common["proxy"] = proxy

    with EXTRACT_LOCK:
        # Metadata first: an over-cap video costs one probe, never a download.
        try:
            with yt_dlp.YoutubeDL({**common, "skip_download": True}) as probe:
                info = probe.extract_info(url, download=False)
        except yt_dlp.utils.DownloadError as error:
            return fail(classify_download_error(str(error)), "download_error")
        except Exception:
            return fail(502, "probe_error")

        if info is None or info.get("_type") in ("playlist", "multi_video"):
            return fail(422, "unsupported_source")
        duration = info.get("duration")
        if duration is None:
            return fail(404, "no_duration")
        if duration > max_duration_seconds:
            return fail(413, "source_too_long", durationSeconds=int(duration))

        outtmpl = os.path.join(workdir, "audio.%(ext)s")
        download_opts = {
            **common,
            "format": "bestaudio/best",
            "outtmpl": outtmpl,
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "opus"}],
            "postprocessor_args": {"extractaudio": ["-ar", "16000", "-ac", "1", "-b:a", "32k"]},
        }
        try:
            with yt_dlp.YoutubeDL(download_opts) as downloader:
                downloader.extract_info(url, download=True)
        except yt_dlp.utils.DownloadError as error:
            return fail(classify_download_error(str(error)), "download_error")
        except Exception:
            return fail(502, "extract_error")

    audio_path = os.path.join(workdir, "audio.opus")
    if not os.path.exists(audio_path):
        candidates = [f for f in os.listdir(workdir) if f.startswith("audio.")]
        if not candidates:
            return fail(502, "no_output")
        audio_path = os.path.join(workdir, candidates[0])

    with TASKS_LOCK:
        if task_id in TASKS:
            TASKS[task_id].update(
                status="ready",
                path=audio_path,
                duration=int(duration),
                bytes=os.path.getsize(audio_path),
                title=str(info.get("title") or ""),
            )


@app.get("/health")
def health(request: Request):
    require_auth(request)
    return {
        "ok": True,
        "ytdlp": pkg_version("yt-dlp"),
        # Boolean only — the URL carries credentials.
        "proxy": bool(os.environ.get("YTDLP_PROXY", "").strip()),
    }


@app.get("/proxy-check")
def proxy_check(request: Request):
    """Diagnose the proxy IN ISOLATION from YouTube — parsed shape (never the
    password) plus one request through it to an IP echo. The first thing to
    run when extraction fails: a 407 from the proxy and a 403 from YouTube
    otherwise both surface as one opaque download_error."""
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
        "username": parts.username,
        "password_length": len(password),
        "password_has_shell_risky_chars": any(c in password for c in "$'\"`\\ "),
        "raw_length": len(raw),
        "raw_has_whitespace": any(c.isspace() for c in raw),
    }

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
    except Exception as error:
        return {**shape, "proxy_ok": False, "detail": str(error)[:300]}


@app.post("/extract")
def extract(request: Request, body: ExtractRequest):
    require_auth(request)
    sweep_stale_tasks()

    if not is_youtube_url(body.url):
        return JSONResponse({"code": "unsupported_source"}, status_code=422)

    task_id = uuid.uuid4().hex
    workdir = tempfile.mkdtemp(dir=os.environ.get("TMPDIR", "/scratch"))
    with TASKS_LOCK:
        TASKS[task_id] = {"status": "working", "created": time.time(), "workdir": workdir}

    threading.Thread(
        target=run_extract, args=(task_id, body.url, body.maxDurationSeconds), daemon=True
    ).start()
    return JSONResponse({"taskId": task_id}, status_code=202)


@app.get("/extract/{task_id}")
def extract_status(request: Request, task_id: str):
    require_auth(request)
    with TASKS_LOCK:
        task = TASKS.get(task_id)
        if task is None:
            # Unknown = this machine restarted (or TTL). The Worker retries the
            # whole job, which is the only honest recovery.
            return JSONResponse({"status": "unknown"}, status_code=404)
        if task["status"] == "failed":
            payload = {"status": "failed", "status_code": task["status_code"], "code": task["code"]}
            if "durationSeconds" in task:
                payload["durationSeconds"] = task["durationSeconds"]
            return payload
        if task["status"] == "ready":
            return {
                "status": "ready",
                "durationSeconds": task["duration"],
                "bytes": task["bytes"],
            }
        return {"status": "working"}


@app.get("/extract/{task_id}/file")
def extract_file(request: Request, task_id: str):
    require_auth(request)
    with TASKS_LOCK:
        task = TASKS.get(task_id)
        if task is None or task["status"] != "ready":
            return JSONResponse({"status": "not_ready"}, status_code=404)
        # Claim it: the file is served exactly once, then the task dies.
        TASKS.pop(task_id)

    def cleanup() -> None:
        shutil.rmtree(task["workdir"], ignore_errors=True)

    return FileResponse(
        task["path"],
        media_type="audio/ogg",
        background=BackgroundTask(cleanup),
        headers={
            "X-Duration-Seconds": str(task["duration"]),
            # UTF-8 titles cannot ride raw in a latin-1 header; base64 can.
            "X-Title-B64": base64.b64encode(task["title"].encode("utf-8")).decode("ascii"),
        },
    )
