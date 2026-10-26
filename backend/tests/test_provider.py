import json
import math
import httpx
import pytest
from pydantic import BaseModel, SecretStr, field_validator
from tests.factories import quiz_content


def completion(content=None, finish_reason="stop"):
    return {"id": "test-completion", "object": "chat.completion", "created": 1700000000,
            "model": "deepseek-flash", "choices": [{"index": 0, "finish_reason": finish_reason,
             "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}}


async def invoke_transport(handler, key="dummy-test-key", schema=None):
    from app.core.config import Settings
    from app.llm.provider import DeepSeekProvider
    from app.models.quiz import QuizContent
    from app.prompts.quiz import QUIZ_PROMPT
    schema = schema or QuizContent
    settings = Settings(_env_file=None, deepseek_api_key=SecretStr(key) if key is not None else None)
    messages = QUIZ_PROMPT.format_messages(schema=json.dumps(schema.model_json_schema()), user_input="Python",
        question_count=5, single_count=3, difficulty="mixed")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        return await DeepSeekProvider(settings, http_client=client).complete(schema, messages)


async def test_actual_langchain_adapter_sends_json_non_thinking_and_parses_schema():
    captured = []
    def handler(request):
        captured.append(request)
        return httpx.Response(200, json=completion(json.dumps(quiz_content(), ensure_ascii=False)))
    result = await invoke_transport(handler)
    assert result.title == "学习小测"
    request = captured[0]
    payload = json.loads(request.content)
    assert str(request.url) == "https://api.deepseek.com/chat/completions"
    assert payload["model"] == "deepseek-flash"
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"] == {"type": "disabled"}
    assert payload["max_tokens"] >= 3000
    assert "JSON" in payload["messages"][0]["content"]
    assert len(captured) == 1


@pytest.mark.parametrize("content,finish", [
    ("", "stop"), (None, "stop"), ("{", "stop"), ("{}", "stop"),
    (json.dumps(quiz_content()), "length"),
    (json.dumps(quiz_content()), "content_filter"),
    (json.dumps({**quiz_content(), "questions": [quiz_content()["questions"][0]] * 5}), "stop"),
])
async def test_adapter_rejects_empty_malformed_invalid_and_truncated(content, finish):
    with pytest.raises(ValueError):
        await invoke_transport(lambda request: httpx.Response(200, json=completion(content, finish)))


@pytest.mark.parametrize("content", [
    json.dumps(quiz_content())[:-1],
    "```json\n" + json.dumps(quiz_content()) + "\n```",
    json.dumps(quiz_content()) + " trailing garbage",
], ids=["missing-final-brace", "markdown-fence", "trailing-garbage"])
async def test_adapter_rejects_raw_json_that_langchain_can_repair(content):
    with pytest.raises(ValueError):
        await invoke_transport(lambda request: httpx.Response(200, json=completion(content, "stop")))


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity", "1e999", "-1e999"])
async def test_adapter_rejects_nonfinite_json_even_when_schema_accepts_float(constant):
    class NumberContent(BaseModel):
        value: float

    # This schema permits non-finite floats; rejection must happen at JSON syntax validation.
    assert not math.isfinite(NumberContent.model_validate({"value": float(constant)}).value)
    with pytest.raises(ValueError):
        await invoke_transport(lambda request: httpx.Response(200, json=completion('{"value":' + constant + '}')),
                               schema=NumberContent)


async def test_adapter_preserves_valid_finite_json_numbers():
    class NumberContent(BaseModel):
        value: float

    result = await invoke_transport(lambda request: httpx.Response(200, json=completion('{"value":1.25}')),
                                    schema=NumberContent)
    assert result.value == 1.25


@pytest.mark.parametrize("error_type", [TypeError, IndexError])
async def test_schema_programming_errors_are_not_reclassified_as_upstream_shape_errors(error_type):
    class BuggySchema(BaseModel):
        value: str

        @field_validator("value")
        @classmethod
        def broken_validator(cls, value):
            raise error_type("schema programming defect")

    with pytest.raises(error_type, match="schema programming defect"):
        await invoke_transport(lambda request: httpx.Response(200, json=completion('{"value":"valid JSON"}')),
                               schema=BuggySchema)


@pytest.mark.parametrize("status,retryable", [(401, False), (403, False), (400, False), (429, True), (500, True), (503, True)])
async def test_adapter_classifies_upstream_http_errors_without_leaking_content(status, retryable):
    from app.llm.provider import ProviderFailure
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "SENSITIVE upstream secret", "type": "provider_error", "code": "test"}})
    with pytest.raises(ProviderFailure) as exc:
        await invoke_transport(handler)
    assert exc.value.retryable is retryable
    assert "SENSITIVE" not in str(exc.value)
    assert len(calls) == 1


async def test_adapter_network_timeout_is_retryable():
    from app.llm.provider import ProviderFailure
    def handler(request):
        raise httpx.ReadTimeout("sensitive timeout context", request=request)
    with pytest.raises(ProviderFailure) as exc:
        await invoke_transport(handler)
    assert exc.value.retryable


@pytest.mark.parametrize("key", [None, "", "   "])
async def test_missing_or_blank_key_never_calls_upstream(key):
    from app.llm.provider import ProviderFailure
    def handler(request):
        pytest.fail("Missing config must not send a model request")
    with pytest.raises(ProviderFailure) as exc:
        await invoke_transport(handler, key=key)
    assert not exc.value.retryable
