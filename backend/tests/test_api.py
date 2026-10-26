import httpx
import pytest
from tests.factories import quiz_content, report_request, report_text
from tests.test_generation import SequenceProvider


@pytest.fixture
def make_client():
    def build(provider=None, **settings):
        from app.main import create_app
        from app.core.config import Settings
        config = Settings(_env_file=None, **settings)
        app = create_app(config, provider=provider or SequenceProvider(quiz_content()))
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    return build


async def test_health_envelope_without_api_key(make_client):
    async with make_client() as client:
        result = await client.get("/api/v1/health")
    assert result.status_code == 200
    assert result.json() == {"code": 0, "message": "ok", "data": {"status": "ok"}}


async def test_quiz_api_success_and_report_roundtrip(make_client):
    provider = SequenceProvider(quiz_content(), report_text())
    async with make_client(provider) as client:
        quiz_response = await client.post("/api/v1/quiz/generate", json={"user_input": " Python "})
        quiz = quiz_response.json()["data"]
        payload = report_request()
        payload.update(quiz_id=quiz["quiz_id"], questions=quiz["questions"])
        response = await client.post("/api/v1/report/generate", json=payload)
    assert quiz_response.status_code == response.status_code == 200
    assert quiz["user_input"] == "Python"
    assert response.json()["data"]["accuracy"] == 100


@pytest.mark.parametrize("payload", [{}, {"user_input": " "}, {"user_input": "a" * 2001},
    {"user_input": "x", "question_count": "5"}, {"user_input": "x", "difficulty": "bad"}])
async def test_validation_errors_use_safe_envelope(make_client, payload):
    async with make_client() as client:
        result = await client.post("/api/v1/quiz/generate", json=payload)
    assert result.status_code == 422
    assert result.json()["code"] == 42201
    assert result.json()["data"] is None
    assert "input" not in result.text


async def test_malformed_json_and_unknown_routes_have_envelopes(make_client):
    async with make_client() as client:
        malformed = await client.post("/api/v1/quiz/generate", content="{", headers={"content-type": "application/json"})
        missing = await client.get("/unknown")
        method = await client.get("/api/v1/quiz/generate")
    assert malformed.status_code == 422 and malformed.json()["data"] is None
    assert missing.status_code == 404 and missing.json()["data"] is None
    assert method.status_code == 405 and method.json()["data"] is None


async def test_report_validation_and_generation_failure(make_client):
    async with make_client(SequenceProvider({})) as client:
        payload = report_request()
        payload["answer_records"].pop()
        invalid = await client.post("/api/v1/report/generate", json=payload)
        failure = await client.post("/api/v1/report/generate", json=report_request())
    assert invalid.status_code == 422
    assert failure.status_code == 503 and failure.json()["data"] is None
    assert "重试" in failure.json()["message"]


async def test_config_error_is_safe_and_health_still_available():
    from app.main import create_app
    from app.core.config import Settings
    app = create_app(Settings(_env_file=None, deepseek_api_key=None))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})
        health = await client.get("/api/v1/health")
    assert response.status_code == 503 and response.json()["code"] == 50301
    assert "DEEPSEEK_API_KEY" in response.json()["message"]
    assert health.status_code == 200


async def test_rate_limit_is_per_ip_and_error_has_cors(make_client):
    async with make_client(rate_limit_requests=1) as client:
        headers = {"origin": "http://localhost:10086"}
        first = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=headers)
        limited = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=headers)
        health = await client.get("/api/v1/health")
    assert first.status_code == 200 and limited.status_code == 429
    assert limited.json()["data"] is None
    assert limited.headers["access-control-allow-origin"] == headers["origin"]
    assert health.status_code == 200


async def test_body_cap_and_cors_preflight(make_client):
    async with make_client(max_body_bytes=100) as client:
        large = await client.post("/api/v1/quiz/generate", content="x" * 101)
        preflight = await client.options("/api/v1/quiz/generate", headers={
            "origin": "http://localhost:10086", "access-control-request-method": "POST",
            "access-control-request-headers": "content-type"})
    assert large.status_code == 413 and large.json()["data"] is None
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:10086"


async def test_generated_content_rejection_and_validation_include_cors(make_client):
    headers = {"origin": "http://localhost:10086"}
    async with make_client(blocked_terms=["Python"]) as client:
        rejected = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=headers)
        invalid = await client.post("/api/v1/quiz/generate", json={}, headers=headers)
    assert rejected.status_code == invalid.status_code == 422
    assert rejected.headers["access-control-allow-origin"] == headers["origin"]
    assert invalid.headers["access-control-allow-origin"] == headers["origin"]


async def test_ip_quota_isolated_and_forwarded_header_does_not_bypass_it():
    from app.main import create_app
    from app.core.config import Settings
    app = create_app(Settings(_env_file=None, rate_limit_requests=1), SequenceProvider(quiz_content()))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("192.0.2.1", 123)), base_url="http://test") as first:
        assert (await first.post("/api/v1/quiz/generate", json={"user_input": "Python"})).status_code == 200
        response = await first.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers={"x-forwarded-for": "192.0.2.2"})
        assert response.status_code == 429
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=("192.0.2.2", 123)), base_url="http://test") as second:
        assert (await second.post("/api/v1/quiz/generate", json={"user_input": "Python"})).status_code == 200
