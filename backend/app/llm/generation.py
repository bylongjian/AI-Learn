import asyncio
import json
import logging
from typing import Callable, Protocol, TypeVar
from langchain_core.messages import BaseMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, ValidationError
from app.core.config import Settings
from app.core.content import ContentGuard
from app.core.errors import AppError
from app.llm.provider import ProviderFailure

Model = TypeVar("Model", bound=BaseModel)
logger = logging.getLogger(__name__)
SAFE_SCHEMA_ERROR_TYPES = frozenset({
    "missing", "extra_forbidden", "string_type", "string_too_short", "string_too_long",
    "literal_error", "value_error", "too_short", "too_long", "greater_than_equal", "less_than_equal",
    "finite_number", "int_type", "float_type", "bool_type", "list_type", "model_type", "dict_type",
})


class Provider(Protocol):
    async def complete(self, schema: type[Model], messages: list[BaseMessage]) -> Model: ...


class ReliableGenerator:
    def __init__(self, provider: Provider, settings: Settings, guard: ContentGuard):
        self.provider, self.settings, self.guard = provider, settings, guard

    async def generate(self, schema: type[Model], prompt: ChatPromptTemplate,
                       variables: dict, validate: Callable[[Model], None] | None = None) -> Model:
        messages = prompt.format_messages(schema=json.dumps(schema.model_json_schema(), ensure_ascii=False), **variables)
        attempts = self.settings.generation_retries + 1
        attempt_timeout = self.settings.generation_timeout_seconds / attempts
        try:
            async with asyncio.timeout(self.settings.generation_timeout_seconds):
                for attempt in range(attempts):
                    try:
                        attempt_messages = messages if attempt == 0 else [*messages, SystemMessage(content=(
                            "重试要求：只输出一个完整且合法的 JSON 对象，严格遵守既定 schema、题目数量、题型和难度。"
                            "不要 Markdown、额外解释或额外字段，不要遗漏结束括号；内容保持简短准确。"))]
                        async with asyncio.timeout(attempt_timeout):
                            raw = await self.provider.complete(schema, attempt_messages)
                        result = schema.model_validate_json(raw) if isinstance(raw, str) else schema.model_validate(raw)
                        if validate is not None:
                            validate(result)
                        self.guard.check(result.model_dump())
                        return result
                    except ProviderFailure as exc:
                        logger.warning("generation upstream failure; retryable=%s attempt=%d", exc.retryable, attempt + 1)
                        if not exc.retryable:
                            if exc.missing_config:
                                raise AppError(50301, "请在后端 .env 中配置 DEEPSEEK_API_KEY 后重启服务", 503) from None
                            raise AppError(50301, "AI 服务配置暂不可用，请联系服务维护者", 503) from None
                    except (ValidationError, ValueError, TimeoutError) as exc:
                        logger.warning("generation invalid or timed out; category=%s attempt=%d", type(exc).__name__, attempt + 1)
                        if isinstance(exc, ValidationError):
                            error_types = sorted({error["type"] if error["type"] in SAFE_SCHEMA_ERROR_TYPES else "validation_error"
                                                  for error in exc.errors(include_input=False, include_context=False)})
                            logger.warning("generation schema_error_types=%s", error_types)
                        if isinstance(exc, TimeoutError) and attempt == attempts - 1:
                            raise AppError(50401, "AI 生成超时，请重试", 504) from None
                raise AppError(50302, "AI 生成暂未成功，请重试", 503)
        except TimeoutError:
            raise AppError(50401, "AI 生成超时，请重试", 504) from None
