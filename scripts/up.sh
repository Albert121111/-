#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules || ! -d backend/node_modules || ! -d frontend/node_modules ]]; then
  echo "[up] Installing dependencies..."
  npm install
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[up] Created .env from .env.example. Fill MAPILLARY_TOKEN and VITE_MAPILLARY_TOKEN."
fi

echo "[up] Running DB migrations..."
npm run migrate --workspace backend

echo "[up] Starting backend and frontend..."
cleanup() {
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev --workspace backend &
BACKEND_PID=$!
npm run dev --workspace frontend &
FRONTEND_PID=$!

wait "$BACKEND_PID" "$FRONTEND_PID"
