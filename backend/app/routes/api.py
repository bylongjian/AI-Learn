from fastapi import APIRouter, Request
from app.models.quiz import QuizRequest
from app.models.report import ReportRequest

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health():
    return {"code": 0, "message": "ok", "data": {"status": "ok"}}


@router.post("/quiz/generate")
async def generate_quiz(payload: QuizRequest, request: Request):
    quiz = await request.app.state.quiz_service.generate(payload)
    return {"code": 0, "message": "ok", "data": quiz.model_dump()}


@router.post("/report/generate")
async def generate_report(payload: ReportRequest, request: Request):
    report = await request.app.state.report_service.generate(payload)
    return {"code": 0, "message": "ok", "data": report.model_dump()}
