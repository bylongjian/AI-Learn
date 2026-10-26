from pydantic import Field, model_validator
from app.models.base import StrictModel, Text
from app.models.quiz import Choice, Question


class AnswerRecord(StrictModel):
    question_id: Text
    selected_answers: list[Choice] = Field(max_length=4)
    is_correct: bool
    duration_ms: float = Field(ge=0, allow_inf_nan=False)


class ReportRequest(StrictModel):
    quiz_id: Text
    topic: Text
    questions: list[Question] = Field(min_length=3, max_length=5)
    answer_records: list[AnswerRecord] = Field(min_length=3, max_length=5)

    @model_validator(mode="after")
    def consistent_records(self):
        ids = [q.id for q in self.questions]
        record_ids = [r.question_id for r in self.answer_records]
        if len(set(ids)) != len(ids) or len(set(record_ids)) != len(record_ids) or set(ids) != set(record_ids):
            raise ValueError("Provide exactly one answer record for every unique question")
        by_id = {q.id: q for q in self.questions}
        for record in self.answer_records:
            question = by_id[record.question_id]
            choices = record.selected_answers
            if len(choices) != len(set(choices)) or not set(choices) <= {o.key for o in question.options}:
                raise ValueError("Selected answers must be unique valid options")
            if question.type != "multiple" and len(choices) > 1:
                raise ValueError("Single/judge question permits at most one selection")
        return self


class ReportNarrative(StrictModel):
    three_line_summary: list[Text] = Field(min_length=3, max_length=3)
    advice: list[Text] = Field(min_length=1, max_length=5)
    share_quote: Text


class Score(StrictModel):
    accuracy: int = Field(ge=0, le=100)
    correct: int = Field(ge=0)
    total: int = Field(ge=1)
    xp: int = Field(ge=0)
    mastered_points: list[Text]
    weak_points: list[Text]


class Report(Score, ReportNarrative):
    quiz_id: Text
