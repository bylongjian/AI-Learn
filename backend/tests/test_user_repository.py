"""Integration tests deliberately use the separately configured real MySQL database."""
import asyncio
import importlib.util
from uuid import uuid4

import pytest

from app.core.config import Settings
from app.models.quiz import Quiz
from app.models.report import Report, ReportRequest
from app.services.scoring import score_answers
from tests.factories import quiz_content, report_request, report_text


@pytest.fixture
async def repository():
    if importlib.util.find_spec("app.storage") is None:
        yield None
        return
    from app.storage import Database, UserRepository, initialize_schema
    config = Settings(_env_file=".env.test", app_env="test", dev_login_enabled=False)
    assert config.app_env == "test" and config.mysql_database.endswith("_test"), "Never run repository tests on the app database"
    database = Database(config)
    await initialize_schema(database)
    async with database.connection() as conn:
        async with conn.cursor() as cursor:
            for table in ("reports", "answer_records", "quiz_sessions", "users"):
                await cursor.execute(f"DELETE FROM {table}")
    yield UserRepository(database)
    await database.close()


def stored_quiz(quiz_id=None, title="Python", count=3):
    return Quiz(quiz_id=quiz_id or str(uuid4()), source_type="text", user_input="Python", **{**quiz_content(count), "title": title})


async def test_quiz_reference_roundtrip_and_owner_isolation(repository):
    user = await repository.upsert_user("wx-reference-a")
    other = await repository.upsert_user("wx-reference-b")
    quiz = stored_quiz()
    reference = {"topic": "Python", "retrieved_at": "2026-10-28T12:00:00Z",
                 "sources": [{"id": "s1", "kind": "web", "title": "Guide", "url": "https://example.org/guide", "published_at": None, "excerpt": "Supporting text."}],
                 "question_sources": [{"question_id": q.id, "source_ids": ["s1"]} for q in quiz.questions]}
    quiz = Quiz(**{**quiz.model_dump(), "reference": reference})
    await repository.save_quiz(user["id"], quiz)
    detail = await repository.get_quiz(user["id"], quiz.quiz_id)
    assert detail["quiz"]["reference"] == reference
    history = await repository.list_quizzes(user["id"], 1, 10, "", "all")
    assert "reference" not in history["items"][0]
    from app.core.errors import AppError
    with pytest.raises(AppError):
        await repository.get_quiz(other["id"], quiz.quiz_id)


async def test_reference_migration_upgrades_legacy_quiz_without_data_loss(repository):
    from app.storage import initialize_schema
    user = await repository.upsert_user("wx-legacy-reference")
    quiz = stored_quiz()
    await repository.save_quiz(user["id"], quiz)
    async with repository.database.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("ALTER TABLE quiz_sessions DROP COLUMN `reference`")
    await initialize_schema(repository.database)
    await initialize_schema(repository.database)
    detail = await repository.get_quiz(user["id"], quiz.quiz_id)
    assert detail["quiz"]["title"] == quiz.title
    assert detail["quiz"]["reference"] is None


def result_for(quiz):
    payload = ReportRequest(quiz_id=quiz.quiz_id, questions=quiz.questions, topic=quiz.title, answer_records=[
        {"question_id": q.id, "selected_answers": q.answer, "is_correct": False, "duration_ms": 1200.0} for q in quiz.questions])
    score = score_answers(payload)
    report = Report(quiz_id=quiz.quiz_id, **score.model_dump(), **report_text())
    return payload, report


async def test_mysql_initializer_is_repeatable_and_pool_is_lazy(repository):
    assert repository is not None, "MySQL storage is missing"
    from app.storage import Database, initialize_schema
    database = Database(Settings(_env_file=".env.test"))
    assert database._pool is None
    await initialize_schema(database)
    assert database._pool is not None
    await database.close()
    assert database._pool is None


async def test_concurrent_same_openid_upsert_has_one_identity(repository):
    assert repository is not None, "MySQL storage is missing"
    users = await asyncio.gather(*(repository.upsert_user("wx-test-same") for _ in range(12)))
    assert len({u["id"] for u in users}) == 1
    assert users[0]["average_accuracy"] is None
    assert users[0]["quiz_count"] == 0
    assert users[0]["is_test"] is False


