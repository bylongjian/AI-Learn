from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def source(**changes):
    return {"id": "s1", "kind": "web", "title": "Official guide",
            "url": "https://example.org/guide", "published_at": None,
            "excerpt": "A new concept is defined by its original guide.", **changes}


def test_knowledge_settings_defaults_and_secrets():
    settings = Settings(_env_file=None, tavily_api_key="private-test-key")
    assert settings.enable_web_search is True
    assert settings.knowledge_timeout_seconds == 25
    assert settings.quiz_build_timeout_seconds == 25
    assert settings.quiz_request_timeout_seconds == 55
    assert settings.knowledge_max_tool_calls == 4
    assert settings.knowledge_max_context_chars == 12000
    assert "private-test-key" not in repr(settings)


@pytest.mark.parametrize("changes", [
    {"knowledge_timeout_seconds": 0}, {"knowledge_max_tool_calls": 0},
    {"knowledge_max_context_chars": 13000}, {"quiz_request_timeout_seconds": 60},
    {"knowledge_timeout_seconds": 30}, {"quiz_build_timeout_seconds": 45},
])
def test_invalid_knowledge_budgets_are_rejected(changes):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **changes)


def test_prepared_knowledge_states_and_options():
    from app.models.knowledge import PreparedKnowledge
    assert PreparedKnowledge(status="insufficient", topic="Unknown").sources == []
    options = [{"label": f"Domain {i}", "description": "A distinct meaning", "source_ids": ["s1"]} for i in range(2)]
    prepared = PreparedKnowledge(status="clarification", topic="Term", sources=[source()], options=options)
    assert len(prepared.options) == 2
    with pytest.raises(ValidationError):
        PreparedKnowledge(status="clarification", topic="Term", sources=[source()], options=options[:1])
    with pytest.raises(ValidationError):
        PreparedKnowledge(status="ready", topic="Term", sources=[])
    options[0]["source_ids"] = ["invented"]
    with pytest.raises(ValidationError):
        PreparedKnowledge(status="clarification", topic="Term", sources=[source()], options=options)


def test_reference_has_unique_sources_and_valid_question_associations():
    from app.models.knowledge import QuizReference
    value = {"topic": "Term", "retrieved_at": datetime.now(timezone.utc).isoformat(),
             "sources": [source()], "question_sources": [{"question_id": f"q{i}", "source_ids": ["s1"]} for i in range(1, 4)]}
    assert QuizReference(**value).sources[0].published_at is None
    with pytest.raises(ValidationError):
        QuizReference(**{**value, "sources": [source(), source()]})
    with pytest.raises(ValidationError):
        QuizReference(**{**value, "question_sources": [{"question_id": f"q{i}", "source_ids": ["fake"]} for i in range(1, 4)]})


def test_source_text_does_not_invent_a_url_or_publication_date():
    from app.models.knowledge import KnowledgeSource
    assert KnowledgeSource(**source(kind="user_text", title="用户提供的资料", url=None)).url is None
    with pytest.raises(ValidationError):
        KnowledgeSource(**source(kind="user_text"))
    with pytest.raises(ValidationError):
        KnowledgeSource(**source(published_at="yesterday"))


def test_topic_context_is_optional_trimmed_and_bounded():
    from app.models.quiz import QuizRequest
    assert QuizRequest(user_input="Term", topic_context="  AI engineering  ").topic_context == "AI engineering"
    assert QuizRequest(user_input="Term").topic_context is None
    for context in [" ", "x" * 201, "bad\x01text"]:
        with pytest.raises(ValidationError):
            QuizRequest(user_input="Term", topic_context=context)


def test_quiz_reference_must_cover_exactly_its_own_questions():
    from app.models.quiz import Quiz
    from tests.factories import quiz_content
    base = {**quiz_content(3), "quiz_id": "quiz-ref", "user_input": "Term"}
    reference = {"topic": "Term", "retrieved_at": "2026-10-28T12:00:00Z", "sources": [source()],
                 "question_sources": [{"question_id": f"q{i}", "source_ids": ["s1"]} for i in range(1, 4)]}
    assert Quiz(**base).reference is None
    assert Quiz(**base, reference=reference).reference.sources[0].id == "s1"
    reference["question_sources"][2]["question_id"] = "another-quiz-question"
    with pytest.raises(ValidationError):
        Quiz(**base, reference=reference)
