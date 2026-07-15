#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install -r backend/requirements.txt
else
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

if [ ! -f data/index/chunks.json ]; then
  (cd backend && python scripts/ingest.py)
fi

if [ ! -f .env ]; then
  echo "⚠️  未找到 .env，请先：cp .env.example .env 并填写 DEEPSEEK_API_KEY"
fi

# 若项目根目录有 .env，读取 PORT（避免和其它项目抢 8000）
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
PORT="${PORT:-8001}"
echo "🚀 启动美股投资扫盲助手：http://127.0.0.1:${PORT}"
cd backend
# Use python -m uvicorn so relocated venvs still work
exec ../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --reload
