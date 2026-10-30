from contextlib import asynccontextmanager
import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.main import create_app
from tests.factories import quiz_content, report_request, report_text, FixedKnowledge
from tests.test_generation import GroundedSequenceProvider as SequenceProvider
from tests.test_user_repository import repository


@asynccontextmanager
async def client_for(repository, *, provider=None, identity_provider=None, documents_service=None, remote="127.0.0.1", **changes):
    settings = Settings(_env_file=".env.test", **{"app_env": "development", "dev_login_enabled": True, **changes})
    app = create_app(settings, provider or SequenceProvider(quiz_content(), report_text()), identity_provider=identity_provider, knowledge_service=FixedKnowledge(),documents_service=documents_service)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=(remote, 1000)), base_url="http://test") as client:
            yield client, app


async def login(client, account="a"):
    response = await client.post("/api/v1/user/dev-login", json={"account": account})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def bearer(data):
    return {"authorization": "Bearer " + data["token"]}


async def test_profile_requires_valid_identity_and_dev_login_is_stable(repository):
    async with client_for(repository) as (client, app):
        unauth = await client.get("/api/v1/user/profile")
        assert unauth.status_code == 401
        a, again, b = await login(client), await login(client), await login(client, "b")
        assert a["user"]["id"] == again["user"]["id"] != b["user"]["id"]
        assert a["user"]["is_test"] is True and a["expires_in"] > 0
        result = await client.get("/api/v1/user/profile", headers=bearer(a))
        assert result.json()["data"] == a["user"]
        assert (await client.get("/api/v1/user/profile", headers={"authorization": "Bearer invalid"})).status_code == 401


@pytest.mark.parametrize("changes,remote", [({"dev_login_enabled": False}, "127.0.0.1"), ({}, "192.0.2.1"),
    ({"app_env": "production", "dev_login_enabled": False}, "127.0.0.1")])
async def test_dev_login_disabled_remote_or_production_is_hidden(repository, changes, remote):
    async with client_for(repository, remote=remote, **changes) as (client, app):
        result = await client.post("/api/v1/user/dev-login", json={"account": "a"})
        assert result.status_code == 404


async def test_profile_update_trims_and_persists(repository):
    async with client_for(repository) as (client, app):
        a = await login(client)
        profile = await client.put("/api/v1/user/profile", json={"nickname": "  小明  ", "avatar_url": "https://example.org/avatar.png"}, headers=bearer(a))
        assert profile.status_code == 200
        assert profile.json()["data"]["nickname"] == "小明"
        profile2 = await client.get("/api/v1/user/profile", headers=bearer(a))
        assert profile2.json()["data"] == profile.json()["data"]


@pytest.mark.parametrize("nickname,avatar", [(" ", ""), ("a" * 101, ""), ("a\nb", ""), ("a\x00b", ""),
    ("name", "javascript:alert(1)"), ("name", "http://example.org/a"), ("name", "https://user:pass@example.org/a"),
    ("name", "https://example.org/" + "a" * 500)])
async def test_profile_rejects_unsafe_fields(repository, nickname, avatar):
    async with client_for(repository) as (client, app):
        result = await client.put("/api/v1/user/profile", json={"nickname": nickname, "avatar_url": avatar}, headers=bearer(await login(client)))
        assert result.status_code == 422 and result.json()["data"] is None


async def test_profile_put_cors_and_body_cap(repository):
    async with client_for(repository, max_body_bytes=100) as (client, app):
        result = await client.put("/api/v1/user/profile", content="x" * 101)
        assert result.status_code == 413
        cors = await client.options("/api/v1/user/profile", headers={"origin": "http://localhost:10086", "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type"})
        assert cors.status_code == 200
        assert "PUT" in cors.headers["access-control-allow-methods"]


async def test_login_has_own_quota_independent_of_ai(repository):
    async with client_for(repository, rate_limit_requests=1) as (client, app):
        await login(client)
        assert (await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})).status_code == 200
        codes = []
        for _ in range(35):
            codes.append((await client.post("/api/v1/user/dev-login", json={"account": "a"})).status_code)
        assert 429 in codes


async def test_auth_quiz_saved_history_replay_and_server_scoring(repository):
    provider = SequenceProvider(quiz_content(), report_text())
    async with client_for(repository, provider=provider) as (client, app):
        a, b = await login(client), await login(client, "b")
        headers = bearer(a)
        generated = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=headers)
        assert generated.status_code == 200
        assert generated.headers["x-learning-user"] == a["user"]["id"]
        quiz = generated.json()["data"]
        history = await client.get("/api/v1/user/quizzes?status=pending", headers=headers)
        assert history.status_code == 200
        assert history.json()["data"]["items"][0]["quiz_id"] == quiz["quiz_id"]
        other = await client.get("/api/v1/user/quizzes/" + quiz["quiz_id"], headers=bearer(b))
        assert other.status_code == 404
        payload = {**report_request(), "quiz_id": quiz["quiz_id"], "questions": quiz["questions"]}
        first = await client.post("/api/v1/report/generate", json=payload, headers=headers)
        replay = await client.post("/api/v1/report/generate", json=payload, headers=headers)
        assert first.status_code == replay.status_code == 200
        assert first.headers["x-learning-user"] == a["user"]["id"]
        assert first.json()["data"] == replay.json()["data"]
        assert first.json()["data"]["xp"] == 50
        assert provider.calls == 2
        detail = await client.get("/api/v1/user/quizzes/" + quiz["quiz_id"], headers=headers)
        assert detail.json()["data"]["quiz"] == quiz
        assert detail.json()["data"]["report"] == first.json()["data"]
        assert all(r["is_correct"] for r in detail.json()["data"]["answer_records"])
        profile = await client.get("/api/v1/user/profile", headers=headers)
        assert profile.json()["data"]["total_xp"] == 50
        payload["answer_records"][0]["selected_answers"] = ["B"]
        conflict = await client.post("/api/v1/report/generate", json=payload, headers=headers)
        assert conflict.status_code == 409
        assert provider.calls == 2


