"""Private document records and the saved explanation of quiz generation."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from app.models.base import StrictModel

DocumentStatus = Literal["processing", "ready", "failed", "deleting", "delete_failed"]


class KnowledgeDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doc_id: str
    user_id: str = Field(exclude=True)
    file_name: str
    file_type: str
    file_size: int
    status: DocumentStatus
    chunk_count: int = 0
    embedding_profile: str = Field(exclude=True)
    error_code: str | None = None
    error_message: str | None = None
    cleanup_pending: bool = Field(default=False, exclude=True)
    created_at: datetime
    updated_at: datetime
    deadline_at: datetime = Field(exclude=True)


class QuizGeneration(StrictModel):
    mode: Literal["document", "document_web", "web_fallback", "model_fallback"]
    doc_id: str
    doc_name: str = Field(min_length=1, max_length=255)
    reason: Literal["document_insufficient", "document_unavailable", "web_insufficient", "web_unavailable", "preparation_timeout"] | None = None
    message: str = Field(min_length=1, max_length=300)
