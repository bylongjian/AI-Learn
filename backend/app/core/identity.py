"""Signed identities. Invalid credentials are intentionally anonymous on AI routes."""
from dataclasses import dataclass
import time

import jwt

from app.core.config import Settings
from app.core.errors import AppError

ISSUER = "ai-learn"
AUDIENCE = "ai-learn-client"


@dataclass(frozen=True)
class Identity:
    user_id: str
    is_test: bool


def require_token_configuration(settings: Settings):
    if not settings.jwt_secret or not settings.jwt_secret.get_secret_value():
        raise AppError(50302, "登录服务尚未配置", 503)


def create_token(settings: Settings, user_id: str, *, is_test: bool) -> str:
    require_token_configuration(settings)
    now = int(time.time())
    return jwt.encode({"sub": user_id, "iat": now, "exp": now + settings.jwt_expire_seconds,
                       "iss": ISSUER, "aud": AUDIENCE, "is_test": is_test},
                      settings.jwt_secret.get_secret_value(), algorithm="HS256")


def read_token(settings: Settings, token: str) -> Identity | None:
    if not settings.jwt_secret or not settings.jwt_secret.get_secret_value():
        return None
    try:
        claims = jwt.decode(token, settings.jwt_secret.get_secret_value(), algorithms=["HS256"],
                            issuer=ISSUER, audience=AUDIENCE,
                            options={"require": ["exp", "iat", "sub", "iss", "aud", "is_test"], "strict_aud": True})
        if (type(claims["exp"]) is not int or type(claims["iat"]) is not int
                or not isinstance(claims["sub"], str) or not claims["sub"].isascii()
                or not claims["sub"].isdecimal() or int(claims["sub"]) < 1
                or type(claims["is_test"]) is not bool
                or (settings.app_env == "production" and claims["is_test"])):
            return None
        return Identity(claims["sub"], claims["is_test"])
    except (jwt.InvalidTokenError, ValueError, TypeError):
        return None
