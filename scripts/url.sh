#!/usr/bin/env zsh
# 打印当前 Cloudflare 临时隧道地址
set -uo pipefail
cd "$(dirname "$0")/.."

url=$(docker compose logs cloudflared 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
if [ -n "$url" ]; then
  echo "$url"
else
  echo "尚未建立隧道。运行: docker compose up -d cloudflared && docker compose logs -f cloudflared" >&2
  exit 1
fi