async def test_profiles_persist_unicode_and_parameterized_text(repository):
    assert repository is not None, "MySQL storage is missing"
    user = await repository.upsert_user("dev:a")
    profile = await repository.update_profile(user["id"], "小明'; DROP TABLE users; --", "https://example.org/avatar.png")
    assert profile["nickname"] == "小明'; DROP TABLE users; --"
    assert profile["avatar_url"] == "https://example.org/avatar.png"
    assert profile["is_test"] is True


async def test_full_quiz_roundtrip_long_title_and_ownership(repository):
    assert repository is not None, "MySQL storage is missing"
    a = await repository.upsert_user("wx-a")
    b = await repository.upsert_user("wx-b")
    quiz = stored_quiz(title="题" * 4000)
    await repository.save_quiz(a["id"], quiz)
    detail = await repository.get_quiz(a["id"], quiz.quiz_id)
    assert detail["quiz"] == quiz.model_dump()
    assert detail["report"] is None and detail["answer_records"] == []
    assert detail["created_at"].endswith("Z")
    from app.core.errors import AppError
    with pytest.raises(AppError) as missing:
        await repository.get_quiz(b["id"], quiz.quiz_id)
    assert missing.value.status_code == 404


async def test_result_transaction_and_concurrent_replay_award_xp_once(repository):
    assert repository is not None, "MySQL storage is missing"
    user = await repository.upsert_user("wx-results")
    quiz = stored_quiz()
    await repository.save_quiz(user["id"], quiz)
    payload, report = result_for(quiz)
    results = await asyncio.gather(*(repository.save_result(user["id"], payload, report) for _ in range(10)))
    assert all(result == report.model_dump() for result in results)
    profile = await repository.get_profile(user["id"])
    assert profile["total_xp"] == 30
    assert profile["quiz_count"] == 1 and profile["correct_count"] == 3
    assert profile["average_accuracy"] == 100
    detail = await repository.get_quiz(user["id"], quiz.quiz_id)
    assert detail["report"] == report.model_dump()
    assert len(detail["answer_records"]) == 3
    from app.core.errors import AppError
    conflict = payload.model_copy(deep=True)
    conflict.answer_records[0].selected_answers = ["B"]
    with pytest.raises(AppError) as exc:
        await repository.save_result(user["id"], conflict, report)
    assert exc.value.status_code == 409
    assert (await repository.get_profile(user["id"]))["total_xp"] == 30


async def test_result_rolls_back_answers_and_xp_if_report_insert_fails(repository):
    assert repository is not None, "MySQL storage is missing"
    user = await repository.upsert_user("wx-rollback")
    quiz = stored_quiz()
    await repository.save_quiz(user["id"], quiz)
    payload, report = result_for(quiz)
    # A temporary CHECK rejects the real report insert after answers have been inserted.
    async with repository.database.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("ALTER TABLE reports ADD CONSTRAINT test_fail_report CHECK (JSON_EXTRACT(report, '$.xp') < 0)")
    from app.core.errors import AppError
    try:
        with pytest.raises(AppError) as exc:
            await repository.save_result(user["id"], payload, report)
        assert exc.value.status_code == 503
    finally:
        async with repository.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("ALTER TABLE reports DROP CHECK test_fail_report")
    assert (await repository.get_profile(user["id"]))["total_xp"] == 0
    detail = await repository.get_quiz(user["id"], quiz.quiz_id)
    assert detail["report"] is None and detail["answer_records"] == []


