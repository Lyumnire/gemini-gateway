#!/usr/bin/env zsh
# 组装 gg-cloudflared-proxy:local —— 让 cloudflared 的边缘连接走 Clash。
# 原理：容器内 /etc/hosts 把 CF 隧道边缘域名(region*.v2.argotunnel.com)指向
# 127.0.0.1，Python 转发器监听 7844 并"按域名"通过宿主机 Clash(SOCKS5) 转发 ——
# Clash 按域名规则命中代理节点，TLS SNI 保持原名，证书校验正常。
# 背景：国内网络对 argotunnel 端点(7844)存在 TLS 干扰（直连返回过期证书、
# QUIC 被阻断），IP 直连请求又无法命中 Clash 的域名分流规则，唯有按域名走代理。
set -euo pipefail
cd "$(dirname "$0")/.."

HOST_PROXY="${GATEWAY_HOST_PROXY_URL:-http://127.0.0.1:7897}"
WORK=/tmp/gg-cfp
mkdir -p "$WORK"

dl() { # dl <url> <out>
  if [ ! -s "$2" ]; then
    echo "下载 $1"
    curl -fsSL -m 120 -x "${HOST_PROXY}" -o "$2" "$1"
  fi
}

# 1) 准备 cloudflared（arm64）。优先复用本地已提取的二进制。
if [ -s /tmp/cloudflared-bin ]; then
  cp /tmp/cloudflared-bin "$WORK/cloudflared"
elif [ ! -s "$WORK/cloudflared" ]; then
  CF_VER=$(curl -fsSL -m 20 -x "${HOST_PROXY}" "https://api.github.com/repos/cloudflare/cloudflared/releases/latest" | python3 -c "import json,sys;print(json.load(sys.stdin)['tag_name'])" 2>/dev/null || echo "")
  [ -n "$CF_VER" ] || { echo "无法获取 cloudflared 版本，请重试" >&2; exit 1; }
  dl "https://github.com/cloudflare/cloudflared/releases/download/${CF_VER}/cloudflared-linux-arm64" "$WORK/cloudflared"
fi

# 2) 基于本地已构建的后端镜像（= alpine + ca-certificates + tzdata）加装组件
docker rm -f gg-cfp-tmp >/dev/null 2>&1 || true
docker run -d --name gg-cfp-tmp --entrypoint /bin/sh gemini-web-to-api:local -c 'sleep 300' >/dev/null
trap 'docker rm -f gg-cfp-tmp >/dev/null 2>&1 || true' EXIT

docker exec -u root gg-cfp-tmp apk add --no-cache python3 iptables >/dev/null
docker cp "$WORK/cloudflared" gg-cfp-tmp:/usr/local/bin/cloudflared

# 3) 写入启动脚本与转发器
cat > "$WORK/entrypoint.sh" <<'ENDSCRIPT'
#!/bin/sh
# iptables 按端口截获所有 7844(边缘)流量 + 固定目标 SOCKS5 转发：统一按"域名"交给 Clash
cat >> /etc/hosts << 'HOSTS'
127.0.0.1 region1.v2.argotunnel.com
127.0.0.1 region2.v2.argotunnel.com
HOSTS
iptables -t nat -A OUTPUT -p tcp --dport 7844 -j REDIRECT --to-ports 12345
python3 /forwarder.py >/var/log/forwarder.log 2>&1 &
exec cloudflared tunnel --no-autoupdate --protocol http2 --url http://caddy:80
ENDSCRIPT

cat > "$WORK/forwarder.py" <<'ENDPY'
import socket, threading

UPSTREAM_HOST = "host.orb.internal"   # 宿主机 Clash（SOCKS5 混合端口）
UPSTREAM_PORT = 7897
TARGET_HOST = b"region1.v2.argotunnel.com"  # 按域名 CONNECT：让 Clash 命中分流规则
TARGET_PORT = 7844

def pump(src, dst):
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass

def handle(client):
    try:
        up = socket.create_connection((UPSTREAM_HOST, UPSTREAM_PORT), timeout=10)
        up.sendall(b"\x05\x01\x00")  # SOCKS5: 无认证
        if up.recv(2) != b"\x05\x00":
            raise RuntimeError("socks greeting failed")
        req = b"\x05\x01\x00\x03" + bytes([len(TARGET_HOST)]) + TARGET_HOST + TARGET_PORT.to_bytes(2, "big")
        up.sendall(req)  # 按域名 CONNECT
        rep = up.recv(64)
        if len(rep) < 2 or rep[1] != 0:
            raise RuntimeError(f"socks connect failed: {rep[:8].hex()}")
        threading.Thread(target=pump, args=(client, up), daemon=True).start()
        pump(up, client)
    except Exception as e:
        print("conn error:", e, flush=True)
        try:
            client.close()
        except OSError:
            pass

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("0.0.0.0", 12345))
srv.listen(64)
print("forwarder listening on 12345 ->", UPSTREAM_HOST, UPSTREAM_PORT, flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=handle, args=(c,), daemon=True).start()
ENDPY

chmod +x "$WORK/entrypoint.sh"
docker cp "$WORK/entrypoint.sh" gg-cfp-tmp:/entrypoint.sh
docker cp "$WORK/forwarder.py" gg-cfp-tmp:/forwarder.py
docker exec -u root gg-cfp-tmp chmod +x /entrypoint.sh /usr/local/bin/cloudflared

# 4) 提交为镜像（root 运行：需要写 /etc/hosts）
docker stop gg-cfp-tmp >/dev/null
docker commit \
  --change 'USER root' \
  --change 'ENTRYPOINT ["/entrypoint.sh"]' \
  gg-cfp-tmp gg-cloudflared-proxy:local >/dev/null

docker image inspect gg-cloudflared-proxy:local --format '✓ 构建完成: {{.Os}}/{{.Architecture}} {{.Size}}'
