# Stage 1: Build
# 注：请用 scripts/build-backend.sh 构建（带代理的 buildx 构建器），
#     默认构建器解析 docker.io 元数据会被墙。
FROM golang:1.25-alpine AS builder

WORKDIR /app

# 本机重建补丁（上游原版无此两行）：支持通过构建参数指定 Go 模块代理
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}

# Cache dependencies
# 本机重建补丁：依赖由 scripts/prepare-vendor.sh 预先 vendor 进源码，
# 构建期完全离线（--network=none），彻底规避构建容器内 DNS 污染
COPY . .

# Build binary
RUN --network=none CGO_ENABLED=0 GOOS=linux go build -mod=vendor -ldflags="-s -w" -o main ./cmd/server/main.go

# Stage 2: Final Image
# 本机重建补丁：不再依赖 docker.io 的 alpine 镜像（国内镜像站对 blob 不稳定），
# 改用 scripts/build-backend.sh 预下载的 Alpine minirootfs（清华镜像）从零组装
FROM scratch

COPY build/rootfs/ /

# Install required packages
RUN --network=host apk add --no-cache ca-certificates tzdata

# Create a non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /home/appuser

# Copy file from builder and change ownership
COPY --from=builder --chown=appuser:appgroup /app/main .

# Switch to non-root user
USER appuser

EXPOSE 4981

ENTRYPOINT ["./main"] 
