"""Exercise HTTP routes through the real LangChain adapter at the network boundary."""
import json

import httpx
import pytest

from app.core.config import Settings
from app.llm.provider import DeepSeekProvider
from app.main import create_app
from tests.factories import quiz_content, report_text
from tests.test_provider import completion


@pytest.mark.parametrize("failure", [429, 500, "malformed", "length"])
async def test_actual_adapter_retries_then_quiz_and_report_roundtrip(failure):
    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        if len(calls) == 1:
            if isinstance(failure, int):
                return httpx.Response(failure, json={"error": {"message": "private provider detail"}})
            content = "{" if failure == "malformed" else json.dumps(quiz_content())
            return httpx.Response(200, json=completion(content, "length" if failure == "length" else "stop"))
        data = quiz_content() if len(calls) == 2 else report_text()
        return httpx.Response(200, json=completion(json.dumps(data)))

    settings = Settings(_env_file=None, deepseek_api_key="dummy-test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        app = create_app(settings, DeepSeekProvider(settings, http_client=upstream))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})
            assert response.status_code == 200
            quiz = response.json()["data"]
            response = await client.post("/api/v1/report/generate", json={
                "quiz_id": quiz["quiz_id"], "topic": quiz["title"], "questions": quiz["questions"],
                "answer_records": [{"question_id": q["id"], "selected_answers": q["answer"],
                                    "is_correct": False, "duration_ms": 1000.0} for q in quiz["questions"]]})
    assert response.status_code == 200
    report = response.json()["data"]
    assert (report["accuracy"], report["correct"], report["total"], report["xp"]) == (100, 5, 5, 50)
    assert report["weak_points"] == [] and len(report["three_line_summary"]) == 3
    assert len(calls) == 3


@pytest.mark.parametrize("status,code,calls_expected", [(401, 50301, 1), (503, 50302, 2)])
async def test_actual_upstream_failure_returns_safe_http_envelope(status, code, calls_expected, caplog):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "sensitive provider response"}})

    settings = Settings(_env_file=None, deepseek_api_key="dummy-test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        app = create_app(settings, DeepSeekProvider(settings, http_client=upstream))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})
    assert response.status_code == 503 and response.json()["code"] == code
    assert response.json()["data"] is None and len(calls) == calls_expected
    assert "sensitive provider response" not in response.text + caplog.text
    assert "dummy-test-key" not in response.text + caplog.text


@pytest.mark.parametrize("content", [
    json.dumps(quiz_content())[:-1],
    "```json\n" + json.dumps(quiz_content()) + "\n```",
    json.dumps(quiz_content()) + " trailing garbage",
], ids=["missing-final-brace", "markdown-fence", "trailing-garbage"])
@pytest.mark.parametrize("recover", [True, False], ids=["retry-recovers", "retries-exhausted"])
async def test_raw_json_contract_is_enforced_through_bounded_api_retries(content, recover):
    calls = []

    def handler(request):
        calls.append(request)
        raw = json.dumps(quiz_content()) if recover and len(calls) > 1 else content
        return httpx.Response(200, json=completion(raw, "stop"))

    settings = Settings(_env_file=None, deepseek_api_key="dummy-test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        app = create_app(settings, DeepSeekProvider(settings, http_client=upstream))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})
    assert len(calls) == 2
    if recover:
        assert response.status_code == 200 and response.json()["code"] == 0
    else:
        assert response.status_code == 503 and response.json() == {
            "code": 50302, "message": "AI 生成暂未成功，请重试", "data": None}


@pytest.mark.parametrize("envelope", [{}, {"choices": []}], ids=["missing-choices", "empty-choices"])
@pytest.mark.parametrize("recover", [True, False], ids=["retry-recovers", "retries-exhausted"])
async def test_malformed_completion_envelope_uses_bounded_generation_retries(envelope, recover):
    calls = []

    def handler(request):
        calls.append(request)
        body = completion(json.dumps(quiz_content())) if recover and len(calls) > 1 else envelope
        return httpx.Response(200, json=body)

    settings = Settings(_env_file=None, deepseek_api_key="dummy-test-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as upstream:
        app = create_app(settings, DeepSeekProvider(settings, http_client=upstream))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})
    assert len(calls) == 2
    if recover:
        assert response.status_code == 200 and response.json()["code"] == 0
    else:
        assert response.status_code == 503 and response.json()["code"] == 50302
        assert response.json()["data"] is None
