#!/usr/bin/env bash
# 本地一键启动：Next(3000) + Agent(8001) + Asset API(8000)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/.run"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令: $1" >&2
    exit 1
  }
}

need_cmd node
need_cmd npm

if [[ ! -f "$ROOT/.env.local" && ! -f "$ROOT/.env" ]]; then
  echo "提示: 未找到 .env.local，可复制 .env.example 并填写 AUTH_SECRET / DEEPSEEK 等"
fi

# 校验 AUTH_SECRET
if ! grep -qE '^AUTH_SECRET=.+' "$ROOT/.env.local" 2>/dev/null && ! grep -qE '^AUTH_SECRET=.+' "$ROOT/.env" 2>/dev/null; then
  echo "警告: 未配置 AUTH_SECRET。生产环境必须设置（openssl rand -hex 32）"
fi

start_bg() {
  local name="$1"
  local logfile="$ROOT/.run/${name}.log"
  shift
  echo "启动 $name → $logfile"
  nohup "$@" >"$logfile" 2>&1 &
  echo $! >"$ROOT/.run/${name}.pid"
}

# Asset tracker API
if [[ -x "$ROOT/asset-tracker/.venv/bin/python" ]]; then
  start_bg asset-api \
    env AUTH_SECRET="${AUTH_SECRET:-}" \
    "$ROOT/asset-tracker/.venv/bin/python" -m uvicorn app.main:app \
    --app-dir "$ROOT/asset-tracker/backend" --host 127.0.0.1 --port 8000
else
  echo "跳过 asset-api：请先 npm run asset-tracker:install"
fi

# Agent
if [[ -x "$ROOT/agent/.venv/bin/python" && -x "$ROOT/agent/start.sh" ]]; then
  start_bg agent bash -lc "cd '$ROOT/agent' && ./start.sh"
else
  echo "跳过 agent：请先 npm run agent:install"
fi

# Next.js
start_bg web npm run dev

sleep 2
echo ""
echo "==== 服务已在后台启动 ===="
echo "  网站:     http://127.0.0.1:3000"
echo "  健康检查: http://127.0.0.1:3000/api/health"
echo "  日志目录: $ROOT/.run/"
echo "  停止:     $ROOT/scripts/stop-all.sh"
echo ""
