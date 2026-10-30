from typing import Literal
from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
    deepseek_api_key: SecretStr | None = None
    app_env: Literal["development", "test", "production"] = "development"
    dev_login_enabled: bool = False
    mysql_host: str = "127.0.0.1"
    mysql_port: int = Field(default=3306, ge=1, le=65535)
    mysql_user: str | None = None
    mysql_password: SecretStr | None = None
    mysql_database: str | None = None
    jwt_secret: SecretStr | None = None
    jwt_expire_seconds: int = Field(default=604800, ge=60, le=2592000)
    wechat_app_id: str | None = None
    wechat_app_secret: SecretStr | None = None
    deepseek_model: str = "deepseek-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    generation_timeout_seconds: float = Field(default=45, gt=0, le=45)
    generation_retries: int = Field(default=1, ge=0, le=2)
    tavily_api_key: SecretStr | None = None
    enable_web_search: bool = True
    knowledge_timeout_seconds: float = Field(default=25, gt=0, le=45)
    quiz_build_timeout_seconds: float = Field(default=25, gt=0, le=45)
    quiz_request_timeout_seconds: float = Field(default=55, gt=0, le=55)
    knowledge_max_tool_calls: int = Field(default=4, ge=1, le=4)
    knowledge_max_context_chars: int = Field(default=12000, ge=1000, le=12000)
    rate_limit_requests: int = Field(default=20, ge=1, le=10000)
    rate_limit_window_seconds: float = Field(default=60, gt=0)
    rate_limit_max_clients: int = Field(default=1024, ge=1, le=100000)
    max_body_bytes: int = Field(default=65536, ge=1, le=1048576)
    cors_origins: list[str] = ["http://localhost:10086", "http://127.0.0.1:10086"]
    blocked_terms: list[str] = ["儿童色情", "炸弹制作教程"]

    @model_validator(mode="after")
    def validate_development_login(self):
        if self.dev_login_enabled and self.app_env != "development":
            raise ValueError("Development login is allowed only in development")
        return self

    @model_validator(mode="after")
    def validate_quiz_budgets(self):
        if self.knowledge_timeout_seconds + self.quiz_build_timeout_seconds >= self.quiz_request_timeout_seconds:
            raise ValueError("Quiz stages must leave time for storage within the request deadline")
        return self

    @field_validator("deepseek_base_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("DeepSeek base URL must use HTTP(S)")
        return value.rstrip("/")
