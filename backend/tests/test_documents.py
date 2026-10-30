import asyncio
import threading
from io import BytesIO
from uuid import uuid4

import httpx
from starlette.datastructures import UploadFile


async def test_upload_ready_delete_cleans_vectors_and_original_files(repository,documents):
    user = await repository.upsert_user('dev:docs')
    doc = await documents.upload(user['id'],UploadFile(BytesIO(b'Course learning material. '*200),filename='course.txt'))
    assert doc.status == 'processing'
    await asyncio.gather(*tuple(documents.jobs))
    ready = await documents.repository.get(user['id'],doc.doc_id,ready=True)
    assert ready.chunk_count > 0
    assert not list(documents.settings.kb_upload_dir.iterdir())
    await documents.delete(user['id'],doc.doc_id)
    await asyncio.gather(*tuple(documents.jobs))
    assert await documents.repository.list(user['id']) == []
    assert await documents.vectors.search(ready,'course') == []


async def test_delete_during_embedding_never_revives_and_cleanup_can_retry(repository,documents):
    from app.services.vectors import RetrievalUnavailable
    user = await repository.upsert_user('dev:delete-running')
    entered = asyncio.Event()
    async def blocked(request):
        entered.set()
        await asyncio.Event().wait()
    documents.vectors.http = httpx.AsyncClient(transport=httpx.MockTransport(blocked))
    doc = await documents.upload(user['id'],UploadFile(BytesIO(b'Private course'),filename='course.txt'))
    await asyncio.wait_for(entered.wait(),20)
    original_delete = documents.vectors.delete
    async def failed_cleanup(doc):
        raise RetrievalUnavailable('disk unavailable')
    documents.vectors.delete = failed_cleanup
    await documents.delete(user['id'],doc.doc_id)
    await asyncio.gather(*tuple(documents.jobs),return_exceptions=True)
    assert (await documents.repository.get(user['id'],doc.doc_id)).status == 'delete_failed'
    documents.vectors.delete = original_delete
    await documents.delete(user['id'],doc.doc_id)
    await asyncio.gather(*tuple(documents.jobs))
    assert await documents.repository.list(user['id']) == []
    await documents.vectors.http.aclose()


async def test_deadline_and_restart_recovery_leave_failed_not_processing(repository,documents,monkeypatch):
    user = await repository.upsert_user('dev:recover')
    documents.settings.kb_process_timeout_seconds = 0.01
    doc = await documents.upload(user['id'],UploadFile(BytesIO(b'Course'),filename='course.txt'))
    await asyncio.gather(*tuple(documents.jobs))
    failed = await documents.repository.get(user['id'],doc.doc_id)
    assert failed.status == 'failed' and failed.error_code == 'processing_timeout'
    orphan = await documents.repository.create(user['id'],str(uuid4()),'lost.txt','.txt',10,documents.vectors.profile,180)
    await documents.recover()
    assert (await documents.repository.get(user['id'],orphan.doc_id)).status == 'failed'
    assert not list(documents.settings.kb_upload_dir.iterdir())

    # Timeout followed by DELETE must still wait for an already executing native write.
    from chromadb.api.models.Collection import Collection
    original_add = Collection.add
    entered,release,written = threading.Event(),threading.Event(),threading.Event()
    def native_write(collection,*args,**kwargs):
        entered.set()
        release.wait(15)
        try:
            return original_add(collection,*args,**kwargs)
        finally:
            written.set()
    monkeypatch.setattr(Collection,'add',native_write)
    documents.settings.kb_process_timeout_seconds = 4
    late = await documents.upload(user['id'],UploadFile(BytesIO(b'Course for native write'),filename='native.txt'))
    try:
        assert await asyncio.to_thread(entered.wait,10)
        async with asyncio.timeout(10):
            while (await documents.repository.get(user['id'],late.doc_id)).status != 'failed':
                await asyncio.sleep(0.02)
        await documents.delete(user['id'],late.doc_id)
        await asyncio.sleep(0.08)
        assert (await documents.repository.get(user['id'],late.doc_id)).status == 'deleting'
    finally:
        release.set()
        assert await asyncio.to_thread(written.wait,10)
        await asyncio.gather(*tuple(documents.jobs),return_exceptions=True)
    assert await documents.vectors.search(late,'course') == []
