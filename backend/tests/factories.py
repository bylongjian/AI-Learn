from copy import deepcopy


class FixedKnowledge:
    """Replace the acquisition boundary when testing unrelated quiz/report contracts."""
    async def prepare(self, request):
        from app.models.knowledge import PreparedKnowledge
        return PreparedKnowledge(status="ready", topic=request.topic_context or request.user_input,
            sources=[{"id": "s1", "kind": "user_text", "title": "Test material", "url": None,
                      "published_at": None, "excerpt": "Reference material for the learning topic."}])


def question(index=1, kind="single", point=None):
    return {
        "id": f"q{index}", "type": kind, "stem": f"Question {index}",
        "options": [{"key": k, "text": f"Option {k}"} for k in ("AB" if kind == "judge" else "ABCD")],
        "answer": ["A", "B"] if kind == "multiple" else ["A"],
        "explanation": "A clear explanation", "knowledge_point": point or f"Point {index}",
        "difficulty": "easy",
    }


def quiz_content(count=5):
    return {"title": "学习小测", "summary": "按知识点练习", "questions": [
        question(i + 1, "single" if i < count - 2 else "multiple" if i == count - 2 else "judge")
        for i in range(count)
    ]}


def report_request(answers=None):
    questions = quiz_content()["questions"]
    answers = answers if answers is not None else [q["answer"] for q in questions]
    return {"quiz_id": "quiz-1", "topic": "Python 基础", "questions": deepcopy(questions),
            "answer_records": [{"question_id": q["id"], "selected_answers": a,
                                "is_correct": False, "duration_ms": 1200}
                               for q, a in zip(questions, answers)]}


def report_text():
    return {"three_line_summary": ["完成了本次练习", "继续巩固已有知识", "通过复习保持进步"],
            "advice": ["结合例子复习"], "share_quote": "每一次练习都算数"}
