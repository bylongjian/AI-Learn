"""Explicitly opt-in paid acceptance: 10 quizzes and 10 matching reports."""
import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from time import monotonic

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings
from app.models.quiz import Quiz
from app.models.report import Report, ReportRequest
from app.services.scoring import score_answers


def _record_progress(path: Path | None, event: dict) -> None:
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"timestamp": datetime.now(timezone.utc).isoformat(), **event}
        line = json.dumps(record, ensure_ascii=True)
        with path.open("a", encoding="utf-8") as output:
            output.write(line + "\n")
        print(line, flush=True)


@contextmanager
def _acceptance_stage(path: Path | None, context: dict, name: str):
    start = monotonic()
    state = {"start": start, "reason": "request_failed", "passed": {}}
    _record_progress(path, {**context, "stage": name, "status": "started"})
    try:
        yield state
    except Exception as exc:
        reason = "timeout" if isinstance(exc, (TimeoutError, httpx.TimeoutException)) else state["reason"]
        metadata = {key: state[key] for key in ("http_status", "code") if key in state}
        _record_progress(path, {**context, "stage": name, "status": "failed", "reason": reason,
                                "elapsed_seconds": round(monotonic() - start, 3), **metadata})
        raise
    else:
        _record_progress(path, {**context, "stage": name, "status": "passed",
                                "elapsed_seconds": round(monotonic() - start, 3), **state["passed"]})


def _response_envelope(response: httpx.Response, state: dict) -> dict:
    state["http_status"] = response.status_code
    state["reason"] = "invalid_json"
    envelope = response.json()
    state["reason"] = "invalid_envelope"
    if not isinstance(envelope, dict):
        raise RuntimeError("Response envelope must be an object")
    code = envelope.get("code")
    state["code"] = code if type(code) is int else None
    state["reason"] = "http_or_business_error"
    if response.status_code != 200 or code != 0:
        raise RuntimeError(f"Generation failed: code={state['code']}")
    return envelope


async def run_acceptance(client: httpx.AsyncClient, *, progress_log: Path | None = None) -> dict[str, int]:
    run_id = datetime.now(timezone.utc).isoformat()
    topics = ["Python 列表与元组", "Python 字典", "HTTP 请求与响应", "SQL 基础", "Git 分支",
              "函数参数", "时间复杂度", "CSS 盒模型", "异步编程", "单元测试基础"]
    for index, topic in enumerate(topics):
        count = 3 + index % 3
        difficulty = ["easy", "medium", "hard", "mixed"][index % 4]
        context = {"run_id": run_id, "group": index + 1, "requested_count": count, "requested_difficulty": difficulty}
        with _acceptance_stage(progress_log, context, "quiz") as state:
            response = await client.post("/api/v1/quiz/generate", json={
                "user_input": topic, "question_count": count, "difficulty": difficulty})
            envelope = _response_envelope(response, state)
            state["reason"] = "latency_exceeded"
            if monotonic() - state["start"] >= 50:
                raise RuntimeError("Quiz exceeded the acceptance latency bound")
            state["reason"] = "invalid_schema"
            quiz = Quiz.model_validate(envelope.get("data"))
            types = [question.type for question in quiz.questions]
            state["reason"] = "distribution_mismatch"
            if len(types) != count or types.count("single") != count - 2 or types.count("multiple") != 1 or types.count("judge") != 1:
                raise RuntimeError("Quiz distribution differs from request")
            state["reason"] = "difficulty_mismatch"
            if difficulty != "mixed" and any(question.difficulty != difficulty for question in quiz.questions):
                raise RuntimeError("Quiz difficulty differs from request")
            state["passed"] = {"actual_count": len(types), "actual_types": types,
                               "actual_difficulties": [q.difficulty for q in quiz.questions]}
        with _acceptance_stage(progress_log, context, "report") as state:
            state["reason"] = "invalid_schema"
            request = ReportRequest(quiz_id=quiz.quiz_id, topic=quiz.title, questions=quiz.questions,
                answer_records=[{"question_id": q.id, "selected_answers": q.answer if i % 2 == 0 else [],
                                 "is_correct": False, "duration_ms": 1000.0}
                                for i, q in enumerate(quiz.questions)])
            state["reason"] = "request_failed"
            response = await client.post("/api/v1/report/generate", json=request.model_dump())
            envelope = _response_envelope(response, state)
            state["reason"] = "latency_exceeded"
            if monotonic() - state["start"] >= 50:
                raise RuntimeError("Report exceeded the acceptance latency bound")
            state["reason"] = "invalid_schema"
            report = Report.model_validate(envelope.get("data"))
            expected = score_answers(request).model_dump()
            state["reason"] = "statistics_mismatch"
            if report.quiz_id != quiz.quiz_id or any(getattr(report, key) != value for key, value in expected.items()):
                raise RuntimeError("Report disagrees with deterministic scoring")
            state["passed"] = {"accuracy": report.accuracy, "correct": report.correct, "total": report.total}
    _record_progress(progress_log, {"run_id": run_id, "stage": "run", "status": "complete", "quizzes": len(topics), "reports": len(topics)})
    return {"quizzes": len(topics), "reports": len(topics)}


def main(argv: list[str] | None = None, settings: Settings | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-live", action="store_true", help="Authorize 20 paid model generations")
    parser.add_argument("--progress-log", type=Path, default=Path(__file__).resolve().parents[1] / ".qa" / "live-progress.jsonl")
    args = parser.parse_args(argv)
    if not args.run_live:
        print("未执行；显式传入 --run-live 才会调用付费模型。")
        return 2
    settings = settings if settings is not None else Settings()
    if settings.deepseek_api_key is None or not settings.deepseek_api_key.get_secret_value().strip():
        print("未执行；请先在后端 .env 配置 DEEPSEEK_API_KEY。")
        return 2
    from app.main import create_app

    async def run():
        app = create_app(settings)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://acceptance", timeout=50) as client:
                return await run_acceptance(client, progress_log=args.progress_log)

    try:
        result = asyncio.run(run())
    except Exception as exc:
        print(f"验收失败（{type(exc).__name__}）；请检查后端安全错误分类日志。")
        return 1
    print(f"验收通过：{result['quizzes']} 组题目、{result['reports']} 份报告。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
