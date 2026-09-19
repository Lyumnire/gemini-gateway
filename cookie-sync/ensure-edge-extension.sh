#!/bin/zsh
# Cookie 保活看门狗（launchd 每 10 分钟调用）
#
# 分层设计：
#   第一层  扩展自身：chrome.alarms 每 3 分钟推送（SW 挂起也会被 alarm 唤醒），
#           cookie 变化/页面加载时即时推送 —— 健康状态下无需任何外部干预
#   第二层  本脚本：检查"后端缓存文件"的新鲜度，仅在推送停滞时唤醒扩展
#
# 新鲜度信号 = data/cookies/.last-push（receiver 每收到一次推送就刷新，
# 无论 PSIDTS 值是否变化）——它代表"推送链路存活"。
# 注意不能用缓存文件 mtime：Google 不轮换 PSIDTS 时值不变、文件不动，
# 但链路是健康的。.env 更不能作为信号（只在长效 1PSID 变化时才写）。
#
# 行为：
#   心跳 < 10 分钟   → 静默退出，Edge 完全无感（健康态永远走这里）
#   心跳 ≥ 10 分钟   → 推送链路已死（扩展 SW 挂了/Edge 未运行/receiver 不可达）：
#                      启动 Edge（若未运行）→ 开一次 Gemini 标签唤醒推送 → 关标签
# 最坏恢复时间 = 阈值 600s + 轮询间隔 600s = 20 分钟（PSIDTS 有效期数小时，安全）

EDGE_APP="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
EXT_PATH="$HOME/Projects/gemini-gateway/cookie-sync/extension-dist"
CACHE_DIR="$HOME/Projects/gemini-gateway/data/cookies"
STALE_SECS=600

# 新鲜度检查（纯 shell，launchd 环境无 python 依赖）
SIGNAL="$CACHE_DIR/.last-push"
if [ ! -f "$SIGNAL" ]; then
  # 兼容旧 receiver（尚无心跳文件）：退回缓存文件 mtime
  SIGNAL=$(ls -t "$CACHE_DIR"/*.txt 2>/dev/null | head -1)
fi
if [ -n "$SIGNAL" ] && [ -f "$SIGNAL" ]; then
  AGE=$(( $(date +%s) - $(stat -f %m "$SIGNAL") ))
else
  AGE=999999
fi

if [ "$AGE" -lt "$STALE_SECS" ]; then
  # 健康态：静默退出，不打扰用户
  exit 0
fi

echo "$(date): cookie cache stale (${AGE}s >= ${STALE_SECS}s), waking extension..."

# Edge 未运行则先启动（带扩展）
if ! pgrep -f "Microsoft Edge" > /dev/null 2>&1; then
  echo "$(date): Starting Edge with extension..."
  nohup "$EDGE_APP" --load-extension="$EXT_PATH" > /dev/null 2>&1 &
  sleep 10
fi

# 开新标签触发扩展推送，等推送完成后关闭（不刷新已有页面）
osascript -e 'tell application "Microsoft Edge" to tell front window to make new tab with properties {URL:"https://gemini.google.com"}' 2>/dev/null
sleep 8
osascript -e '
tell application "Microsoft Edge"
  if (count of tabs of front window) > 1 then
    close active tab of front window
  end if
end tell' 2>/dev/null

# 复核：唤醒后心跳应更新
sleep 2
if [ -f "$CACHE_DIR/.last-push" ]; then
  AGE2=$(( $(date +%s) - $(stat -f %m "$CACHE_DIR/.last-push") ))
  echo "$(date): Wake-up done, heartbeat age now ${AGE2}s"
else
  echo "$(date): Wake-up done, but no heartbeat file found"
fi
