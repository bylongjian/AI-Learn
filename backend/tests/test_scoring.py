import pytest
from tests.factories import report_request


def score(payload):
    from app.models.report import ReportRequest
    from app.services.scoring import score_answers
    return score_answers(ReportRequest.model_validate(payload))


def test_all_correct_overrides_false_client_flags_and_has_no_weak_points():
    result = score(report_request())
    assert result.model_dump() == {"accuracy": 100, "correct": 5, "total": 5, "xp": 50,
                                  "mastered_points": [f"Point {i}" for i in range(1, 6)], "weak_points": []}


def test_all_wrong_overrides_true_client_flags():
    payload = report_request([["B"], ["B"], ["B"], ["C"], ["B"]])
    for record in payload["answer_records"]:
        record["is_correct"] = True
    result = score(payload)
    assert (result.accuracy, result.correct, result.xp, result.mastered_points) == (0, 0, 0, [])
    assert len(result.weak_points) == 5


@pytest.mark.parametrize("selection,correct", [(["A", "B"], 5), (["B", "A"], 5), (["A"], 4), ([], 4), (["A", "B", "C"], 4)])
def test_multiple_is_exact_set_without_partial_credit(selection, correct):
    assert score(report_request([["A"], ["A"], ["A"], selection, ["A"]])).correct == correct


def test_shared_point_is_weak_if_any_question_wrong_and_order_is_deterministic():
    payload = report_request([["A"], ["B"], ["A"], ["A", "B"], ["A"]])
    payload["questions"][0]["knowledge_point"] = "shared"
    payload["questions"][1]["knowledge_point"] = "shared"
    result = score(payload)
    assert result.weak_points == ["shared"]
    assert result.mastered_points == ["Point 3", "Point 4", "Point 5"]
    assert result.accuracy == 80


def test_rounding_matches_javascript_half_up():
    from app.services.scoring import accuracy_percent
    assert accuracy_percent(1, 8) == 13
    assert accuracy_percent(2, 3) == 67


def test_repeated_knowledge_points_only_appear_once():
    payload = report_request([["A"], ["A"], ["B"], ["C"], ["A"]])
    for question in payload["questions"][:4]:
        question["knowledge_point"] = "shared"
    result = score(payload)
    assert result.weak_points == ["shared"]
    assert result.mastered_points == ["Point 5"]