async def test_auth_report_rejects_unknown_other_user_and_mutated_questions(repository):
    provider = SequenceProvider(quiz_content())
    async with client_for(repository, provider=provider) as (client, app):
        a, b = await login(client), await login(client, "b")
        payload = report_request()
        unknown = await client.post("/api/v1/report/generate", json=payload, headers=bearer(a))
        assert unknown.status_code == 404
        quiz = (await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=bearer(a))).json()["data"]
        payload.update(quiz_id=quiz["quiz_id"], questions=quiz["questions"])
        other = await client.post("/api/v1/report/generate", json=payload, headers=bearer(b))
        assert other.status_code == 404
        payload["questions"][0]["answer"] = ["B"]
        mutated = await client.post("/api/v1/report/generate", json=payload, headers=bearer(a))
        assert mutated.status_code == 422
        assert provider.calls == 1


async def test_db_failure_does_not_block_guests_or_health_and_auth_never_reports_save_success():
    settings = Settings(_env_file=None, mysql_host="127.0.0.1", mysql_port=1, mysql_user="missing", mysql_database="missing", jwt_secret="s" * 64)
    from app.core.identity import create_token
    token = create_token(settings, "1", is_test=False)
    app = create_app(settings, SequenceProvider(quiz_content(), quiz_content(), report_text()), knowledge_service=FixedKnowledge())
    async with app.router.lifespan_context(app):
        assert app.state.database._pool is None
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.get("/api/v1/health")).status_code == 200
            assert (await client.post("/api/v1/quiz/generate", json={"user_input": "Python"})).status_code == 200
            assert app.state.database._pool is None
            authenticated = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers={"authorization": "Bearer " + token})
            assert authenticated.status_code == 503 and authenticated.json()["data"] is None
            invalid = await client.post("/api/v1/report/generate", json=report_request(), headers={"authorization": "Bearer invalid"})
            assert invalid.status_code == 200
            assert "x-learning-user" not in invalid.headers


async def test_authenticated_save_header_is_exposed_and_guest_has_none(repository):
    async with client_for(repository, provider=SequenceProvider(quiz_content(), quiz_content())) as (client, app):
        headers = {**bearer(await login(client)), "origin": "http://localhost:10086"}
        response = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=headers)
        assert "x-learning-user" in response.headers
        assert "x-learning-user" in response.headers.get("access-control-expose-headers", "").lower()
        guest = await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers={"authorization": "Bearer invalid"})
        assert guest.status_code == 200 and "x-learning-user" not in guest.headers


async def test_concurrent_reports_return_one_canonical_result_without_duplicate_model_calls(repository):
    provider = SequenceProvider(quiz_content(), report_text())
    async with client_for(repository, provider=provider) as (client, app):
        a = await login(client)
        quiz = (await client.post("/api/v1/quiz/generate", json={"user_input": "Python"}, headers=bearer(a))).json()["data"]
        payload = {**report_request(), "quiz_id": quiz["quiz_id"], "questions": quiz["questions"]}
        results = await asyncio.gather(*(client.post("/api/v1/report/generate", json=payload, headers=bearer(a)) for _ in range(6)))
        assert all(result.status_code == 200 for result in results)
        assert all(result.json() == results[0].json() for result in results)
        assert provider.calls == 2
        assert (await client.get("/api/v1/user/profile", headers=bearer(a))).json()["data"]["total_xp"] == 50


async def test_wechat_login_http_boundary_and_mysql_identity_are_connected(repository):
    from app.services.identity import WechatIdentityProvider
    async def upstream(request):
        return httpx.Response(200, json={"openid": "wx-real-person", "session_key": "private"})
    provider = WechatIdentityProvider(Settings(_env_file=None, wechat_app_id="appid", wechat_app_secret="secret"), transport=httpx.MockTransport(upstream))
    try:
        async with client_for(repository, identity_provider=provider) as (client, app):
            results = await asyncio.gather(*(client.post("/api/v1/user/login", json={"code": "unique-code-" + str(i)}) for i in range(8)))
            assert all(result.status_code == 200 for result in results)
            assert len({result.json()["data"]["user"]["id"] for result in results}) == 1
            assert results[0].json()["data"]["user"]["is_test"] is False
            assert not provider.client.is_closed
        assert not provider.client.is_closed  # Injected provider remains owned by the caller.
    finally:
        await provider.aclose()


async def test_missing_jwt_configuration_does_not_consume_wechat_code(repository):
    class IdentityProvider:
        async def exchange(self, code):
            pytest.fail("A one-use WeChat code must not be consumed when token issuance is unavailable")
    async with client_for(repository, jwt_secret=None, identity_provider=IdentityProvider()) as (client, app):
        response = await client.post("/api/v1/user/login", json={"code": "fresh-code"})
        assert response.status_code == 503


async def test_disabled_dev_login_is_unregistered_even_for_malformed_payload(repository):
    async with client_for(repository, dev_login_enabled=False) as (client, app):
        response = await client.post("/api/v1/user/dev-login", json={})
        assert response.status_code == 404
        response = await client.post("/api/v1/user/dev-login", content="{", headers={"content-type": "application/json"})
        assert response.status_code == 404
