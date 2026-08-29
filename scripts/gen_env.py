#!/usr/bin/env python3
"""初始化/修改 .env：生成随机访问密码，并把 bcrypt 哈希直接写入 Caddyfile。

说明：密码哈希不走环境变量/compose（bcrypt 哈希里的 $ 会被 compose 的
dotenv 插值破坏），而是写入 caddy/Caddyfile 的占位符位置。

用法:
  python3 scripts/gen_env.py            # .env 不存在则从 .env.example 创建并生成密码
  python3 scripts/gen_env.py --reset-pw # 重新生成访问密码并更新 Caddyfile
"""
import re
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
EXAMPLE = ROOT / ".env.example"
CADDYFILE = ROOT / "caddy" / "Caddyfile"
HASH_PLACEHOLDER = "GATEWAY_PASSWORD_HASH_BCRYPT"


def make_password() -> str:
    # 12 位无易混淆字符的随机密码
    alphabet = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(12))


def make_hash(pw: str) -> str:
    # 优先用本地 caddy 镜像生成（无需 Python 依赖），失败则回退 bcrypt 库
    try:
        out = subprocess.run(
            ["docker", "run", "--rm", "caddy:2-alpine",
             "caddy", "hash-password", "--plaintext", pw],
            capture_output=True, text=True, timeout=60, check=True,
        )
        return out.stdout.strip()
    except Exception:
        try:
            import bcrypt  # type: ignore
        except ImportError:
            sys.exit("无法生成哈希：请启动 Docker 或 pip install bcrypt 后重试")
        return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=12)).decode()


def set_env_value(text: str, key: str, value: str) -> str:
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            return "\n".join(lines) + "\n"
    return text + f"\n{key}={value}\n"


def write_hash_to_caddyfile(hash_str: str) -> None:
    text = CADDYFILE.read_text()
    pattern = re.compile(
        rf"(\{{\$GATEWAY_USER\}}\s+)(?:{HASH_PLACEHOLDER}|\$2[aby]\$\S+)"
    )
    if pattern.search(text):
        text = pattern.sub(rf"\g<1>{hash_str}", text)
    else:
        text = text.replace(HASH_PLACEHOLDER, hash_str)
    CADDYFILE.write_text(text)


def main() -> None:
    reset_pw = "--reset-pw" in sys.argv

    if ENV_FILE.exists() and not reset_pw:
        print(f".env 已存在: {ENV_FILE}")
        return

    if reset_pw and not ENV_FILE.exists():
        text = EXAMPLE.read_text() if EXAMPLE.exists() else ""
        ENV_FILE.write_text(text)

    password = make_password()
    write_hash_to_caddyfile(make_hash(password))

    # 保证 cookie 字段存在且为空（待用户填写）
    text = ENV_FILE.read_text()
    for key in ("GEMINI_1PSID", "GEMINI_1PSIDTS"):
        if f"{key}=" not in text:
            text += f"{key}=\n"
    ENV_FILE.write_text(text)

    print(f"网关访问密码: {password}")
    print(f"（已写入 {CADDYFILE}；浏览器访问时账号 admin / 上述密码）")


if __name__ == "__main__":
    main()

