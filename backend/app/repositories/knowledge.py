"""Document ownership, quota and lifecycle state in MySQL."""
from datetime import datetime, timedelta, timezone

import aiomysql

from app.core.errors import AppError
from app.models.document import KnowledgeDocument


def document_row(row):
    row["user_id"] = str(row["user_id"])
    for name in ("created_at", "updated_at", "deadline_at"):
        row[name] = row[name].replace(tzinfo=timezone.utc)
    return KnowledgeDocument(**row)


class KnowledgeRepository:
    def __init__(self, database):
        self.database = database

    async def create(self, user_id, doc_id, name, file_type, size, profile, timeout, *, limit=10):
        deadline = (datetime.now(timezone.utc) + timedelta(seconds=timeout)).replace(tzinfo=None)
        async with self.database.connection(transaction=True) as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("SELECT id FROM users WHERE id=%s FOR UPDATE", (user_id,))
                if await cursor.fetchone() is None:
                    raise AppError(40101, "请重新登录", 401)
                await cursor.execute("SELECT COUNT(*) FROM kb_documents WHERE user_id=%s", (user_id,))
                if (await cursor.fetchone())[0] >= limit:
                    raise AppError(40904, f"最多保存 {limit} 篇文档，请先删除现有文档", 409)
                await cursor.execute("""INSERT INTO kb_documents
                    (doc_id,user_id,file_name,file_type,file_size,embedding_profile,deadline_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)""", (doc_id,user_id,name,file_type,size,profile,deadline))
        return await self.get(user_id, doc_id)

    async def get(self, user_id, doc_id, *, ready=False):
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SELECT * FROM kb_documents WHERE user_id=%s AND doc_id=%s", (user_id, doc_id))
                row = await cursor.fetchone()
        if row is None:
            raise AppError(40401, "未找到该文档", 404)
        doc = document_row(row)
        if ready and doc.status != "ready":
            raise AppError(40903, "文档尚未就绪或已开始删除，请刷新知识库", 409)
        return doc

    async def list(self, user_id):
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SELECT * FROM kb_documents WHERE user_id=%s ORDER BY created_at DESC,doc_id DESC", (user_id,))
                return [document_row(row) for row in await cursor.fetchall()]

    async def ready(self, doc, count):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""UPDATE kb_documents SET status='ready',chunk_count=%s
                    WHERE doc_id=%s AND user_id=%s AND status='processing' AND deadline_at>UTC_TIMESTAMP(6)""", (count,doc.doc_id,doc.user_id))
                return cursor.rowcount == 1

    async def fail(self, doc, code, message):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""UPDATE kb_documents SET status='failed',error_code=%s,error_message=%s,cleanup_pending=TRUE
                    WHERE doc_id=%s AND user_id=%s AND status='processing'""", (code,message,doc.doc_id,doc.user_id))

    async def start_delete(self, user_id, doc_id):
        await self.get(user_id, doc_id)
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("""UPDATE kb_documents SET status='deleting',cleanup_pending=TRUE,error_code=NULL,error_message=NULL
                    WHERE user_id=%s AND doc_id=%s""", (user_id,doc_id))
        return await self.get(user_id, doc_id)

    async def cleanup_result(self, doc, *, success):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                if success:
                    await cursor.execute("UPDATE kb_documents SET cleanup_pending=FALSE WHERE user_id=%s AND doc_id=%s", (doc.user_id,doc.doc_id))
                else:
                    await cursor.execute("""UPDATE kb_documents SET cleanup_pending=TRUE,
                        status=IF(status IN ('deleting','delete_failed'),'delete_failed',status),
                        error_message=IF(status='delete_failed','文档清理未完成，请重试删除',error_message)
                        WHERE user_id=%s AND doc_id=%s""", (doc.user_id,doc.doc_id))

    async def remove(self, doc):
        async with self.database.connection() as conn:
            async with conn.cursor() as cursor:
                await cursor.execute("DELETE FROM kb_documents WHERE doc_id=%s AND user_id=%s AND status IN ('deleting','delete_failed')", (doc.doc_id,doc.user_id))

    async def pending(self):
        async with self.database.connection() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                await cursor.execute("SELECT * FROM kb_documents WHERE status IN ('processing','deleting','delete_failed') OR cleanup_pending=TRUE")
                return [document_row(row) for row in await cursor.fetchall()]
