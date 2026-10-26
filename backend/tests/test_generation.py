import asyncio
import pytest
from tests.factories import quiz_content, report_request, report_text


class SequenceProvider:
    """Only the external model boundary is substituted."""
    def __init__(self, *results):
        self.results, self.calls, self.messages = list(results), 0, []

    async def complete(self, schema, messages):
        self.calls += 1
        self.messages = messages
        result = self.results[min(self.calls - 1, len(self.results) - 1)]
        if isinstance(result, Exception):
            raise result
        if result == "slow":
            await asyncio.sleep(10)
        return result


def components(provider, **settings):
    from app.core.config import Settings
    from app.core.content import ContentGuard
    from app.llm.generation import ReliableGenerator
    config = Settings(_env_file=None, **settings)
    guard = ContentGuard(config.blocked_terms)
    return ReliableGenerator(provider, config, guard), guard


@pytest.mark.parametrize("count", [3, 4, 5])
async def test_quiz_generates_exact_distribution_with_source(count):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    provider = SequenceProvider(quiz_content(count))
    generator, guard = components(provider)
    quiz = await QuizService(generator, guard).generate(QuizRequest(user_input="Python", question_count=count))
    assert len(quiz.questions) == count
    assert [q.type for q in quiz.questions].count("single") == count - 2
    assert quiz.source_type == "text" and quiz.user_input == "Python" and quiz.quiz_id
    assert any("JSON" in message.content for message in provider.messages)
    assert any("Python" in message.content for message in provider.messages)


@pytest.mark.parametrize("bad", [None, {}, "", "{", {"title": "x"},
    {**quiz_content(), "questions": quiz_content()["questions"][:3]},
    {**quiz_content(), "questions": [quiz_content()["questions"][0]] * 5},
])
async def test_invalid_generation_retries_then_returns_valid_quiz(bad):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    provider = SequenceProvider(bad, quiz_content())
    generator, guard = components(provider)
    result = await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert result.title == "学习小测"
    assert provider.calls == 2


async def test_retry_adds_conservative_json_schema_instructions_without_echoing_bad_output():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    provider = SequenceProvider(ValueError("sensitive malformed model output"), quiz_content())
    generator, guard = components(provider)
    await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert provider.calls == 2
    correction = provider.messages[-1].content
    assert "重试要求" in correction and "JSON" in correction and "schema" in correction
    assert "Markdown" in correction and "额外字段" in correction
    assert not any("sensitive malformed model output" in message.content for message in provider.messages)


async def test_wrong_type_distribution_and_difficulty_are_retried():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    bad = quiz_content()
    bad["questions"][0] = {**bad["questions"][0], "type": "multiple", "answer": ["A", "B"]}
    provider = SequenceProvider(bad, quiz_content())
    generator, guard = components(provider)
    assert (await QuizService(generator, guard).generate(QuizRequest(user_input="Python", difficulty="easy"))).questions
    assert provider.calls == 2


async def test_requested_difficulty_is_validated_before_accepting_output():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    provider = SequenceProvider(quiz_content())
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python", difficulty="hard"))
    assert provider.calls == 2


@pytest.mark.parametrize("difficulty", ["easy", "medium", "hard"])
async def test_nonmixed_prompt_explicitly_requires_every_question_to_match_difficulty(difficulty):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    content = quiz_content(4)
    for question in content["questions"]:
        question["difficulty"] = difficulty
    provider = SequenceProvider(content)
    generator, guard = components(provider)
    await QuizService(generator, guard).generate(QuizRequest(user_input="Python 字典", question_count=4, difficulty=difficulty))
    instruction = "\n".join(message.content for message in provider.messages)
    assert f'每道题的 difficulty 必须严格等于 "{difficulty}"' in instruction
    assert "不得混合其他难度" in instruction


async def test_observed_mixed_difficulties_remain_rejected_with_safe_metadata(caplog):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    content = quiz_content(4)
    for question, difficulty in zip(content["questions"], ["easy", "medium", "medium", "hard"]):
        question["difficulty"] = difficulty
        question["stem"] = "private_learning_material"
    provider = SequenceProvider(content)
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python 字典", question_count=4, difficulty="medium"))
    assert provider.calls == 2
    assert "reason=difficulty_mismatch" in caplog.text
    assert "expected_difficulty=medium" in caplog.text
    assert "['easy', 'medium', 'medium', 'hard']" in caplog.text
    assert "private_learning_material" not in caplog.text


async def test_schema_rejection_logs_only_fixed_types_without_model_inputs(caplog):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    content = quiz_content()
    content["questions"][0]["stem"] = {"private_content": "sensitive_model_input"}
    provider = SequenceProvider(content)
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert "schema_error_types=" in caplog.text
    assert "string_type" in caplog.text
    assert "questions" not in caplog.text and "stem" not in caplog.text
    assert "private_content" not in caplog.text and "sensitive_model_input" not in caplog.text


