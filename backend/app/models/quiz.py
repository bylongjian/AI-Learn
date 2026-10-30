import re
from typing import Literal
from pydantic import Field, field_validator, model_validator
from app.models.base import StrictModel, Text
from app.models.knowledge import QuestionSources, QuizReference

Choice = Literal["A", "B", "C", "D"]
Difficulty = Literal["easy", "medium", "hard"]


class QuizRequest(StrictModel):
    user_input: str = Field(min_length=1, max_length=2000)
    question_count: int = Field(default=5, ge=3, le=5)
    difficulty: Literal["mixed", "easy", "medium", "hard"] = "mixed"
    topic_context: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("user_input")
    @classmethod
    def clean_input(cls, value: str) -> str:
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value):
            raise ValueError("Text contains unsupported control characters")
        value = value.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not value:
            raise ValueError("Please enter learning content")
        return value

    @field_validator("topic_context")
    @classmethod
    def clean_context(cls, value: str | None) -> str | None:
        return cls.clean_input(value) if value is not None else None


class Option(StrictModel):
    key: Choice
    text: Text


class Question(StrictModel):
    id: Text
    type: Literal["single", "multiple", "judge"]
    stem: Text
    options: list[Option] = Field(min_length=2, max_length=4)
    answer: list[Choice] = Field(min_length=1, max_length=4)
    explanation: Text
    knowledge_point: Text
    difficulty: Difficulty

    @model_validator(mode="after")
    def consistent_options(self):
        keys = [option.key for option in self.options]
        expected = set("AB" if self.type == "judge" else "ABCD")
        if len(keys) != len(expected) or set(keys) != expected:
            raise ValueError("Question must have unique A-D (judge A-B) options")
        if len(set(self.answer)) != len(self.answer) or not set(self.answer) <= expected:
            raise ValueError("Answers must be unique valid option keys")
        if self.type == "multiple" and len(self.answer) < 2:
            raise ValueError("Multiple-choice question needs at least two answers")
        if self.type != "multiple" and len(self.answer) != 1:
            raise ValueError("Single/judge question needs exactly one answer")
        return self


class QuizContent(StrictModel):
    title: Text
    summary: Text
    questions: list[Question] = Field(min_length=3, max_length=5)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique")
        return self


class Quiz(QuizContent):
    quiz_id: Text
    source_type: Literal["text"] = "text"
    user_input: Text
    reference: QuizReference | None = None

    @model_validator(mode="after")
    def reference_matches_questions(self):
        if self.reference is not None and {item.question_id for item in self.reference.question_sources} != {q.id for q in self.questions}:
            raise ValueError("Reference associations must cover this quiz's questions")
        return self


class GroundedQuizContent(QuizContent):
    question_sources: list[QuestionSources] = Field(min_length=3, max_length=5)

    @model_validator(mode="after")
    def all_questions_have_sources(self):
        expected = {question.id for question in self.questions}
        actual = [item.question_id for item in self.question_sources]
        if len(set(actual)) != len(actual) or set(actual) != expected:
            raise ValueError("Evidence must cover every question exactly once")
        return self
