#!/usr/bin/env python3
"""
自动从 Edge 浏览器读取 Gemini cookie 并推送到 receiver。
不依赖扩展，通过 Edge 的 cookie 数据库直接读取。
"""
import http.client
import json
import os
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

RECEIVER_HOST = "127.0.0.1"
RECEIVER_PORT = 8799
TOKEN = os.environ.get("COOKIE_SYNC_TOKEN", "")
COOKIE_DB = Path.home() / "Library/Application Support/Microsoft Edge/Default/Cookies"
COOKIE_NAMES = ["__Secure-1PSID", "__Secure-1PSIDTS"]

def get_cookies_from_edge():
    """从 Edge 的 cookie 数据库读取 Gemini cookies"""
    # Edge 使用 Chrome Safe Storage 加密 cookie
    # 需要先获取加密密钥
    try:
        # 获取 Edge 的加密密钥
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "Microsoft Edge Safe Storage", "-w"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            print(f"Failed to get Edge key: {result.stderr}")
            return None
        
        key = result.stdout.strip()
        
        # 使用 PBKDF2 派生密钥
        import hashlib
        derived_key = hashlib.pbkdf2_hmac('sha1', key.encode(), b'saltysalt', 1003, dklen=16)
        
        # 读取 cookie 数据库
        if not COOKIE_DB.exists():
            print(f"Cookie DB not found: {COOKIE_DB}")
            return None
        
        # 复制数据库（避免锁定问题）
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_path = tmp.name
        
        subprocess.run(["cp", str(COOKIE_DB), tmp_path], check=True)
        
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()
        
        cookies = {}
        for name in COOKIE_NAMES:
            cursor.execute(
                "SELECT encrypted_value FROM cookies WHERE host_key LIKE '%google.com' AND name = ?",
                (name,)
            )
            row = cursor.fetchone()
            if row:
                encrypted = row[0]
                # 解密
                from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
                from cryptography.hazmat.backends import default_backend
                
                if encrypted[:3] == b'v11':
                    # v11 encryption
                    iv = b' ' * 16
                    encrypted = encrypted[3:]
                    cipher = Cipher(algorithms.AES(derived_key), modes.CBC(iv), backend=default_backend())
                    decryptor = cipher.decryptor()
                    decrypted = decryptor.update(encrypted) + decryptor.finalize()
                    # 去掉 PKCS7 padding
                    padding = decrypted[-1]
                    if isinstance(padding, int) and padding <= 16:
                        decrypted = decrypted[:-padding]
                    cookies[name] = decrypted.decode('utf-8', errors='ignore')
                elif encrypted[:3] == b'v10':
                    # v10 encryption
                    iv = b' ' * 16
                    encrypted = encrypted[3:]
                    cipher = Cipher(algorithms.AES(derived_key), modes.CBC(iv), backend=default_backend())
                    decryptor = cipher.decryptor()
                    decrypted = decryptor.update(encrypted) + decryptor.finalize()
                    padding = decrypted[-1]
                    if isinstance(padding, int) and padding <= 16:
                        decrypted = decrypted[:-padding]
                    cookies[name] = decrypted.decode('utf-8', errors='ignore')
                else:
                    # 可能是明文
                    cookies[name] = encrypted.decode('utf-8', errors='ignore')
        
        conn.close()
        os.unlink(tmp_path)
        
        return cookies if all(cookies.get(name) for name in COOKIE_NAMES) else None
        
    except Exception as e:
        print(f"Error reading cookies: {e}")
        return None

def push_cookies(cookies):
    """推送 cookies 到 receiver"""
    try:
        conn = http.client.HTTPConnection(RECEIVER_HOST, RECEIVER_PORT, timeout=10)
        body = json.dumps({"cookies": cookies, "reason": "auto-edge"})
        conn.request("POST", "/cookies", body, {
            "Content-Type": "application/json",
            "X-Token": TOKEN
        })
        resp = conn.getresponse()
        data = json.loads(resp.read())
        conn.close()
        return data
    except Exception as e:
        print(f"Error pushing cookies: {e}")
        return None

def main():
    print("Reading cookies from Edge...")
    cookies = get_cookies_from_edge()
    if not cookies:
        print("Failed to read cookies from Edge")
        return False
    
    print(f"Read cookies: PSID={cookies.get('__Secure-1PSID', '')[:20]}...")
    
    result = push_cookies(cookies)
    if result and result.get("ok"):
        print(f"Pushed successfully: {result}")
        return True
    else:
        print(f"Push failed: {result}")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
