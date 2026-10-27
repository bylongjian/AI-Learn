"""MySQL persistence. Pools connect lazily; AI generation never holds a transaction."""
import asyncio
from contextlib import asynccontextmanager
from datetime import timezone
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path
import warnings

import aiomysql

from app.core.config import Settings
from app.core.errors import AppError
from app.models.quiz import Quiz
from app.models.report import Report, ReportRequest
from app.services.scoring import score_answers


def unavailable() -> AppError:
    return AppError(50303, "云端存储暂时不可用，请稍后重试", 503)


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._pool = None
        self._lock = asyncio.Lock()

    async def pool(self):
        if not self.settings.mysql_user or not self.settings.mysql_database:
            raise unavailable()
        async with self._lock:
            if self._pool is None:
                self._pool = await aiomysql.create_pool(
                    host=self.settings.mysql_host, port=self.settings.mysql_port,
                    user=self.settings.mysql_user,
                    password=self.settings.mysql_password.get_secret_value() if self.settings.mysql_password else "",
                    db=self.settings.mysql_database, charset="utf8mb4", autocommit=True,
                    minsize=0, maxsize=10, connect_timeout=3, pool_recycle=300,
                    init_command="SET time_zone = '+00:00'",
                )
        return self._pool

    @asynccontextmanager
    async def connection(self, *, transaction=False):
        try:
            pool = await self.pool()
            async with asyncio.timeout(10):
                async with pool.acquire() as conn:
                    if transaction:
                        await conn.begin()
                    try:
                        yield conn
                        if transaction:
                            await conn.commit()
                    except BaseException:
                        if transaction and not conn.closed:
                            try:
                                await conn.rollback()
                            except BaseException:
                                # Rollback is best-effort cleanup. Preserve the original
                                # failure/cancellation and discard this unusable connection.
                                conn.close()
                        raise
        except (aiomysql.Error, OSError, TimeoutError) as exc:
            raise unavailable() from None

    async def close(self):
        async with self._lock:
            if self._pool is not None:
                self._pool.close()
                await self._pool.wait_closed()
                self._pool = None


async def initialize_schema(database: Database):
    sql = (Path(__file__).resolve().parent.parent / "sql" / "001_users.sql").read_text(encoding="utf-8")
    async with database.connection() as conn:
        async with conn.cursor() as cursor:
            for statement in sql.split(";"):
                if statement.strip():
                    # MySQL reports normal IF NOT EXISTS no-ops as warnings.
                    with warnings.catch_warnings():
                        warnings.filterwarnings("ignore", message="Table '.*' already exists", category=aiomysql.Warning)
                        await cursor.execute(statement)
            # CREATE IF NOT EXISTS does not upgrade tables from an earlier release.
            await cursor.execute("""SELECT INDEX_NAME FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='answer_records'
                AND COLUMN_NAME='user_id' AND SEQ_IN_INDEX=1 LIMIT 1""")
            if await cursor.fetchone() is None:
                await cursor.execute("ALTER TABLE answer_records ADD INDEX answer_user (user_id)")


def utc(value):
    return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def selections(records):
    return sorted((r["question_id"], sorted(r["selected_answers"])) for r in records)


def canonical_records(payload: ReportRequest):
    questions = {q.id: q for q in payload.questions}
    return [{**r.model_dump(), "is_correct": set(r.selected_answers) == set(questions[r.question_id].answer)}
            for r in payload.answer_records]


