"""与 Next.js 站点共享的会话校验（Cookie: msg_session）。

Token 格式：base64url(json{sub,exp}).base64url(hmac-sha256)
密钥：AUTH_SECRET（与网站 .env 一致）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Optional

from fastapi import Cookie, HTTPException, Request

SESSION_COOKIE = "msg_session"

# asset-tracker/backend/app -> 网站根目录（美股扫盲网站）
_SITE_ROOT = Path(__file__).resolve().parents[3]


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass


# 自动读取网站 .env.local / .env，保证 AUTH_SECRET 与 Next 一致
_load_env_file(_SITE_ROOT / ".env.local")
_load_env_file(_SITE_ROOT / ".env")
_load_env_file(Path(__file__).resolve().parents[2] / ".env")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def _secret() -> str:
    secret = (os.getenv("AUTH_SECRET") or os.getenv("NEXTAUTH_SECRET") or "").strip()
    if len(secret) >= 32:
        return secret
    if is_production():
        raise RuntimeError("生产环境必须配置至少 32 字符的 AUTH_SECRET")
    return "dev-only-auth-secret-change-me"


def is_production() -> bool:
    environment = (
        os.getenv("ENVIRONMENT")
        or os.getenv("APP_ENV")
        or os.getenv("NODE_ENV")
        or ""
    ).strip().lower()
    return environment in {"production", "prod"} or bool(os.getenv("RENDER"))


def validate_auth_configuration() -> None:
    """Fail closed before accepting traffic in a public deployment."""
    _secret()


def verify_session_token(token: str) -> Optional[str]:
    """返回 user_id（sub），无效则 None。"""
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        body, sig_b64 = parts
        expected = hmac.new(
            _secret().encode("utf-8"),
            body.encode("utf-8"),
            hashlib.sha256,
        ).digest()
        actual = _b64url_decode(sig_b64)
        if not hmac.compare_digest(expected, actual):
            return None
        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        sub = payload.get("sub")
        exp = payload.get("exp")
        if not sub or not isinstance(exp, (int, float)):
            return None
        if float(exp) < time.time():
            return None
        return str(sub)
    except Exception:
        return None


def get_user_id_from_request(
    request: Request,
    msg_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE),
) -> str:
    token = msg_session
    if not token:
        # 兼容部分代理只带 Cookie 头
        raw = request.headers.get("cookie") or ""
        for part in raw.split(";"):
            part = part.strip()
            if part.startswith(f"{SESSION_COOKIE}="):
                token = part.split("=", 1)[1]
                break
    if not token:
        raise HTTPException(status_code=401, detail="请先登录后再使用资产管理")
    user_id = verify_session_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    return user_id
