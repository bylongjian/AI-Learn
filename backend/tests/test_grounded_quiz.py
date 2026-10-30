import asyncio
from copy import deepcopy

import httpx
import pytest

from app.core.config import Settings
from app.core.content import ContentGuard
from app.core.errors import AppError
from app.llm.generation import ReliableGenerator
from app.models.knowledge import PreparedKnowledge
from app.models.quiz import QuizRequest
from tests.factories import quiz_content
from tests.test_generation import SequenceProvider
from tests.test_knowledge_models import source


def prepared(status="ready"):
    options = [{"label": f"Domain {i}", "description": "A distinct topic", "source_ids": ["s1"]} for i in range(2)]
    return PreparedKnowledge(status=status, topic="Confirmed domain", sources=[source()], options=options if status == "clarification" else [])


def grounded_content():
    content = quiz_content()
    return {**content, "question_sources": [{"question_id": q["id"], "source_ids": ["s1"]} for q in content["questions"]]}


def review(passed=True):
    return {"questions": [{"question_id": q["id"], "passed": passed, "issue": "" if passed else "unsupported",
                           "evidence": [{"source_id": "s1", "quote": "A new concept is defined by its original guide."}]} for q in quiz_content()["questions"]]}


class FixedKnowledge:
    def __init__(self, value=None):
        self.value = value or prepared()
        self.requests = []
    async def prepare(self, request):
        self.requests.append(request)
        return self.value


def components(*outputs, knowledge=None, **changes):
    from app.services.quiz import QuizService
    settings = Settings(_env_file=None, **changes)
    guard = ContentGuard(settings.blocked_terms)
    provider = SequenceProvider(*outputs)
    generator = ReliableGenerator(provider, settings, guard)
    return QuizService(generator, guard, knowledge or FixedKnowledge()), provider


async def test_ambiguous_topic_has_no_generation_or_quiz_identifier():
    from app.core.errors import TopicClarification
    service, provider = components(grounded_content(), knowledge=FixedKnowledge(prepared("clarification")))
    with pytest.raises(TopicClarification) as result:
        await service.generate(QuizRequest(user_input="Term"))
    assert provider.calls == 0
    assert len(result.value.options) == 2


async def test_source_prompt_and_independent_review_precede_delivery():
    service, provider = components(grounded_content(), review())
    quiz = await service.generate(QuizRequest(user_input="Term", topic_context="Domain"))
    assert quiz.user_input == "Term"
    assert len(quiz.questions) == 5 and provider.calls == 2
    assert quiz.reference.topic == "Confirmed domain"
    assert quiz.reference.question_sources[0].source_ids == ["s1"]
    assert "原始资料" in "\n".join(message.content for message in provider.messages)


@pytest.mark.parametrize("bad", ["unsupported", "fake_source", "fake_quote", "missing_question"])
async def test_unsupported_or_invented_evidence_is_never_delivered(bad):
    failed = review(False)
    if bad == "fake_source":
        failed = review(); failed["questions"][0]["evidence"][0]["source_id"] = "fake"
    elif bad == "fake_quote":
        failed = review(); failed["questions"][0]["evidence"][0]["quote"] = "invented quotation"
    elif bad == "missing_question":
        failed = review(); failed["questions"][-1]["question_id"] = "not-in-quiz"
    service, provider = components(grounded_content(), failed, grounded_content(), failed)
    with pytest.raises(AppError):
        await service.generate(QuizRequest(user_input="Term"))


async def test_one_repair_must_be_reviewed_again():
    service, provider = components(grounded_content(), review(False), grounded_content(), review())
    quiz = await service.generate(QuizRequest(user_input="Term"))
    assert quiz.quiz_id and provider.calls == 4


async def test_build_budget_includes_review_and_cancels_pending_model():
    service, provider = components(grounded_content(), "slow", knowledge_timeout_seconds=0.01,
                                   quiz_build_timeout_seconds=0.03, quiz_request_timeout_seconds=0.1)
    with pytest.raises(AppError) as result:
        await service.generate(QuizRequest(user_input="Term"))
    assert result.value.code == 50401


async def test_api_clarification_is_typed_and_does_not_save():
    from app.main import create_app
    app = create_app(Settings(_env_file=None), provider=SequenceProvider(grounded_content()),
                     knowledge_service=FixedKnowledge(prepared("clarification")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post("/api/v1/quiz/generate", json={"user_input": "Term"})
        invalid = await client.post("/api/v1/quiz/generate", json={"user_input": "Term", "topic_context": "x" * 201})
    assert result.status_code == 409
    assert result.json()["code"] == 40902
    assert result.json()["data"]["options"][0] == {"label": "Domain 0", "description": "A distinct topic"}
    assert invalid.status_code == 422 and invalid.json()["data"] is None


async def test_insufficient_state_and_context_content_filter_prevent_generation():
    service, provider = components(grounded_content(), knowledge=FixedKnowledge(PreparedKnowledge(status="insufficient", topic="Unknown")))
    with pytest.raises(AppError) as result:
        await service.generate(QuizRequest(user_input="Term"))
    assert result.value.code == 42203 and provider.calls == 0
    service, provider = components(grounded_content(), blocked_terms=["blocked-domain"])
    with pytest.raises(AppError):
        await service.generate(QuizRequest(user_input="Term", topic_context="blocked-domain"))
    assert provider.calls == 0
