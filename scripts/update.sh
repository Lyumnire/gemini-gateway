#!/usr/bin/env zsh
# 更新全套服务：后端源码 → 重建镜像 → 前端 → 滚动重启
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/4 更新后端上游源码 =="
git -C backend/src pull --ff-only

echo "== 2/4 重新构建后端镜像 =="
docker compose build gemini-api

echo "== 3/4 重建前端（仅在依赖或源码有变化时需要）=="
if [ -d frontend ]; then
  (cd frontend && npm install --no-fund --no-audit && npm run build)
fi

echo "== 4/4 滚动重启服务 =="
docker compose up -d

echo "完成。当前隧道地址：$(./scripts/url.sh 2>/dev/null || echo '见 docker compose logs cloudflared')"
