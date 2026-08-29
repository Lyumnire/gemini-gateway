#!/usr/bin/env zsh
# 预先 vendor Go 依赖到 backend/src/vendor/，使后端镜像构建完全离线。
# 背景：构建容器内 DNS 被污染且链路抖动，go mod download 不可靠；
# 在宿主机侧（--network=host + Clash 代理）一次性拉好依赖。
set -uo pipefail
cd "$(dirname "$0")/.."

PROXY_URL="${GATEWAY_PROXY_URL:-http://host.orb.internal:7897}"

for attempt in 1 2 3; do
  echo "== 第 $attempt/3 次尝试 vendor 依赖 =="
  if docker run --rm --network host \
      -v "$PWD/backend/src":/src -w /src \
      -e "HTTPS_PROXY=${PROXY_URL}" -e "HTTP_PROXY=${PROXY_URL}" \
      -e "GOPROXY=https://proxy.golang.org,direct" \
      -e GOMODCACHE=/tmp/gomodcache \
      golang:1.25-alpine \
      go mod vendor; then
    n=$(ls backend/src/vendor/github.com 2>/dev/null | wc -l | tr -d ' ')
    echo "✓ vendor 完成（github.com 下 $n 个组织）"
    exit 0
  fi
  echo "  失败，重试…"
  sleep 3
done

echo "✗ 三次尝试均失败；请检查 Clash 是否可用后重跑本脚本" >&2
exit 1
