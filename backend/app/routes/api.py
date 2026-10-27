import asyncio
from fastapi import APIRouter, Depends, Request, Response
from app.core.errors import AppError
from app.core.identity import Identity
from app.routes.user import optional_identity
from app.storage import canonical_records, selections
from app.models.quiz import QuizRequest
from app.models.report import ReportRequest

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health():
    return {"code": 0, "message": "ok", "data": {"status": "ok"}}


@router.post("/quiz/generate")
async def generate_quiz(payload: QuizRequest, request: Request, response: Response, identity: Identity | None = Depends(optional_identity)):
    quiz = await request.app.state.quiz_service.generate(payload)
    if identity is not None:
        await request.app.state.user_repository.save_quiz(identity.user_id, quiz)
        response.headers["X-Learning-User"] = identity.user_id
    return {"code": 0, "message": "ok", "data": quiz.model_dump()}


@router.post("/report/generate")
async def generate_report(payload: ReportRequest, request: Request, response: Response, identity: Identity | None = Depends(optional_identity)):
    if identity is not None:
        # Serialize requests within this process without retaining completed quiz locks.
        # MySQL row locking and unique constraints also protect independent workers.
        key = (identity.user_id, payload.quiz_id)
        locks = request.app.state.report_locks
        lock = locks.setdefault(key, asyncio.Lock())
        async with lock:
            detail = await request.app.state.user_repository.get_quiz(identity.user_id, payload.quiz_id)
            if [q.model_dump() for q in payload.questions] != detail["quiz"]["questions"]:
                raise AppError(42202, "题目与已保存的练习不一致，请重新打开练习", 422)
            canonical = ReportRequest(**{**payload.model_dump(), "questions": detail["quiz"]["questions"], "topic": detail["quiz"]["title"]})
            if detail["report"] is not None:
                if selections(detail["answer_records"]) != selections(canonical_records(canonical)):
                    raise AppError(40901, "该练习已提交，请查看已保存的报告", 409)
                result = detail["report"]
            else:
                report = await request.app.state.report_service.generate(canonical)
                result = await request.app.state.user_repository.save_result(identity.user_id, canonical, report)
            response.headers["X-Learning-User"] = identity.user_id
            return {"code": 0, "message": "ok", "data": result}
    report = await request.app.state.report_service.generate(payload)
    return {"code": 0, "message": "ok", "data": report.model_dump()}
