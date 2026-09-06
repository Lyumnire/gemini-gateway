#!/usr/bin/env zsh
# 安装 Cookie 自动同步系统：
#   1) 生成/复用同步 Token 写入 .env
#   2) 把 Token 烘焙进扩展文件（extension-dist，不入 git）
#   3) 安装并启动 LaunchAgent（本机接收服务，127.0.0.1:8799）
set -euo pipefail
cd "$(dirname "$0")/.."

EXT_SRC="cookie-sync/extension"
EXT_DST="cookie-sync/extension-dist"
PLIST_NAME="com.geminigateway.cookie-sync"
PLIST_DST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
USER="${USER:-$(whoami)}"

# 1) Token：已有则复用，没有则生成
if grep -q '^COOKIE_SYNC_TOKEN=' .env 2>/dev/null; then
  TOKEN=$(grep '^COOKIE_SYNC_TOKEN=' .env | cut -d= -f2)
else
  TOKEN=$(openssl rand -hex 16)
  printf '\n# ===== Cookie 自动同步 =====\nCOOKIE_SYNC_TOKEN=%s\n' "$TOKEN" >> .env
fi
chmod 600 .env

# 2) 烘焙扩展（Token 写入 background.js）
rm -rf "$EXT_DST"
cp -R "$EXT_SRC" "$EXT_DST"
sed -i '' "s|__TOKEN__|${TOKEN}|" "$EXT_DST/background.js"
echo "✓ 扩展已生成: $PWD/$EXT_DST"

# 2b) 生成手动推送页本地副本（源模板含 __TOKEN__ 占位符，入库的永远是模板）
sed "s|__TOKEN__|${TOKEN}|g" cookie-sync/cookie-sync.html > cookie-sync/cookie-sync-local.html
echo "✓ 手动推送页已生成: $PWD/cookie-sync/cookie-sync-local.html"

# 3) LaunchAgent
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST_DST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>${PWD}/cookie-sync/receiver.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>COOKIE_SYNC_TOKEN</key><string>${TOKEN}</string>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/gemini-gateway-cookie-sync.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/gemini-gateway-cookie-sync.err.log</string>
</dict>
</plist>
EOF
launchctl unload "$PLIST_DST" >/dev/null 2>&1 || true
launchctl load "$PLIST_DST"
sleep 2
if curl -s -m 3 http://127.0.0.1:8799/health | grep -q '"ok"'; then
  echo "✓ 接收服务已运行: http://127.0.0.1:8799/health"
else
  echo "✗ 接收服务未响应，查看日志: ~/Library/Logs/gemini-gateway-cookie-sync.err.log" >&2
  exit 1
fi

cat <<'EOF'

后续步骤（把扩展装进浏览器，一次性）：
  1. 打开 Chrome/Edge，地址栏输入 chrome://extensions（Edge: edge://extensions）
  2. 打开右上角「开发者模式」
  3. 点「加载已解压的扩展程序」，选择目录:
     ~/Projects/gemini-gateway/cookie-sync/extension-dist
  4. 打开 https://gemini.google.com —— Cookie 会自动推送到网关

EOF
