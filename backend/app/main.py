from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from app.core.config import Settings
from app.core.content import ContentGuard
from app.core.errors import AppError
from app.core.middleware import RequestGuardMiddleware
from app.core.responses import error_response
from app.llm.generation import Provider, ReliableGenerator
from app.llm.provider import DeepSeekProvider
from app.routes.api import router
from app.services.quiz import QuizService
from app.services.report import ReportService


def create_app(settings: Settings | None = None, provider: Provider | None = None) -> FastAPI:
    settings = settings if settings is not None else Settings()
    owned_provider = DeepSeekProvider(settings) if provider is None else None

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            if owned_provider is not None:
                await owned_provider.aclose()

    app = FastAPI(title="学习咩 API", version="0.1.0", lifespan=lifespan)
    guard = ContentGuard(settings.blocked_terms)
    generator = ReliableGenerator(provider if provider is not None else owned_provider, settings, guard)
    app.state.quiz_service = QuizService(generator, guard)
    app.state.report_service = ReportService(generator, guard)

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        return error_response(exc.code, exc.message, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return error_response(42201, "请求格式或内容不正确，请检查后重试", 422)

    @app.exception_handler(HTTPException)
    async def http_handler(request: Request, exc: HTTPException):
        messages = {404: "接口不存在", 405: "请求方法不支持"}
        return error_response(exc.status_code * 100, messages.get(exc.status_code, "请求未能完成"), exc.status_code)

    app.include_router(router)
    app.add_middleware(RequestGuardMiddleware, settings=settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["content-type"])
    return app


app = create_app()
