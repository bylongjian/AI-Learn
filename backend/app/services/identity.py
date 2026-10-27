"""WeChat code exchange; credentials enter the wire transport, never HTTPX URL logs."""
import asyncio
import unicodedata
import httpx

from app.core.config import Settings
from app.core.errors import AppError


class _CredentialTransport(httpx.AsyncBaseTransport):
    def __init__(self, transport=None):
        self.transport = transport

    async def handle_async_request(self, request):
        if self.transport is None:
            self.transport = httpx.AsyncHTTPTransport(retries=0)
        extensions = dict(request.extensions)
        parameters = extensions.pop("wechat_parameters")
        wire_request = httpx.Request(request.method, request.url.copy_merge_params(parameters),
                                     headers=request.headers, stream=request.stream, extensions=extensions)
        return await self.transport.handle_async_request(wire_request)

    async def aclose(self):
        if self.transport is not None:
            await self.transport.aclose()


class WechatIdentityProvider:
    def __init__(self, settings: Settings, *, transport=None):
        self.settings = settings
        self.client = httpx.AsyncClient(transport=_CredentialTransport(transport), timeout=5, follow_redirects=False)

    async def exchange(self, code: str) -> str:
        if (not self.settings.wechat_app_id or not self.settings.wechat_app_secret
                or not self.settings.wechat_app_secret.get_secret_value()):
            raise AppError(50302, "微信登录尚未配置", 503)
        try:
            async with asyncio.timeout(5):
                response = await self.client.get("https://api.weixin.qq.com/sns/jscode2session", extensions={"wechat_parameters": {
                    "appid": self.settings.wechat_app_id, "secret": self.settings.wechat_app_secret.get_secret_value(),
                    "js_code": code, "grant_type": "authorization_code",
                }})
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError, TimeoutError):
            raise AppError(50304, "微信登录暂时不可用，请重新获取登录凭证后重试", 503) from None
        if not isinstance(payload, dict):
            raise AppError(50304, "微信登录响应异常，请重新登录", 503)
        if payload.get("errcode") not in (None, 0):
            if payload.get("errcode") in (40029, 40163, 40226):
                raise AppError(40102, "登录凭证无效，请重新登录", 401)
            raise AppError(50304, "微信登录暂时不可用，请重新登录", 503)
        openid = payload.get("openid")
        session_key = payload.get("session_key")
        if (not isinstance(openid, str) or not openid.strip() or len(openid) > 255 or openid.startswith("dev:")
                or any(c.isspace() or unicodedata.category(c).startswith("C") for c in openid)
                or not isinstance(session_key, str) or not session_key.strip()):
            raise AppError(50304, "微信登录响应异常，请重新登录", 503)
        return openid

    async def aclose(self):
        await self.client.aclose()
