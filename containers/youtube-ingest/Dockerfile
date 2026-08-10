# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# TeachInspire — YouTube ingest sidecar for the Transcription Studio.
#
# Two endpoints (see app/main.py and worker/lib/transcription-youtube.ts):
#   GET  /health   -> { ok, ytdlp }
#   POST /extract  -> bestaudio -> 16 kHz mono Opus, streamed back to the Worker
#
# NOT a general-purpose downloader. Reachable only with the Bearer
# INGEST_SHARED_SECRET the Worker was configured with, and it only ever
# contacts YouTube.
# ---------------------------------------------------------------------------

FROM python:3.13-slim-bookworm

# ffmpeg is the only system dependency: yt-dlp shells out to it for the
# downmix/transcode. --no-install-recommends keeps the image small, which
# matters because a scale-to-zero machine pays the size on every cold start.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# PIN THE EXACT VERSION. YouTube changes its signature/manifest logic roughly
# monthly and yt-dlp ships fixes within days — but an UNPINNED install means a
# rebuild changes behaviour with no commit. Bump this line deliberately, about
# once a month, as its own reviewed change; /health reports the running version
# so a stale image is visible from outside.
ARG YTDLP_VERSION=2026.8.8
RUN pip install --no-cache-dir \
      "yt-dlp==${YTDLP_VERSION}" \
      "fastapi==0.120.4" \
      "uvicorn[standard]==0.40.0"
ENV YTDLP_VERSION=${YTDLP_VERSION}

# Non-root, and a writable scratch dir wiped after every request. Nothing here
# is ever persisted: the audio's only durable home is R2, written by the Worker.
RUN useradd --create-home --shell /usr/sbin/nologin ingest \
 && mkdir -p /scratch \
 && chown ingest:ingest /scratch
ENV TMPDIR=/scratch \
    HOME=/home/ingest \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY --chown=ingest:ingest app/ /app/
USER ingest

EXPOSE 8080

# One worker on purpose: /extract already serialises through a lock because two
# concurrent ffmpeg runs on a small machine make both miss the Worker's
# deadline. Concurrency is the platform's job (more machines), not this
# process's. --timeout-keep-alive is short: the Worker makes one request and leaves.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--workers", "1", \
     "--timeout-keep-alive", "5"]