@pytest.mark.parametrize("nested", [False, True])
async def test_schema_extra_key_never_appears_in_diagnostic_logs(caplog, nested):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    content = quiz_content()
    target = content["questions"][0] if nested else content
    target["PRIVATE_LEARNING_CONTENT_AS_UNEXPECTED_KEY"] = "private model value"
    provider = SequenceProvider(content)
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert "extra_forbidden" in caplog.text
    assert "PRIVATE_LEARNING_CONTENT_AS_UNEXPECTED_KEY" not in caplog.text
    assert "private model value" not in caplog.text


async def test_custom_validation_error_type_and_message_are_not_trusted_log_content(caplog):
    from pydantic import ValidationError
    from pydantic_core import PydanticCustomError
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    secret = "PRIVATE_CUSTOM_ERROR"
    failure = ValidationError.from_exception_data("private schema", [{
        "type": PydanticCustomError(secret, secret), "loc": (secret,), "input": secret}])
    provider = SequenceProvider(failure)
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert "validation_error" in caplog.text and secret not in caplog.text


async def test_exhausted_bad_generation_returns_safe_retryable_error(caplog):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    provider = SequenceProvider(ValueError("secret-key-and-user-content"))
    generator, guard = components(provider)
    with pytest.raises(AppError) as exc:
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert exc.value.status_code == 503
    assert "重试" in exc.value.message
    assert "secret-key-and-user-content" not in caplog.text
    assert provider.calls == 2


async def test_total_timeout_includes_all_attempts():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    provider = SequenceProvider("slow")
    generator, guard = components(provider, generation_timeout_seconds=0.02)
    start = asyncio.get_running_loop().time()
    with pytest.raises(AppError) as exc:
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert asyncio.get_running_loop().time() - start < 0.5
    assert exc.value.status_code == 504


async def test_last_attempt_timeout_returns_gateway_timeout():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    provider = SequenceProvider({}, "slow")
    generator, guard = components(provider, generation_timeout_seconds=0.1)
    with pytest.raises(AppError) as exc:
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert exc.value.status_code == 504 and provider.calls == 2


@pytest.mark.parametrize("retryable,calls", [(True, 2), (False, 1)])
async def test_provider_failures_retry_only_when_safe(retryable, calls):
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.llm.provider import ProviderFailure
    from app.core.errors import AppError
    provider = SequenceProvider(ProviderFailure(retryable=retryable))
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await QuizService(generator, guard).generate(QuizRequest(user_input="Python"))
    assert provider.calls == calls


async def test_content_screening_runs_before_provider_and_on_generated_output():
    from app.models.quiz import QuizRequest
    from app.services.quiz import QuizService
    from app.core.errors import AppError
    provider = SequenceProvider({**quiz_content(), "title": "blocked"})
    generator, guard = components(provider, blocked_terms=["blocked"])
    service = QuizService(generator, guard)
    with pytest.raises(AppError):
        await service.generate(QuizRequest(user_input="blocked"))
    assert provider.calls == 0
    with pytest.raises(AppError):
        await service.generate(QuizRequest(user_input="Python"))
    assert provider.calls == 1


async def test_report_preserves_server_stats_and_no_invented_weak_points():
    from app.models.report import ReportRequest
    from app.services.report import ReportService
    provider = SequenceProvider(report_text())
    generator, guard = components(provider)
    report = await ReportService(generator, guard).generate(ReportRequest.model_validate(report_request()))
    assert report.accuracy == 100 and report.xp == 50 and report.weak_points == []
    assert len(report.three_line_summary) == 3
    assert report.quiz_id == "quiz-1"
    assert any('"weak_points": []' in message.content for message in provider.messages)


async def test_ai_cannot_override_report_statistics():
    from app.models.report import ReportRequest
    from app.services.report import ReportService
    provider = SequenceProvider({**report_text(), "accuracy": 1}, report_text())
    generator, guard = components(provider)
    report = await ReportService(generator, guard).generate(ReportRequest.model_validate(report_request()))
    assert report.accuracy == 100 and provider.calls == 2


async def test_report_failure_raises_instead_of_fabricating_result():
    from app.models.report import ReportRequest
    from app.services.report import ReportService
    from app.core.errors import AppError
    provider = SequenceProvider({**report_text(), "three_line_summary": ["one"]})
    generator, guard = components(provider)
    with pytest.raises(AppError):
        await ReportService(generator, guard).generate(ReportRequest.model_validate(report_request()))
