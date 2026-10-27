import importlib.util
import logging
import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.core.errors import AppError


def provider_module():
    assert importlib.util.find_spec("app.services.identity") is not None, "WeChat login provider is missing"
    from app.services import identity
    return identity


async def test_wechat_code_exchange_uses_server_credentials_once_and_logs_no_secrets(caplog):
    identity = provider_module()
    requests = []
    async def upstream(request):
        requests.append(request)
        assert request.url.params["appid"] == "appid"
        assert request.url.params["secret"] == "private-app-secret"
        assert request.url.params["js_code"] == "one-use-code"
        assert request.url.params["grant_type"] == "authorization_code"
        return httpx.Response(200, json={"openid": "wx-person", "session_key": "private-session-key", "errcode": 0})
    provider = identity.WechatIdentityProvider(Settings(_env_file=None, wechat_app_id="appid", wechat_app_secret="private-app-secret"), transport=httpx.MockTransport(upstream))
    with caplog.at_level(logging.DEBUG):
        assert await provider.exchange("one-use-code") == "wx-person"
    await provider.aclose()
    assert len(requests) == 1
    assert "private-app-secret" not in caplog.text and "private-session-key" not in caplog.text
    assert "one-use-code" not in caplog.text


@pytest.mark.parametrize("response,status", [
    ({"errcode": 40029, "errmsg": "private upstream details"}, 401),
    ({"errcode": -1, "errmsg": "private upstream details"}, 503),
    ({"openid": 1, "session_key": "private-session-key"}, 503),
    ({"openid": "", "session_key": "private-session-key"}, 503),
    ({"openid": "wx-person"}, 503),
    ({"openid": "wx-person", "session_key": ""}, 503),
    ({"openid": "wx\ninvalid", "session_key": "private-session-key"}, 503),
    ({"openid": "dev:a", "session_key": "private-session-key"}, 503),
    ({"session_key": "private-session-key"}, 503),
    ([], 503),
])
async def test_wechat_errors_are_safe_and_never_reuse_code(response, status):
    identity = provider_module()
    calls = 0
    async def upstream(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=response)
    provider = identity.WechatIdentityProvider(Settings(_env_file=None, wechat_app_id="appid", wechat_app_secret="private-app-secret"), transport=httpx.MockTransport(upstream))
    with pytest.raises(AppError) as exc:
        await provider.exchange("code")
    await provider.aclose()
    assert exc.value.status_code == status
    assert "private" not in exc.value.message
    assert calls == 1


@pytest.mark.parametrize("mode", ["timeout", "html", "http-error"])
async def test_wechat_timeout_malformed_and_http_errors_are_safe(mode):
    identity = provider_module()
    calls = 0
    async def upstream(request):
        nonlocal calls
        calls += 1
        if mode == "timeout":
            raise httpx.ReadTimeout("private URL", request=request)
        return httpx.Response(200 if mode == "html" else 502, text="private HTML")
    provider = identity.WechatIdentityProvider(Settings(_env_file=None, wechat_app_id="appid", wechat_app_secret="private-app-secret"), transport=httpx.MockTransport(upstream))
    assert provider.client.timeout.read <= 5
    with pytest.raises(AppError) as exc:
        await provider.exchange("code")
    await provider.aclose()
    assert exc.value.status_code == 503 and "private" not in str(exc.value)
    assert calls == 1


async def test_unconfigured_wechat_fails_without_external_request():
    identity = provider_module()
    provider = identity.WechatIdentityProvider(Settings(_env_file=None))
    with pytest.raises(AppError) as exc:
        await provider.exchange("code")
    await provider.aclose()
    assert exc.value.status_code == 503


async def test_unconfigured_provider_creates_no_network_transport():
    identity = provider_module()
    provider = identity.WechatIdentityProvider(Settings(_env_file=None))
    assert provider.client._transport.transport is None
    await provider.aclose()


async def test_wechat_entire_exchange_has_a_bounded_total_timeout():
    identity = provider_module()
    async def upstream(request):
        await asyncio.sleep(6)
        return httpx.Response(200, json={"openid": "wx-person", "session_key": "key"})
    provider = identity.WechatIdentityProvider(Settings(_env_file=None, wechat_app_id="appid", wechat_app_secret="private-app-secret"), transport=httpx.MockTransport(upstream))
    try:
        with pytest.raises(AppError) as exc:
            await asyncio.wait_for(provider.exchange("code"), timeout=5.5)
        assert exc.value.status_code == 503
    finally:
        await provider.aclose()
