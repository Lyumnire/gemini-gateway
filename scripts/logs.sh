#!/usr/bin/env zsh
# 跟踪查看全部服务日志
cd "$(dirname "$0")/.."
exec docker compose logs -f --tail=100 "$@"
