from typing import Literal
import unicodedata
from urllib.parse import urlsplit

from pydantic import Field, field_validator

from app.models.base import StrictModel


class LoginRequest(StrictModel):
    code: str = Field(min_length=1, max_length=256)

    @field_validator("code")
    @classmethod
    def valid_code(cls, value):
        if not value.strip() or any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Invalid login code")
        return value


class DevLoginRequest(StrictModel):
    account: Literal["a", "b"]


class ProfileUpdate(StrictModel):
    nickname: str
    avatar_url: str = Field(max_length=500)

    @field_validator("nickname")
    @classmethod
    def clean_nickname(cls, value):
        if any(unicodedata.category(c).startswith("C") for c in value):
            raise ValueError("Nickname contains control characters")
        value = value.strip()
        if not 1 <= len(value) <= 100:
            raise ValueError("Nickname must contain 1 to 100 characters")
        return value

    @field_validator("avatar_url")
    @classmethod
    def safe_avatar(cls, value):
        if not value:
            return value
        if any(c.isspace() or unicodedata.category(c).startswith("C") for c in value) or "\\" in value:
            raise ValueError("Avatar must be a safe HTTPS URL")
        try:
            url = urlsplit(value)
            if url.scheme != "https" or not url.hostname or url.username is not None or url.password is not None:
                raise ValueError("Avatar must be a safe HTTPS URL")
            url.port
        except ValueError:
            raise ValueError("Avatar must be a safe HTTPS URL") from None
        return value
