import asyncio
from uuid import uuid4

import pytest

from app.core.errors import AppError
from app.models.quiz import Quiz
from app.storage import initialize_schema
from tests.test_user_repository import stored_quiz


async def create_document(repository, user_id, **changes):
    from app.repositories.knowledge import KnowledgeRepository
    return await KnowledgeRepository(repository.database).create(
        user_id, str(uuid4()), "课程.txt", ".txt", 100, "v4-1024-test", 180, **changes)


async def test_document_lifecycle_and_generation_survive_repeatable_migration(repository):
    from app.repositories.knowledge import KnowledgeRepository
    kb = KnowledgeRepository(repository.database)
    user = await repository.upsert_user("dev:knowledge")
    doc = await create_document(repository, user["id"])
    assert doc.status == "processing"
    await kb.ready(doc, 3)
    assert (await kb.get(user["id"], doc.doc_id, ready=True)).chunk_count == 3
    quiz = Quiz(**{**stored_quiz().model_dump(), "generation": {
        "mode": "model_fallback", "doc_id": doc.doc_id, "doc_name": doc.file_name,
        "reason": "web_unavailable", "message": "模型生成，未依据文档或联网资料核实"}})
    await repository.save_quiz(user["id"], quiz)
    await initialize_schema(repository.database)
    await initialize_schema(repository.database)
    assert (await repository.get_quiz(user["id"], quiz.quiz_id))["quiz"]["generation"] == quiz.generation.model_dump()
    await kb.start_delete(user["id"], doc.doc_id)
    await kb.remove(doc)
    assert (await kb.list(user["id"])) == []
    assert (await repository.get_quiz(user["id"], quiz.quiz_id))["quiz"]["generation"]["doc_id"] == doc.doc_id


async def test_document_owner_and_ready_state_are_enforced(repository):
    from app.repositories.knowledge import KnowledgeRepository
    kb = KnowledgeRepository(repository.database)
    a, b = await repository.upsert_user("dev:ka"), await repository.upsert_user("dev:kb")
    doc = await create_document(repository, a["id"])
    assert await kb.list(b["id"]) == []
    with pytest.raises(AppError) as error:
        await kb.get(b["id"], doc.doc_id)
    assert error.value.status_code == 404
    with pytest.raises(AppError):
        await kb.start_delete(b["id"], doc.doc_id)
    with pytest.raises(AppError) as error:
        await kb.get(a["id"], doc.doc_id, ready=True)
    assert error.value.code == 40903
    await kb.start_delete(a["id"], doc.doc_id)
    await kb.ready(doc, 9)
    assert (await kb.get(a["id"], doc.doc_id)).status == "deleting"


async def test_concurrent_uploads_cannot_exceed_ten_documents(repository):
    from app.repositories.knowledge import KnowledgeRepository
    user = await repository.upsert_user("dev:quota")
    results = await asyncio.gather(*(create_document(repository, user["id"], limit=10) for _ in range(12)), return_exceptions=True)
    assert sum(isinstance(item, AppError) and item.code == 40904 for item in results) == 2
    assert len(await KnowledgeRepository(repository.database).list(user["id"])) == 10