async def test_paginated_search_status_and_weighted_statistics(repository):
    assert repository is not None, "MySQL storage is missing"
    user = await repository.upsert_user("wx-history")
    other = await repository.upsert_user("wx-other")
    quizzes = [stored_quiz(title="Python基础"), stored_quiz(title="Python进阶", count=5), stored_quiz(title="SQL")]
    for quiz in quizzes:
        await repository.save_quiz(user["id"], quiz)
    await repository.save_quiz(other["id"], stored_quiz(title="Python其他人"))
    payload, report = result_for(quizzes[0])
    await repository.save_result(user["id"], payload, report)
    page = await repository.list_quizzes(user["id"], 1, 1, "Python", "all")
    assert page["total"] == 2 and len(page["items"]) == 1
    assert page["items"][0]["quiz_id"] == quizzes[1].quiz_id
    assert page["totals"] == {"all": 2, "pending": 1, "completed": 1}
    complete = await repository.list_quizzes(user["id"], 1, 10, "", "completed")
    assert complete["total"] == 1 and complete["items"][0]["status"] == "completed"
    assert complete["items"][0]["correct_count"] == 3
    pending = await repository.list_quizzes(user["id"], 1, 10, "", "pending")
    assert pending["total"] == 2 and pending["items"][0]["accuracy"] is None
    payload2, report2 = result_for(quizzes[1])
    for record in payload2.answer_records[:3]:
        record.selected_answers = ["B"]
    score = score_answers(payload2)
    report2 = Report(quiz_id=quizzes[1].quiz_id, **score.model_dump(), **report_text())
    await repository.save_result(user["id"], payload2, report2)
    assert (await repository.get_profile(user["id"]))["average_accuracy"] == 63


async def test_unconfigured_database_is_safe_and_never_connects():
    assert importlib.util.find_spec("app.storage") is not None, "MySQL storage is missing"
    from app.storage import Database
    from app.core.errors import AppError
    database = Database(Settings(_env_file=None))
    with pytest.raises(AppError) as exc:
        async with database.connection():
            pass
    assert exc.value.status_code == 503
    assert database._pool is None


async def test_cancelled_mysql_query_preserves_cancellation_and_discards_uncommitted_write(repository):
    user = await repository.upsert_user("wx-cancelled-transaction")
    query_started = asyncio.Event()

    async def slow_transaction():
        async with repository.database.connection(transaction=True) as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("UPDATE users SET total_xp=99 WHERE id=%s", (user["id"],))
                query_started.set()
                await cursor.execute("SELECT SLEEP(2)")

    task = asyncio.create_task(slow_transaction())
    await asyncio.wait_for(query_started.wait(), timeout=2)
    await asyncio.sleep(0.05)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert task.cancelled(), "A cancelled MySQL query must remain task cancellation, not become a storage 503"
    assert (await repository.get_profile(user["id"]))["total_xp"] == 0


async def test_closed_connection_does_not_mask_original_transaction_error(repository):
    original = ValueError("original transaction failure")
    with pytest.raises(ValueError) as exc:
        async with repository.database.connection(transaction=True) as conn:
            conn.close()
            raise original
    assert exc.value is original


async def test_disconnected_rollback_preserves_original_transaction_error(repository):
    original = ValueError("original transaction failure")
    with pytest.raises(ValueError) as exc:
        async with repository.database.connection(transaction=True) as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT CONNECTION_ID()")
                connection_id = (await cursor.fetchone())[0]
            # MySQL permits an account to terminate another connection it owns.
            async with repository.database.connection() as terminator:
                async with terminator.cursor() as cursor:
                    await cursor.execute("KILL CONNECTION %s", (connection_id,))
            raise original
    assert exc.value is original


async def answer_user_index(database):
    async with database.connection() as conn:
        async with conn.cursor() as cursor:
            await cursor.execute("""SELECT COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='answer_records' AND INDEX_NAME='answer_user'
                ORDER BY SEQ_IN_INDEX""")
            return list(await cursor.fetchall())


async def test_profile_statistics_have_a_user_leading_answer_index(repository):
    assert await answer_user_index(repository.database) == [("user_id", 1)]


async def test_initializer_upgrades_existing_answer_table_idempotently_without_data_loss(repository):
    from app.storage import initialize_schema
    user = await repository.upsert_user("wx-index-upgrade")
    quiz = stored_quiz()
    await repository.save_quiz(user["id"], quiz)
    payload, report = result_for(quiz)
    await repository.save_result(user["id"], payload, report)
    if await answer_user_index(repository.database):
        async with repository.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("ALTER TABLE answer_records DROP INDEX answer_user")
    try:
        await initialize_schema(repository.database)
        await initialize_schema(repository.database)
        assert await answer_user_index(repository.database) == [("user_id", 1)]
        assert (await repository.get_quiz(user["id"], quiz.quiz_id))["report"] == report.model_dump()
        assert (await repository.get_profile(user["id"]))["total_xp"] == 30
    finally:
        await initialize_schema(repository.database)
