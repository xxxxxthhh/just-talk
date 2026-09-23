# Public trial image: builds the web app in public mode and serves it from
# FastAPI on the same origin. Build from the repository root:
#   docker build -f deploy/public/Dockerfile -t just-talk-public .

FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_PUBLIC_MODE=1
RUN npm run build

FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    HOME=/tmp \
    PUBLIC_MODE=1 \
    PUBLIC_DATA_DIR=/app/data/public \
    STATIC_DIR=/app/static

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libasound2 \
        libssl3 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
# Test and lint tools are not needed at runtime.
RUN grep -vE '^(pytest|ruff)\b' requirements.txt > requirements.runtime.txt \
    && pip install --no-cache-dir -r requirements.runtime.txt

COPY backend/app ./app
COPY --from=frontend /src/frontend/dist ./static

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/data \
    && chown 10001:10001 /app/data

VOLUME ["/app/data"]
EXPOSE 8000
USER 10001:10001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

# One worker: per-visitor locks and the Azure concurrency limit are
# in-process. Usage caps are enforced in SQLite and would hold across
# processes, but keep a single worker anyway.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--limit-concurrency", "64", "--no-server-header"]
