#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  python3.11 -m venv .venv
  .venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -d "frontend/node_modules" ]; then
  cd frontend
  npm install
  cd "$ROOT_DIR"
fi

export PYTHONPATH="$ROOT_DIR/backend"

.venv/bin/uvicorn app.main:app --host "${BACKEND_HOST:-127.0.0.1}" --port 8000 --reload &
BACKEND_PID=$!

cleanup() {
  kill "$BACKEND_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd frontend
npm run dev
