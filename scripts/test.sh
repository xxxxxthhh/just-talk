#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

.venv/bin/ruff check backend
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests

cd frontend
npm run lint
npm test -- --run
npm run build
