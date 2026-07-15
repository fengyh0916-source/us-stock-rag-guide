#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r backend/requirements.txt

if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm install)
fi

if [[ ! -d backend/quote-bridge/node_modules ]]; then
  (cd backend/quote-bridge && npm install)
fi

cleanup() {
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

(cd frontend && npm run dev -- --host 127.0.0.1 --port 5173) &
FRONTEND_PID=$!

echo ""
echo "后端: http://127.0.0.1:8000  (文档 /docs)"
echo "前端: http://127.0.0.1:5173"
echo "按 Ctrl+C 停止"
wait
