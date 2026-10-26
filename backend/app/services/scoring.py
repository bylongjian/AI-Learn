from app.models.report import ReportRequest, Score


def accuracy_percent(correct: int, total: int) -> int:
    return (correct * 200 + total) // (2 * total)


def score_answers(request: ReportRequest) -> Score:
    records = {r.question_id: r for r in request.answer_records}
    correct = 0
    mastered, weak = [], []
    for question in request.questions:
        is_correct = set(records[question.id].selected_answers) == set(question.answer)
        correct += int(is_correct)
        points = mastered if is_correct else weak
        if question.knowledge_point not in points:
            points.append(question.knowledge_point)
    return Score(accuracy=accuracy_percent(correct, len(request.questions)), correct=correct,
                 total=len(request.questions), xp=correct * 10,
                 mastered_points=[point for point in mastered if point not in weak], weak_points=weak)
