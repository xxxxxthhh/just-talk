#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHONPATH=backend .venv/bin/python -m unittest discover backend/tests -v

cd frontend
npm test -- --run
npm run build
