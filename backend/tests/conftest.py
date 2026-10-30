"""Shared integration fixtures: isolated MySQL, temporary vectors, mocked embeddings."""
import httpx
import pytest

from app.core.config import Settings
from app.repositories.knowledge import KnowledgeRepository
from app.services.documents import DocumentService
from app.services.vectors import VectorStore
from app.storage import Database, UserRepository, initialize_schema
from tests.test_vectors import embedding_response


@pytest.fixture
async def repository():
    config = Settings(_env_file=".env.test", app_env="test", dev_login_enabled=False)
    assert config.mysql_database and config.mysql_database.endswith("_test"), "Configure a separate _test database in .env.test"
    database = Database(config)
    try:
        await initialize_schema(database)
        async with database.connection() as conn:
            async with conn.cursor() as cursor:
                for table in ("reports", "answer_records", "quiz_sessions", "kb_documents", "users"):
                    await cursor.execute(f"DELETE FROM {table}")
        yield UserRepository(database)
    finally:
        await database.close()


@pytest.fixture
async def documents(repository, tmp_path):
    settings = Settings(
        _env_file=".env.test", dashscope_api_key="test", dashscope_base_url="https://embedding.example/v1",
        kb_embedding_dimensions=64, chroma_persist_dir=tmp_path / "vectors", kb_upload_dir=tmp_path / "uploads",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(embedding_response)) as client:
        service = DocumentService(settings, KnowledgeRepository(repository.database), VectorStore(settings, client=client))
        try:
            yield service
        finally:
            await service.aclose()