class UserRepository:
    def __init__(self, database: Database):
        self.database = database

    async def upsert_user(self, openid: str):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("INSERT INTO users (openid) VALUES (%s) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", (openid,))
                user_id = str(cursor.lastrowid)
        return await self.get_profile(user_id)

    async def get_profile(self, user_id: str):
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("""SELECT u.id,u.openid,u.nickname,u.avatar_url,u.total_xp,
                    COUNT(a.quiz_id) AS quiz_count, COALESCE(SUM(a.correct_count),0) AS correct_count,
                    COALESCE(SUM(a.total_questions),0) AS total_questions
                    FROM users u LEFT JOIN answer_records a ON a.user_id=u.id
                    WHERE u.id=%s GROUP BY u.id""", (user_id,))
                row = await cursor.fetchone()
        if row is None:
            raise AppError(40101, "请重新登录", 401)
        total = int(row.pop("total_questions"))
        correct = int(row["correct_count"])
        return {"id": str(row["id"]), "nickname": row["nickname"], "avatar_url": row["avatar_url"],
                "total_xp": int(row["total_xp"]), "quiz_count": int(row["quiz_count"]), "correct_count": correct,
                "average_accuracy": int((Decimal(correct * 100) / total).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) if total else None,
                "is_test": row["openid"].startswith("dev:")}

    async def update_profile(self, user_id: str, nickname: str, avatar_url: str):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("UPDATE users SET nickname=%s, avatar_url=%s WHERE id=%s", (nickname, avatar_url, user_id))
        return await self.get_profile(user_id)

    async def save_quiz(self, user_id: str, quiz: Quiz):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""INSERT INTO quiz_sessions (quiz_id,user_id,title,summary,user_input,questions)
                    VALUES (%s,%s,%s,%s,%s,%s)""", (quiz.quiz_id, user_id, quiz.title, quiz.summary, quiz.user_input,
                                                           dump([q.model_dump() for q in quiz.questions])))

    async def get_quiz(self, user_id: str, quiz_id: str):
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("""SELECT q.*,a.records,r.report FROM quiz_sessions q
                    LEFT JOIN answer_records a ON a.quiz_id=q.quiz_id LEFT JOIN reports r ON r.quiz_id=q.quiz_id
                    WHERE q.user_id=%s AND q.quiz_id=%s""", (user_id, quiz_id))
                row = await cursor.fetchone()
        if row is None:
            raise AppError(40401, "未找到该练习", 404)
        quiz = {"quiz_id": row["quiz_id"], "source_type": "text", "title": row["title"], "summary": row["summary"],
                "user_input": row["user_input"], "questions": json.loads(row["questions"])}
        return {"quiz": quiz, "answer_records": json.loads(row["records"]) if row["records"] else [],
                "report": json.loads(row["report"]) if row["report"] else None, "created_at": utc(row["created_at"])}

    async def list_quizzes(self, user_id: str, page: int, page_size: int, search: str, status: str):
        # Escape LIKE metacharacters so search is a literal title substring.
        search_pattern = "%" + search.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"
        where = "q.user_id=%s AND q.title LIKE %s ESCAPE '!'"
        parameters = (user_id, search_pattern)
        join = "FROM quiz_sessions q LEFT JOIN answer_records a ON a.quiz_id=q.quiz_id"
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute(f"SELECT COUNT(*) AS all_count,COUNT(a.quiz_id) AS completed {join} WHERE {where}", parameters)
                counts = await cursor.fetchone()
                all_count, completed = int(counts["all_count"]), int(counts["completed"])
                totals = {"all": all_count, "pending": all_count - completed, "completed": completed}
                if status == "completed":
                    where += " AND a.quiz_id IS NOT NULL"
                elif status == "pending":
                    where += " AND a.quiz_id IS NULL"
                await cursor.execute(f"""SELECT q.quiz_id,q.title,JSON_LENGTH(q.questions) AS question_count,
                    a.correct_count,a.accuracy,q.created_at {join} WHERE {where}
                    ORDER BY q.created_at DESC,q.id DESC LIMIT %s OFFSET %s""", (*parameters, page_size, (page - 1) * page_size))
                rows = await cursor.fetchall()
        items = [{**row, "status": "completed" if row["accuracy"] is not None else "not-started", "created_at": utc(row["created_at"])} for row in rows]
        return {"items": items, "total": totals[status], "page": page, "page_size": page_size, "totals": totals}

    async def save_result(self, user_id: str, payload: ReportRequest, report: Report):
        records = canonical_records(payload)
        score = score_answers(payload)
        async with self.database.connection(transaction=True) as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SELECT id FROM quiz_sessions WHERE quiz_id=%s AND user_id=%s FOR UPDATE", (payload.quiz_id, user_id))
                if await cursor.fetchone() is None:
                    raise AppError(40401, "未找到该练习", 404)
                await cursor.execute("SELECT a.records,r.report FROM answer_records a JOIN reports r ON r.quiz_id=a.quiz_id WHERE a.quiz_id=%s", (payload.quiz_id,))
                previous = await cursor.fetchone()
                if previous:
                    if selections(json.loads(previous["records"])) != selections(records):
                        raise AppError(40901, "该练习已提交，请查看已保存的报告", 409)
                    return json.loads(previous["report"])
                await cursor.execute("""INSERT INTO answer_records (quiz_id,user_id,records,correct_count,total_questions,accuracy)
                    VALUES (%s,%s,%s,%s,%s,%s)""", (payload.quiz_id, user_id, dump(records), score.correct, score.total, score.accuracy))
                await cursor.execute("INSERT INTO reports (quiz_id,user_id,report) VALUES (%s,%s,%s)", (payload.quiz_id, user_id, dump(report.model_dump())))
                await cursor.execute("UPDATE users SET total_xp=total_xp+%s WHERE id=%s", (score.xp, user_id))
        return report.model_dump()
