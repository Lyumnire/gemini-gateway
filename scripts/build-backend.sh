#!/usr/bin/env zsh
# 构建 arm64 后端镜像 gemini-web-to-api:local
# 背景：BuildKit 默认构建器解析镜像元数据时直连 docker.io，会被墙；
# 因此用 docker-container 驱动的构建器，并给 buildkitd 容器配上 Clash 代理。
set -euo pipefail
cd "$(dirname "$0")/.."

PROXY_URL="${GATEWAY_PROXY_URL:-http://host.orb.internal:7897}"

# 初始化构建器（仅在缺失时创建，保留构建缓存）
if ! docker buildx inspect ggbuilder >/dev/null 2>&1; then
  echo "== 初始化 buildx 构建器 ggbuilder（docker.io 走镜像站 + 容器内代理）=="
  docker buildx create --name ggbuilder --driver docker-container \
    --buildkitd-config "$(dirname "$0")/buildkitd.toml" \
    --driver-opt "network=host" \
    --driver-opt "env.http_proxy=${PROXY_URL}" --driver-opt "env.https_proxy=${PROXY_URL}" \
    --driver-opt "env.HTTP_PROXY=${PROXY_URL}" --driver-opt "env.HTTPS_PROXY=${PROXY_URL}" \
    --bootstrap
fi

# 最终阶段基于本地化的 Alpine rootfs（FROM scratch），彻底摆脱 docker.io 镜像站
ROOTFS_DIR="backend/src/build/rootfs"
if [ ! -f "$ROOTFS_DIR/etc/alpine-release" ]; then
  echo "== 下载并解包 Alpine minirootfs（清华镜像）=="
  mkdir -p backend/src/build "$ROOTFS_DIR"
  curl -fsSL -o /tmp/alpine-minirootfs.tar.gz \
    "https://mirrors.tuna.tsinghua.edu.cn/alpine/v3.22/releases/aarch64/alpine-minirootfs-3.22.2-aarch64.tar.gz"
  tar -xzf /tmp/alpine-minirootfs.tar.gz -C "$ROOTFS_DIR"
  rm -f /tmp/alpine-minirootfs.tar.gz
fi

docker buildx build \
  --builder ggbuilder \
  --load \
  --allow network.host \
  -t gemini-web-to-api:local \
  backend/src

docker image inspect gemini-web-to-api:local --format '✓ 构建完成: {{.Os}}/{{.Architecture}}'
