from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    deepseek_api_key: SecretStr | None = None
    deepseek_model: str = "deepseek-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    generation_timeout_seconds: float = Field(default=45, gt=0, le=45)
    generation_retries: int = Field(default=1, ge=0, le=2)
    rate_limit_requests: int = Field(default=20, ge=1, le=10000)
    rate_limit_window_seconds: float = Field(default=60, gt=0)
    rate_limit_max_clients: int = Field(default=1024, ge=1, le=100000)
    max_body_bytes: int = Field(default=65536, ge=1, le=1048576)
    cors_origins: list[str] = ["http://localhost:10086", "http://127.0.0.1:10086"]
    blocked_terms: list[str] = ["儿童色情", "炸弹制作教程"]

    @field_validator("deepseek_base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("DeepSeek base URL must use HTTP(S)")
        return value.rstrip("/")
