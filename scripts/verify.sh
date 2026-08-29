#!/usr/bin/env zsh
# 一键自检：宿主机代理 → 容器代理 → 后端健康 → 本地网关 → 隧道地址
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
step() { printf '\n\033[1;34m== %s ==\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=1; }

step "1/5 宿主机 Clash 代理 (127.0.0.1:7897)"
if ip=$(curl -s -m 8 -x http://127.0.0.1:7897 https://api.ipify.org); then
  ok "代理可用，出口 IP: $ip"
else
  bad "代理不可用，请确认 Clash Verge 正在运行且混合端口为 7897"
fi

step "2/5 容器可访问宿主机代理 (host.orb.internal:7897)"
if docker run --rm --entrypoint /bin/sh golang:1.25-alpine -c 'nc -z -w 3 host.orb.internal 7897' 2>/dev/null; then
  ok "容器 → 宿主机代理端口连通"
else
  bad "容器无法访问宿主机代理（GATEWAY_PROXY_URL / Clash 监听配置）"
fi

step "3/5 后端健康检查（容器网络内部直连 /health）"
if r=$(docker compose exec -T caddy wget -qO- http://gemini-api:4981/health 2>/dev/null); then
  ok "$r"
else
  bad "后端未响应：docker compose ps 查看状态（未填 cookie 时后端会重启循环，属预期）"
fi

step "4/5 本地网关与密码认证 (http://127.0.0.1:8080)"
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/)
if [ "$code" = "401" ]; then
  ok "网关在线，密码认证生效（未带凭据返回 401）"
elif [ "$code" = "200" ]; then
  bad "首页未带凭据即可访问？请检查 Caddy basic_auth"
else
  bad "网关未响应 (HTTP $code)，是否已 docker compose up -d"
fi

step "5/5 Cloudflare 隧道"
url=$(docker compose logs cloudflared 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1)
if [ -n "$url" ]; then
  ok "当前临时域名: $url"
  code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$url/")
  if [ "$code" = "401" ]; then
    ok "公网可达且要求认证 (401)"
  elif [ "$code" = "200" ]; then
    bad "公网未要求认证？检查 Caddy 配置"
  else
    bad "公网访问异常 (HTTP $code)"
  fi
else
  bad "隧道尚未建立：docker compose logs cloudflared 查看原因"
fi

exit $fail
