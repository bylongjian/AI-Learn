import json
import math

import httpx
from langchain_core.messages import BaseMessage
from langchain_deepseek import ChatDeepSeek
from openai import APIConnectionError, APIStatusError, ContentFilterFinishReasonError, LengthFinishReasonError
from pydantic import BaseModel
from app.core.config import Settings


def _finite_json_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("AI JSON contains a non-finite number")
    return number


class ProviderFailure(Exception):
    def __init__(self, retryable: bool, missing_config: bool = False):
        super().__init__("Upstream provider failed")
        self.retryable = retryable
        self.missing_config = missing_config


class DeepSeekProvider:
    def __init__(self, settings: Settings, http_client: httpx.AsyncClient | None = None):
        self.llm = None
        self._owns_async_client = http_client is None
        if settings.deepseek_api_key is not None and settings.deepseek_api_key.get_secret_value().strip():
            self.llm = ChatDeepSeek(
                model=settings.deepseek_model,
                api_key=settings.deepseek_api_key,
                api_base=settings.deepseek_base_url,
                temperature=0.5,
                max_tokens=5000,
                timeout=settings.generation_timeout_seconds,
                max_retries=0,
                extra_body={"thinking": {"type": "disabled"}},
                http_async_client=http_client,
            )

    async def aclose(self) -> None:
        if self.llm is not None:
            try:
                self.llm.root_client.close()
            finally:
                if self._owns_async_client:
                    await self.llm.root_async_client.close()

    async def complete(self, schema: type[BaseModel], messages: list[BaseMessage]) -> BaseModel:
        if self.llm is None:
            raise ProviderFailure(retryable=False, missing_config=True)
        try:
            output = await self.llm.with_structured_output(schema, method="json_mode", include_raw=True).ainvoke(messages)
        except APIStatusError as exc:
            raise ProviderFailure(retryable=exc.status_code == 429 or exc.status_code >= 500) from None
        except APIConnectionError:
            raise ProviderFailure(retryable=True) from None
        except (LengthFinishReasonError, ContentFilterFinishReasonError):
            raise ValueError("AI output was truncated or rejected by the upstream filter") from None
        except (TypeError, IndexError):
            # The SDK/adapter indexes missing or empty choices before exposing the raw completion.
            # Business schema validation stays outside this transport-boundary exception handler.
            raise ValueError("Upstream completion envelope was malformed") from None
        raw = output["raw"]
        if raw.response_metadata.get("finish_reason") == "length" or not isinstance(raw.content, str) or not raw.content:
            raise ValueError("AI output was empty, truncated, or did not match schema")
        # LangChain's parser repairs partial/Markdown JSON; only the entire raw JSON is authoritative.
        data = json.loads(raw.content, parse_constant=_finite_json_number, parse_float=_finite_json_number)
        return schema.model_validate(data)
