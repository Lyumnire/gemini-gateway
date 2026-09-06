#!/bin/zsh
# 确保 receiver 始终运行
# Token 从项目根目录 .env 读取（绝不允许硬编码进任何脚本）
if ! curl -s -m3 http://127.0.0.1:8799/health 2>/dev/null | grep -q "ok"; then
  echo "$(date): Receiver not running, starting..."
  pkill -9 -f "receiver.py" 2>/dev/null
  sleep 1
  PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
  cd "$PROJECT_DIR"
  if [ ! -f .env ]; then
    echo "$(date): ERROR: .env not found in $PROJECT_DIR — cannot read COOKIE_SYNC_TOKEN"
    exit 1
  fi
  COOKIE_SYNC_TOKEN="$(grep '^COOKIE_SYNC_TOKEN=' .env | cut -d= -f2)" \
    nohup python3 cookie-sync/receiver.py > /tmp/cookie-receiver.log 2>&1 &
  sleep 2
  echo "$(date): Receiver started"
else
  echo "$(date): Receiver OK"
fi
