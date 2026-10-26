import asyncio
import importlib.util
from pathlib import Path

import httpx
import pytest

from tests.factories import quiz_content, report_text


def load_script():
    path = Path(__file__).parents[1] / "scripts" / "live_acceptance.py"
    assert path.is_file(), "Live acceptance script has not been implemented"
    spec = importlib.util.spec_from_file_location("live_acceptance", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_live_cli_requires_explicit_opt_in_and_key_without_creating_app(capsys):
    from app.core.config import Settings
    script = load_script()
    assert script.main([]) == 2
    assert script.main(["--run-live"], settings=Settings(_env_file=None, deepseek_api_key=None)) == 2
    output = capsys.readouterr().out
    assert "--run-live" in output and "DEEPSEEK_API_KEY" in output


@pytest.mark.parametrize("fail_inside", [False, True], ids=["success", "failure"])
def test_live_entrypoint_closes_owned_sdk_clients_on_success_and_failure(monkeypatch, fail_inside):
    import app.main as app_module
    from app.core.config import Settings

    script = load_script()
    original_create_app = app_module.create_app
    created_apps = []

    def capture_app(settings):
        app = original_create_app(settings)
        created_apps.append(app)
        return app

    async def acceptance_without_network(client, *, progress_log=None):
        llm = created_apps[0].state.quiz_service.generator.provider.llm
        assert not llm.root_client.is_closed() and not llm.root_async_client.is_closed()
        if fail_inside:
            raise RuntimeError("simulated acceptance failure")
        return {"quizzes": 10, "reports": 10}

    monkeypatch.setattr(app_module, "create_app", capture_app)
    monkeypatch.setattr(script, "run_acceptance", acceptance_without_network)
    llm = None
    try:
        code = script.main(["--run-live"], settings=Settings(_env_file=None, deepseek_api_key="dummy-test-key"))
        assert code == (1 if fail_inside else 0)
        llm = created_apps[0].state.quiz_service.generator.provider.llm
        assert llm.root_client.is_closed()
        assert llm.root_async_client.is_closed()
    finally:
        if created_apps:
            llm = created_apps[0].state.quiz_service.generator.provider.llm
            llm.root_client.close()
            if not llm.root_async_client.is_closed():
                asyncio.run(llm.root_async_client.close())


async def test_acceptance_runs_ten_quizzes_and_recalculates_one_report_per_quiz(tmp_path):
    import json
    script = load_script()
    paths = []

    def handler(request):
        import json
        payload = json.loads(request.content)
        paths.append(request.url.path)
        if request.url.path.endswith("quiz/generate"):
            quiz = quiz_content(payload["question_count"])
            for question in quiz["questions"]:
                question["difficulty"] = "easy" if payload["difficulty"] == "mixed" else payload["difficulty"]
            return httpx.Response(200, json={"code": 0, "message": "ok", "data": {
                **quiz, "quiz_id": "quiz-live", "user_input": payload["user_input"], "source_type": "text"}})
        from app.models.report import ReportRequest
        from app.services.scoring import score_answers
        stats = score_answers(ReportRequest.model_validate(payload))
        return httpx.Response(200, json={"code": 0, "message": "ok", "data": {
            **stats.model_dump(), **report_text(), "quiz_id": "quiz-live"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test") as client:
        result = await script.run_acceptance(client, progress_log=tmp_path / "progress.jsonl")
    assert result == {"quizzes": 10, "reports": 10}
    assert paths.count("/api/v1/quiz/generate") == paths.count("/api/v1/report/generate") == 10
    events = [json.loads(line) for line in (tmp_path / "progress.jsonl").read_text(encoding="utf-8").splitlines()]
    assert sum(event["status"] == "passed" and event["stage"] == "quiz" for event in events) == 10
    assert sum(event["status"] == "passed" and event["stage"] == "report" for event in events) == 10
    assert events[-1]["status"] == "complete"
    assert "Question 1" not in (tmp_path / "progress.jsonl").read_text(encoding="utf-8")


async def test_acceptance_does_not_treat_upstream_error_as_success(tmp_path):
    import pytest
    script = load_script()
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503, json={
        "code": 50302, "message": "retry", "data": None})), base_url="http://test") as client:
        with pytest.raises(RuntimeError, match="50302"):
            await script.run_acceptance(client, progress_log=tmp_path / "failure.jsonl")
    import json
    events = [json.loads(line) for line in (tmp_path / "failure.jsonl").read_text(encoding="utf-8").splitlines()]
    assert events[-1]["stage"] == "quiz" and events[-1]["status"] == "failed"
    assert events[-1]["code"] == 50302 and events[-1]["group"] == 1


@pytest.mark.parametrize("stage,failure,reason", [
    (stage, failure, reason)
    for stage in ["quiz", "report"]
    for failure, reason in [("json", "invalid_json"), ("schema", "invalid_schema"),
                            ("envelope", "invalid_envelope"), ("timeout", "timeout"),
                            ("latency", "latency_exceeded")]
] + [("quiz", "distribution", "distribution_mismatch"),
     ("quiz", "difficulty", "difficulty_mismatch"),
     ("report", "statistics", "statistics_mismatch")])
async def test_non_http_stage_failure_is_durable_and_safe(tmp_path, monkeypatch, capsys, stage, failure, reason):
    import json
    from pydantic import ValidationError
    from app.models.report import ReportRequest
    from app.services.scoring import score_answers

    script = load_script()
    requests = []
    late = False
    if failure == "latency":
        monkeypatch.setattr(script, "monotonic", lambda: 55.0 if late else 0.0)

    def handler(request):
        nonlocal late
        requests.append(request.url.path)
        current_stage = "quiz" if request.url.path.endswith("quiz/generate") else "report"
        payload = json.loads(request.content)
        if current_stage == stage:
            if failure == "json":
                return httpx.Response(200, content="PRIVATE_INVALID_JSON")
            if failure == "schema":
                return httpx.Response(200, json={"code": 0, "message": "ok", "data": {"PRIVATE_EXTRA_KEY": "PRIVATE_VALUE"}})
            if failure == "envelope":
                return httpx.Response(200, json=["PRIVATE_INVALID_ENVELOPE"])
            if failure == "timeout":
                raise httpx.ReadTimeout("PRIVATE_TIMEOUT_DETAILS", request=request)
            if failure == "latency":
                late = True
        if current_stage == "quiz":
            count = 4 if current_stage == stage and failure == "distribution" else payload["question_count"]
            quiz = quiz_content(count)
            for question in quiz["questions"]:
                question["difficulty"] = "hard" if current_stage == stage and failure == "difficulty" else payload["difficulty"]
            data = {**quiz, "quiz_id": "quiz-live", "user_input": payload["user_input"], "source_type": "text"}
        else:
            stats = score_answers(ReportRequest.model_validate(payload))
            data = {**stats.model_dump(), **report_text(), "quiz_id": "quiz-live"}
            if current_stage == stage and failure == "statistics":
                data["accuracy"] = 0
        return httpx.Response(200, json={"code": 0, "message": "ok", "data": data})

    log = tmp_path / "progress.jsonl"
    expected_error = {"json": json.JSONDecodeError, "schema": ValidationError,
                      "timeout": httpx.ReadTimeout}.get(failure, RuntimeError)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test") as client:
        with pytest.raises(expected_error):
            await script.run_acceptance(client, progress_log=log)
    events = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert events[-1]["status"] == "failed" and events[-1]["stage"] == stage
    assert events[-1]["reason"] == reason and events[-1]["group"] == 1
    assert events[-1]["elapsed_seconds"] >= 0
    assert len(requests) == (1 if stage == "quiz" else 2)
    assert "PRIVATE_" not in log.read_text(encoding="utf-8") + capsys.readouterr().out
