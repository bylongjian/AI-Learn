import logging
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.formparsers import MultiPartException
from app.core.config import Settings
from app.core.limiter import RateLimiter
from app.core.responses import error_response

logger = logging.getLogger(__name__)
GENERATION_PATHS = {"/api/v1/quiz/generate", "/api/v1/report/generate"}
LOGIN_PATHS = {"/api/v1/user/login", "/api/v1/user/dev-login"}
UPLOAD_PATH = "/api/v1/knowledge/documents"


class RequestGuardMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings):
        self.app, self.settings = app, settings
        self.limiter = RateLimiter(settings.rate_limit_requests, settings.rate_limit_window_seconds, settings.rate_limit_max_clients)
        self.login_limiter = RateLimiter(30, 60, settings.rate_limit_max_clients)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        upload_overflow = False
        if scope["method"] in {"POST", "PUT"}:
            login_path = scope["path"] in LOGIN_PATHS and (scope["path"] != "/api/v1/user/dev-login" or self.settings.dev_login_enabled)
            limiter = self.limiter if scope["path"] in GENERATION_PATHS or scope["path"] == UPLOAD_PATH else self.login_limiter if login_path else None
            if limiter is not None:
                ip = scope["client"][0] if scope.get("client") else "unknown"
                if not limiter.allow(ip):
                    await error_response(42901, "请求较多，请稍后重试", 429)(scope, receive, send)
                    return
            if scope["path"] == UPLOAD_PATH:
                original_receive = receive
                received = 0
                async def limited_receive():
                    nonlocal received, upload_overflow
                    message = await original_receive()
                    received += len(message.get('body',b''))
                    if received > 11 * 1024 * 1024:
                        upload_overflow = True
                        # The multipart parser closes its spooled files for this exception.
                        raise MultiPartException('Upload too large')
                    return message
                receive = limited_receive
            else:
                body = bytearray()
                while True:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        return
                    body.extend(message.get("body", b""))
                    if len(body) > self.settings.max_body_bytes:
                        await error_response(41301, "请求内容过大，请缩短后重试", 413)(scope, receive, send)
                        return
                    if not message.get("more_body", False):
                        break
                sent = False
                original_receive = receive
                async def replay():
                    nonlocal sent
                    if not sent:
                        sent = True
                        return {"type": "http.request", "body": bytes(body), "more_body": False}
                    return await original_receive()
                receive = replay
        started = False

        async def track_send(message):
            nonlocal started
            if upload_overflow:
                if message["type"] == "http.response.start":
                    started = True
                    await error_response(41301,"上传请求过大，请选择 10MB 以内的文件",413)(scope,receive,send)
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, track_send)
        except Exception as exc:
            logger.error("request failed; category=%s", type(exc).__name__)
            if started:
                raise
            await error_response(50001, "服务暂时异常，请重试", 500)(scope, receive, send)
