import json

import pytest

from app.core.config import Settings
from app.core.middleware import RequestGuardMiddleware


async def call_middleware(app, *, messages=None, scope=None, **settings):
    incoming = iter(messages or [{"type": "http.request", "body": b"{}", "more_body": False}])
    outgoing = []

    async def receive():
        return next(incoming, {"type": "http.disconnect"})

    async def send(message):
        outgoing.append(message)

    await RequestGuardMiddleware(app, Settings(_env_file=None, **settings))(
        scope or {"type": "http", "method": "POST", "path": "/api/v1/quiz/generate"}, receive, send
    )
    return outgoing


async def test_buffered_body_preserves_following_disconnect():
    received = []

    async def downstream(scope, receive, send):
        received.append(await receive())
        received.append(await receive())

    outgoing = await call_middleware(downstream, messages=[
        {"type": "http.request", "body": b'{"x":', "more_body": True},
        {"type": "http.request", "body": b'1}', "more_body": False},
        {"type": "http.disconnect"},
    ])
    assert received == [{"type": "http.request", "body": b'{"x":1}', "more_body": False},
                        {"type": "http.disconnect"}]
    assert outgoing == []


async def test_chunked_body_cap_cannot_be_bypassed():
    async def downstream(scope, receive, send):
        pytest.fail("Oversized request must not reach routes")

    outgoing = await call_middleware(downstream, max_body_bytes=4, messages=[
        {"type": "http.request", "body": b"123", "more_body": True},
        {"type": "http.request", "body": b"45", "more_body": False},
    ])
    assert outgoing[0]["status"] == 413
    assert json.loads(outgoing[1]["body"])["data"] is None


async def test_disconnect_during_body_does_not_call_routes():
    async def downstream(scope, receive, send):
        pytest.fail("Disconnected request must not reach routes")

    assert await call_middleware(downstream, messages=[{"type": "http.disconnect"}]) == []


async def test_non_http_scope_passes_through():
    seen = []

    async def downstream(scope, receive, send):
        seen.append(scope["type"])

    assert await call_middleware(downstream, scope={"type": "lifespan"}) == []
    assert seen == ["lifespan"]


async def test_unexpected_failure_has_safe_envelope_without_sensitive_logs(caplog):
    async def downstream(scope, receive, send):
        raise RuntimeError("secret-key-or-user-input")

    outgoing = await call_middleware(downstream, scope={"type": "http", "method": "GET", "path": "/"})
    assert outgoing[0]["status"] == 500
    assert json.loads(outgoing[1]["body"]) == {"code": 50001, "message": "服务暂时异常，请重试", "data": None}
    assert "secret-key-or-user-input" not in caplog.text


async def test_exception_after_headers_does_not_send_second_response():
    async def downstream(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        raise RuntimeError("stream failed")

    with pytest.raises(RuntimeError, match="stream failed"):
        await call_middleware(downstream)


async def test_non_generation_post_passes_without_consuming_ai_quota():
    received = []

    async def downstream(scope, receive, send):
        received.append(await receive())

    assert await call_middleware(downstream, scope={"type": "http", "method": "POST", "path": "/unknown"}) == []
    assert received[0]["body"] == b"{}"
