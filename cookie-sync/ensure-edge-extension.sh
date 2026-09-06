#!/bin/zsh
# 确保 Edge 带扩展运行，且 cookie 定期推送
# 不刷新已有页面，用新标签触发扩展后关闭

EDGE_APP="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
EXT_PATH="$HOME/Projects/gemini-gateway/cookie-sync/extension-dist"
ENV_FILE="$HOME/Projects/gemini-gateway/.env"

# 检查 .env 年龄
ENV_AGE=$(python3 -c "
import os, time
print(int(time.time() - os.path.getmtime('$ENV_FILE')))
" 2>/dev/null || echo "9999")

# 确保 Edge 运行
if ! pgrep -f "Microsoft Edge" > /dev/null 2>&1; then
  echo "$(date): Starting Edge with extension..."
  nohup "$EDGE_APP" --load-extension="$EXT_PATH" > /dev/null 2>&1 &
  sleep 10
fi

# 每次都触发扩展推送（不管 .env 年龄）
# 用新标签打开 Gemini，等扩展推送，然后关闭标签
echo "$(date): Triggering extension push (env age: ${ENV_AGE}s)..."
osascript -e 'tell application "Microsoft Edge" to tell front window to make new tab with properties {URL:"https://gemini.google.com"}' 2>/dev/null
sleep 8
osascript -e '
tell application "Microsoft Edge"
  if (count of tabs of front window) > 1 then
    close active tab of front window
  end if
end tell' 2>/dev/null
echo "$(date): Done"
