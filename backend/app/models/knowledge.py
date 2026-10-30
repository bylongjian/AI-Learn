"""Evidence shared by acquisition, generation, and later quiz history."""
from datetime import date, datetime, timezone
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator, model_serializer

from app.models.base import StrictModel, Text


class KnowledgeSource(StrictModel):
    id: str = Field(pattern=r"^s[1-5]$")
    kind: Literal["web", "user_text", "document"]
    title: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=2000)
    published_at: str | None = Field(default=None, max_length=64)
    excerpt: str = Field(min_length=1, max_length=2000)
    doc_id: str | None = None
    chunk_id: str | None = None
    page: int | None = Field(default=None,ge=1)

    @model_serializer(mode='wrap')
    def serialize_source(self,handler):
        result = handler(self)
        for key in ('doc_id','chunk_id','page'):
            if result[key] is None:
                result.pop(key)
        return result

    @field_validator("published_at")
    @classmethod
    def known_date(cls, value):
        if value is not None:
            try:
                date.fromisoformat(value)
            except ValueError:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def source_kind(self):
        if self.kind in {"user_text","document"} and (self.url is not None or self.published_at is not None):
            raise ValueError("User text has no independently verified URL or publication date")
        if self.kind == 'document' and (not self.doc_id or not self.chunk_id):
            raise ValueError('Document source requires its actual document and chunk identifiers')
        if self.kind != 'document' and any(value is not None for value in (self.doc_id,self.chunk_id,self.page)):
            raise ValueError('Only document sources have document metadata')
        if self.kind == "web" and not self.url:
            raise ValueError("Web evidence needs a URL")
        if self.kind == "web":
            parts = urlsplit(self.url)
            if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None or parts.password is not None:
                raise ValueError("Web evidence needs a public HTTP(S) URL without credentials")
        if not self.excerpt.strip() or not self.title.strip():
            raise ValueError("Empty source")
        return self


class DomainOption(StrictModel):
    label: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=150)
    source_ids: list[str] = Field(min_length=1, max_length=5)


class QuestionSources(StrictModel):
    question_id: Text
    source_ids: list[str] = Field(min_length=1, max_length=5)

    @field_validator("source_ids")
    @classmethod
    def unique(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Duplicate source associations")
        return value


def check_sources(sources):
    identifiers = {source.id for source in sources}
    if len(identifiers) != len(sources):
        raise ValueError("Duplicate source IDs")
    return identifiers


class PreparedKnowledge(StrictModel):
    status: Literal["ready", "clarification", "insufficient"]
    topic: Text
    retrieved_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sources: list[KnowledgeSource] = Field(default_factory=list, max_length=5)
    options: list[DomainOption] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def consistent_state(self):
        identifiers = check_sources(self.sources)
        if self.status == "ready" and (not identifiers or self.options):
            raise ValueError("Ready state needs evidence and no unresolved options")
        if self.status == "clarification":
            if not 2 <= len(self.options) <= 4 or len({option.label for option in self.options}) != len(self.options):
                raise ValueError("Clarification needs distinct options")
            if any(not set(option.source_ids) <= identifiers for option in self.options):
                raise ValueError("Unknown option sources")
        elif self.options:
            raise ValueError("Only clarification has options")
        return self


class QuizReference(StrictModel):
    topic: Text
    retrieved_at: str
    sources: list[KnowledgeSource] = Field(min_length=1, max_length=5)
    question_sources: list[QuestionSources] = Field(min_length=3, max_length=5)

    @field_validator("retrieved_at")
    @classmethod
    def aware_time(cls, value):
        if datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is None:
            raise ValueError("Retrieval time must include timezone")
        return value

    @model_validator(mode="after")
    def valid_associations(self):
        identifiers = check_sources(self.sources)
        if len({item.question_id for item in self.question_sources}) != len(self.question_sources):
            raise ValueError("Duplicate question associations")
        if any(not set(item.source_ids) <= identifiers for item in self.question_sources):
            raise ValueError("Unknown source association")
        return self


class SourceReview(StrictModel):
    source_id: str
    primary: bool
    independent_origin: Text


class InputAssessment(StrictModel):
    is_material: bool
    needs_external_verification: bool


class KnowledgeDecision(StrictModel):
    status: Literal["ready", "clarification", "insufficient"]
    reason: str = Field(default="", max_length=300, description="简要说明材料为何足够、需要确认领域或仍然不足；只解释实际资料中的依据。")
    topic: Text
    source_ids: list[str] = Field(max_length=5)
    options: list[DomainOption] = Field(max_length=4)
    reviews: list[SourceReview] = Field(max_length=5)
    freshness_supported: bool
    conflict_free: bool


class EvidenceQuote(StrictModel):
    source_id: str
    quote: str = Field(min_length=1, max_length=2000)


class QuestionReview(StrictModel):
    question_id: Text
    passed: bool
    issue: str = Field(max_length=300)
    evidence: list[EvidenceQuote] = Field(max_length=5)


class EvidenceReview(StrictModel):
    questions: list[QuestionReview] = Field(min_length=3, max_length=5)
