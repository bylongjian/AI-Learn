from typing import Literal
import ipaddress

from fastapi import APIRouter, Depends, Query, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import AppError
from app.core.identity import Identity, create_token, read_token, require_token_configuration
from app.models.user import DevLoginRequest, LoginRequest, ProfileUpdate

router = APIRouter(prefix="/api/v1/user")
dev_router = APIRouter(prefix="/api/v1/user")
bearer = HTTPBearer(auto_error=False)


async def optional_identity(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    return read_token(request.app.state.settings, credentials.credentials) if credentials else None


async def required_identity(identity: Identity | None = Depends(optional_identity)):
    if identity is None:
        raise AppError(40101, "请重新登录", 401)
    return identity


def success(data):
    return {"code": 0, "message": "ok", "data": data}


async def login_response(request, openid):
    settings = request.app.state.settings
    # Validate token configuration before creating a persistent user.
    require_token_configuration(settings)
    user = await request.app.state.user_repository.upsert_user(openid)
    token = create_token(settings, user["id"], is_test=user["is_test"])
    return success({"token": token, "expires_in": settings.jwt_expire_seconds, "user": user})


@router.post("/login")
async def login(payload: LoginRequest, request: Request):
    require_token_configuration(request.app.state.settings)
    openid = await request.app.state.identity_provider.exchange(payload.code)
    return await login_response(request, openid)


@dev_router.post("/dev-login")
async def dev_login(payload: DevLoginRequest, request: Request):
    settings = request.app.state.settings
    try:
        loopback = request.client is not None and ipaddress.ip_address(request.client.host).is_loopback
    except ValueError:
        loopback = False
    if not settings.dev_login_enabled or settings.app_env != "development" or not loopback:
        raise AppError(40400, "接口不存在", 404)
    return await login_response(request, "dev:" + payload.account)


@router.get("/profile")
async def profile(request: Request, identity: Identity = Depends(required_identity)):
    user = await request.app.state.user_repository.get_profile(identity.user_id)
    if request.app.state.settings.app_env == "production" and user["is_test"]:
        raise AppError(40101, "请重新登录", 401)
    return success(user)


@router.put("/profile")
async def update_profile(payload: ProfileUpdate, request: Request, identity: Identity = Depends(required_identity)):
    return success(await request.app.state.user_repository.update_profile(identity.user_id, payload.nickname, payload.avatar_url))


@router.get("/quizzes")
async def quizzes(request: Request, identity: Identity = Depends(required_identity), page: int = Query(1, ge=1),
                  page_size: int = Query(10, ge=1, le=50), search: str = Query("", max_length=100),
                  status: Literal["all", "pending", "completed"] = "all"):
    return success(await request.app.state.user_repository.list_quizzes(identity.user_id, page, page_size, search.strip(), status))


@router.get("/quizzes/{quiz_id}")
async def quiz_detail(quiz_id: str, request: Request, identity: Identity = Depends(required_identity)):
    return success(await request.app.state.user_repository.get_quiz(identity.user_id, quiz_id))
