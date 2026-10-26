import math
import pytest
from pydantic import ValidationError
from tests.factories import question, quiz_content, report_request, report_text


def test_quiz_request_defaults_and_trim():
    from app.models.quiz import QuizRequest
    value = QuizRequest(user_input="  Python 基础\r\n  ")
    assert value.model_dump() == {"user_input": "Python 基础", "question_count": 5, "difficulty": "mixed"}


@pytest.mark.parametrize("changes", [
    {"user_input": " "}, {"user_input": "\x00"}, {"user_input": "a" * 2001},
    {"user_input": " " * 2000 + "a"}, {"user_input": 1},
    {"question_count": 2}, {"question_count": 6}, {"question_count": True}, {"question_count": "3"},
    {"difficulty": "expert"}, {"extra": 1},
])
def test_quiz_request_rejects_invalid_raw_input(changes):
    from app.models.quiz import QuizRequest
    with pytest.raises(ValidationError):
        QuizRequest.model_validate({"user_input": "Python", **changes})


def test_unicode_codepoint_cap():
    from app.models.quiz import QuizRequest
    assert len(QuizRequest(user_input="🐑" * 2000).user_input) == 2000


@pytest.mark.parametrize("kind", ["single", "multiple", "judge"])
def test_valid_question_types(kind):
    from app.models.quiz import Question
    assert Question.model_validate(question(kind=kind)).type == kind


@pytest.mark.parametrize("change", [
    {"id": " "}, {"stem": ""}, {"explanation": " "}, {"knowledge_point": ""},
    {"difficulty": "mixed"}, {"type": "essay"}, {"answer": []}, {"answer": ["E"]},
    {"answer": ["A", "A"]}, {"answer": ["A", "B"]},
    {"options": [{"key": "A", "text": "a"}]},
    {"options": [{"key": k, "text": "a"} for k in "ABCC"]},
    {"options": [{"key": k, "text": "a"} for k in "ABCE"]},
    {"options": [{"key": k, "text": " "} for k in "ABCD"]}, {"extra": 1},
])
def test_question_rejects_invalid_shapes(change):
    from app.models.quiz import Question
    with pytest.raises(ValidationError):
        Question.model_validate({**question(), **change})


def test_multiple_requires_two_or_more_correct_answers_and_judge_one():
    from app.models.quiz import Question
    with pytest.raises(ValidationError):
        Question.model_validate({**question(kind="multiple"), "answer": ["A"]})
    with pytest.raises(ValidationError):
        Question.model_validate({**question(kind="judge"), "answer": ["A", "B"]})


def test_generated_quiz_requires_unique_ids():
    from app.models.quiz import QuizContent
    value = quiz_content()
    value["questions"][1]["id"] = "q1"
    with pytest.raises(ValidationError):
        QuizContent.model_validate(value)


@pytest.mark.parametrize("alter", [
    lambda v: v["answer_records"].pop(),
    lambda v: v["answer_records"].append(v["answer_records"][0]),
    lambda v: v["answer_records"][0].update(question_id="missing"),
    lambda v: v["questions"][1].update(id="q1"),
    lambda v: v["answer_records"][0].update(selected_answers=["E"]),
    lambda v: v["answer_records"][0].update(selected_answers=["A", "A"]),
    lambda v: v["answer_records"][0].update(selected_answers=["A", "B"]),
    lambda v: v["answer_records"][0].update(duration_ms=-1),
    lambda v: v["answer_records"][0].update(duration_ms=math.inf),
    lambda v: v["answer_records"][0].update(duration_ms=math.nan),
    lambda v: v["answer_records"][0].update(is_correct="true"),
    lambda v: v.update(questions=[]),
])
def test_report_request_rejects_inconsistent_answers(alter):
    from app.models.report import ReportRequest
    value = report_request()
    alter(value)
    with pytest.raises(ValidationError):
        ReportRequest.model_validate(value)


def test_unanswered_is_valid_and_multiple_order_is_preserved():
    from app.models.report import ReportRequest
    value = report_request([[], ["A"], ["A"], ["B", "A"], ["A"]])
    assert ReportRequest.model_validate(value).answer_records[0].selected_answers == []


@pytest.mark.parametrize("changes", [
    {"three_line_summary": ["one", "two"]}, {"three_line_summary": ["one"] * 4},
    {"three_line_summary": ["one", "two", " "]}, {"advice": []}, {"share_quote": " "},
    {"accuracy": 100},
])
def test_report_text_is_strict(changes):
    from app.models.report import ReportNarrative
    with pytest.raises(ValidationError):
        ReportNarrative.model_validate({**report_text(), **changes})
