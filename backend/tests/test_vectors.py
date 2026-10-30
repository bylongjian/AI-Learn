from datetime import datetime, timezone, timedelta
import hashlib
import json

import httpx
import pytest

from app.core.config import Settings
from app.models.document import KnowledgeDocument
from app.services.document_parser import DocumentChunk


def vector_settings(tmp_path):
    return Settings(_env_file=None, dashscope_api_key='test-not-real', dashscope_base_url='https://embedding.example/v1',
                    kb_embedding_dimensions=64, chroma_persist_dir=tmp_path/'chroma', kb_upload_dir=tmp_path/'uploads')


def document(store, user='1', doc_id='doc-a'):
    now = datetime.now(timezone.utc)
    return KnowledgeDocument(doc_id=doc_id,user_id=user,file_name='course.txt',file_type='.txt',file_size=10,
        status='ready',embedding_profile=store.profile,created_at=now,updated_at=now,deadline_at=now+timedelta(seconds=180))


def embedding_response(request):
    payload = json.loads(request.content)
    assert payload['encoding_format'] == 'float' and payload['dimensions'] == 64
    assert len(payload['input']) <= 2
    return httpx.Response(200,json={'data':[{'index':i,'embedding': [v/255 for v in hashlib.sha512(text.encode()).digest()]}
        for i,text in enumerate(payload['input'])]})


async def test_persistent_vectors_roundtrip_and_delete(tmp_path):
    from app.services.vectors import VectorStore
    async with httpx.AsyncClient(transport=httpx.MockTransport(embedding_response)) as client:
        store = VectorStore(vector_settings(tmp_path), client=client)
        doc = document(store)
        await store.add(doc,[DocumentChunk('RAG retrieves evidence.',0,2)])
        reopened = VectorStore(vector_settings(tmp_path), client=client)
        found = await reopened.search(doc,'RAG retrieves evidence.')
        assert found[0].text == 'RAG retrieves evidence.' and found[0].page == 2
        await reopened.delete(doc)
        assert await store.search(doc,'RAG retrieves evidence.') == []


async def test_vectors_are_scoped_to_both_user_and_document(tmp_path):
    from app.services.vectors import VectorStore
    async with httpx.AsyncClient(transport=httpx.MockTransport(embedding_response)) as client:
        store = VectorStore(vector_settings(tmp_path), client=client)
        for user,identifier in [('1','a'),('1','b'),('2','a')]:
            await store.add(document(store,user,identifier),[DocumentChunk(f'private-{user}-{identifier}',0)])
        found = await store.search(document(store,'1','a'),'private')
        assert [chunk.text for chunk in found] == ['private-1-a']
        await store.delete(document(store,'1','a'))
        assert len(await store.search(document(store,'1','b'),'private')) == 1


@pytest.mark.parametrize('failure',['network','dimension','profile'])
async def test_embedding_failures_are_explicit_and_never_write_usable_vectors(tmp_path,failure):
    from app.services.vectors import VectorStore, RetrievalUnavailable
    def respond(request):
        if failure == 'network':
            return httpx.Response(503)
        return httpx.Response(200,json={'data':[{'index':0,'embedding':[1.0]}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        store = VectorStore(vector_settings(tmp_path), client=client)
        doc = document(store)
        if failure == 'profile':
            doc.embedding_profile = 'different-config'
        with pytest.raises(RetrievalUnavailable):
            await store.add(doc,[DocumentChunk('material',0)])
