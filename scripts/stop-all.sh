#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.run"

if [[ ! -d "$RUN" ]]; then
  echo "没有运行记录"
  exit 0
fi

for f in "$RUN"/*.pid; do
  [[ -f "$f" ]] || continue
  name="$(basename "$f" .pid)"
  pid="$(cat "$f" 2>/dev/null || true)"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
    echo "停止 $name (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$f"
done

echo "完成"
