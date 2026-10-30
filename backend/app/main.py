from contextlib import asynccontextmanager
from weakref import WeakValueDictionary

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.cors import CORSMiddleware
from app.core.config import Settings
from app.core.content import ContentGuard
from app.core.errors import AppError, TopicClarification
from app.core.middleware import RequestGuardMiddleware
from app.core.responses import error_response
from app.llm.generation import Provider, ReliableGenerator
from app.llm.provider import DeepSeekProvider
from app.routes.api import router
from app.routes.user import router as user_router, dev_router
from app.services.identity import WechatIdentityProvider
from app.storage import Database, UserRepository
from app.services.quiz import QuizService
from app.services.report import ReportService
from app.repositories.knowledge import KnowledgeRepository
from app.services.documents import DocumentService
from app.services.vectors import VectorStore
from app.routes.knowledge import router as knowledge_router
from app.services.rag import RagService


def create_app(settings: Settings | None = None, provider: Provider | None = None, *, identity_provider=None, repository=None, knowledge_service=None, documents_service=None) -> FastAPI:
    settings = settings if settings is not None else Settings()
    owned_provider = DeepSeekProvider(settings) if provider is None else None
    database = Database(settings) if repository is None else repository.database
    owned_identity = WechatIdentityProvider(settings) if identity_provider is None else None
    documents = documents_service or DocumentService(settings,KnowledgeRepository(database),VectorStore(settings))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            if documents_service is None:
                documents.start()
            yield
        finally:
            try:
                if documents_service is None:
                    await documents.aclose()
                if repository is None:
                    await database.close()
            finally:
                try:
                    if owned_identity is not None:
                        await owned_identity.aclose()
                finally:
                    if owned_provider is not None:
                        await owned_provider.aclose()

    app = FastAPI(title="学习咩 API", version="0.1.0", lifespan=lifespan)
    guard = ContentGuard(settings.blocked_terms)
    generator = ReliableGenerator(provider if provider is not None else owned_provider, settings, guard)
    rag = RagService(settings,generator,documents.vectors,model=owned_provider.llm if owned_provider is not None else None)
    app.state.quiz_service = QuizService(generator, guard, knowledge_service,rag=rag)
    app.state.report_service = ReportService(generator, guard)
    app.state.settings = settings
    app.state.database = database
    app.state.user_repository = repository if repository is not None else UserRepository(database)
    app.state.identity_provider = identity_provider if identity_provider is not None else owned_identity
    app.state.report_locks = WeakValueDictionary()
    app.state.documents = documents

    @app.exception_handler(TopicClarification)
    async def clarification_handler(request: Request, exc: TopicClarification):
        return JSONResponse(status_code=409, content={"code": exc.code, "message": exc.message, "data": {"options": exc.options}})

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
    app.include_router(user_router)
    app.include_router(knowledge_router)
    if settings.dev_login_enabled and settings.app_env == "development":
        app.include_router(dev_router)
    app.add_middleware(RequestGuardMiddleware, settings=settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["content-type", "authorization"],
                       expose_headers=["X-Learning-User"])
    return app


app = create_app()
