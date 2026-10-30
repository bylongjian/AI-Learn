"""Private upload lifecycle with bounded processing and retryable cleanup."""
import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
import re
from uuid import uuid4
from weakref import WeakValueDictionary

from app.core.errors import AppError
from app.services.document_parser import parse_upload, DocumentParseError
from app.services.vectors import RetrievalUnavailable

logger = logging.getLogger(__name__)


class DocumentService:
    def __init__(self, settings, repository, vectors):
        self.settings, self.repository, self.vectors = settings, repository, vectors
        self.semaphore = asyncio.Semaphore(settings.kb_process_concurrency)
        self.jobs = set()
        self.processing = {}
        self.locks = WeakValueDictionary()
        self.cleaning = set()
        self.admitting = set()
        self.maintenance = None

    def _track(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.jobs.add(task)
        def finished(done):
            self.jobs.discard(done)
            if not done.cancelled() and done.exception() is not None:
                error = done.exception()
                logger.error('document background task failed; category=%s',type(error).__name__)
        task.add_done_callback(finished)
        return task

    def _lock(self, doc_id):
        return self.locks.setdefault(doc_id,asyncio.Lock())

    def _path(self, doc):
        return self.settings.kb_upload_dir / (doc.doc_id + doc.file_type)

    async def upload(self, user_id, upload):
        path = None
        accepted = False
        try:
            name = re.sub(r'[\x00-\x1f\x7f]','',Path((upload.filename or '').replace('\\','/')).name).strip()[:255]
            extension = Path(name).suffix.lower()
            if not name or extension not in {'.pdf','.docx','.md','.txt'}:
                raise AppError(42201,'请上传 PDF、DOCX、Markdown 或 TXT 文件',422)
            if not self.vectors.configured():
                raise AppError(50304,'知识库向量化尚未配置，请联系服务维护者',503)
            self.settings.kb_upload_dir.mkdir(parents=True,exist_ok=True)
            doc_id = str(uuid4())
            self.admitting.add(doc_id)
            path = self.settings.kb_upload_dir / (doc_id + extension)
            size = 0
            with path.open('xb') as target:
                while data := await upload.read(65536):
                    size += len(data)
                    if size > self.settings.kb_max_file_size_mb * 1024 * 1024:
                        raise AppError(41301,'文件超过大小上限，请上传 10MB 以内的文档',413)
                    target.write(data)
            if size == 0:
                raise AppError(42201,'文件没有内容，请重新选择',422)
            doc = await self.repository.create(user_id,doc_id,name,extension,size,self.vectors.profile,
                self.settings.kb_process_timeout_seconds,limit=self.settings.kb_max_documents_per_user)
            accepted = True
            self.processing[doc_id] = self._track(self._run(doc))
            return doc
        except OSError:
            raise AppError(50304,'知识库临时存储不可用，请稍后重试',503) from None
        finally:
            await upload.close()
            if path is not None and not accepted:
                path.unlink(missing_ok=True)
            if path is not None:
                self.admitting.discard(path.stem)

    async def _work(self, doc):
        async with self.semaphore, self._lock(doc.doc_id):
            remaining = (doc.deadline_at-datetime.now(timezone.utc)).total_seconds()
            if remaining <= 0:
                raise TimeoutError()
            chunks = await parse_upload(self._path(doc),chunk_size=self.settings.kb_chunk_size,
                overlap=self.settings.kb_chunk_overlap,timeout=remaining)
            await self.vectors.add(doc,chunks)
            if not await self.repository.ready(doc,len(chunks)):
                raise TimeoutError()

    async def _run(self, doc):
        work = asyncio.create_task(self._work(doc))
        try:
            remaining = max(0,(doc.deadline_at-datetime.now(timezone.utc)).total_seconds())
            done,_ = await asyncio.wait({work},timeout=remaining)
            if not done:
                # Publish the terminal state before waiting for a native write to stop.
                await self.repository.fail(doc,'processing_timeout','文档处理超时，请删除后重新上传')
                work.cancel()
                await asyncio.gather(work,return_exceptions=True)
                await self._cleanup(doc)
            else:
                try:
                    work.result()
                except (DocumentParseError,RetrievalUnavailable,OSError,TimeoutError) as exc:
                    code = 'processing_timeout' if isinstance(exc,TimeoutError) else 'processing_failed'
                    message = '文档处理超时，请删除后重新上传' if isinstance(exc,TimeoutError) else (
                        str(exc) if isinstance(exc,(DocumentParseError,RetrievalUnavailable)) else '文档存储失败，请稍后重试')
                    await self.repository.fail(doc,code,message[:300])
                    await self._cleanup(doc)
        finally:
            work.cancel()
            await asyncio.gather(work,return_exceptions=True)
            self.processing.pop(doc.doc_id,None)

    async def _cleanup(self, doc):
        async with self._lock(doc.doc_id):
            success = True
            try:
                await self.vectors.delete(doc)
            except RetrievalUnavailable:
                success = False
            try:
                self._path(doc).unlink(missing_ok=True)
                self._path(doc).with_suffix('.chunks.jsonl').unlink(missing_ok=True)
            except OSError:
                success = False
            if success:
                # A concurrent delete may already have changed a failed record to deleting.
                await self.repository.remove(doc)
            await self.repository.cleanup_result(doc,success=success)

    async def delete(self, user_id, doc_id):
        doc = await self.repository.start_delete(user_id,doc_id)
        if doc_id not in self.cleaning:
            self.cleaning.add(doc_id)
            self._track(self._delete(doc))
        return doc

    async def _delete(self, doc):
        try:
            running = self.processing.get(doc.doc_id)
            if running is not None:
                running.cancel()
                await asyncio.gather(running,return_exceptions=True)
            await self._cleanup(doc)
        finally:
            self.cleaning.discard(doc.doc_id)

    async def recover(self):
        for doc in await self.repository.pending():
            if doc.doc_id in self.processing or doc.doc_id in self.cleaning or doc.doc_id in self.admitting:
                continue
            if doc.status == 'processing':
                await self.repository.fail(doc,'processing_interrupted','服务重启或处理中断，请删除后重新上传')
            await self._cleanup(doc)
        directory = self.settings.kb_upload_dir
        if directory.exists():
            for path in directory.iterdir():
                if not path.is_file() or path.name.split('.')[0] in self.processing or path.name.split('.')[0] in self.admitting:
                    continue
                if datetime.now().timestamp()-path.stat().st_mtime > 180:
                    path.unlink(missing_ok=True)

    def start(self):
        self.maintenance = asyncio.create_task(self._maintain())

    async def _maintain(self):
        while True:
            try:
                await self.recover()
            except (AppError,OSError,RetrievalUnavailable) as exc:
                logger.warning('knowledge recovery unavailable; category=%s',type(exc).__name__)
            await asyncio.sleep(30)

    async def aclose(self):
        tasks = list(self.jobs)
        if self.maintenance is not None:
            tasks.append(self.maintenance)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
        await self.vectors.aclose()
