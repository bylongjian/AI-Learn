"""Explicit cloud embeddings and a private, local Chroma collection."""
import asyncio
from hashlib import sha256
import json
import threading

import chromadb
from chromadb.config import Settings as ChromaSettings
from chromadb.errors import ChromaError
import httpx
from pydantic import BaseModel, FiniteFloat, ValidationError

from app.services.document_parser import DocumentChunk


class RetrievalUnavailable(Exception):
    """A known external retrieval/embedding failure, safe to downgrade."""


class EmbeddingItem(BaseModel):
    index: int
    embedding: list[FiniteFloat]


class EmbeddingResponse(BaseModel):
    data: list[EmbeddingItem]


class VectorStore:
    def __init__(self, settings, *, client=None):
        self.settings = settings
        self.http = client or httpx.AsyncClient(timeout=10, trust_env=False)
        self.owns_client = client is None
        self.profile = sha256(json.dumps([settings.dashscope_base_url, settings.dashscope_embedding_model,
            settings.kb_embedding_dimensions], separators=(',',':')).encode()).hexdigest()[:24]
        self._client = None
        self._client_lock = threading.Lock()

    def configured(self):
        return bool(self.settings.dashscope_api_key and self.settings.dashscope_api_key.get_secret_value().strip()
                    and self.settings.dashscope_base_url)

    def _collection(self, doc):
        with self._client_lock:
            if self._client is None:
                self._client = chromadb.PersistentClient(path=str(self.settings.chroma_persist_dir),
                    settings=ChromaSettings(anonymized_telemetry=False))
        return self._client.get_or_create_collection(name=f'kb_u_{doc.user_id}_{doc.embedding_profile}', embedding_function=None)

    async def embed(self, texts):
        if not self.configured():
            raise RetrievalUnavailable('向量化服务未配置')
        try:
            response = await self.http.post(self.settings.dashscope_base_url + '/embeddings',
                headers={'Authorization': 'Bearer ' + self.settings.dashscope_api_key.get_secret_value()},
                json={'model':self.settings.dashscope_embedding_model,'input':texts,
                      'dimensions':self.settings.kb_embedding_dimensions,'encoding_format':'float'}, timeout=10)
            response.raise_for_status()
            result = EmbeddingResponse.model_validate_json(response.content)
            items = sorted(result.data, key=lambda item:item.index)
            if [item.index for item in items] != list(range(len(texts))) or any(
                    len(item.embedding) != self.settings.kb_embedding_dimensions for item in items):
                raise ValueError('Embedding response dimensions or indices do not match')
            return [item.embedding for item in items]
        except (httpx.HTTPError, ValidationError, ValueError):
            raise RetrievalUnavailable('向量化服务失败，请稍后重试') from None

    def _scope(self, doc):
        return {'$and':[{'user_id':{'$eq':doc.user_id}},{'doc_id':{'$eq':doc.doc_id}}]}

    async def add(self, doc, chunks):
        if doc.embedding_profile != self.profile:
            raise RetrievalUnavailable('向量模型配置已改变，请删除文档后重新上传')
        size = self.settings.kb_embedding_batch_size
        for start in range(0,len(chunks),size):
            batch = chunks[start:start+size]
            vectors = await self.embed([chunk.text for chunk in batch])
            def write():
                self._collection(doc).add(ids=[f'{doc.doc_id}:{chunk.index}' for chunk in batch],
                    documents=[chunk.text for chunk in batch], embeddings=vectors,
                    metadatas=[{'user_id':doc.user_id,'doc_id':doc.doc_id,'file_name':doc.file_name,
                        'chunk_index':chunk.index, **({'page':chunk.page} if chunk.page is not None else {})} for chunk in batch])
            # Cancellation must not let deletion race ahead of an in-flight native write.
            task = asyncio.create_task(asyncio.to_thread(write))
            cancelled = False
            try:
                while True:
                    try:
                        await asyncio.shield(task)
                        break
                    except asyncio.CancelledError:
                        # DELETE, deadline and shutdown may each cancel the waiter.
                        cancelled = True
            except (ChromaError, OSError):
                raise RetrievalUnavailable('本地向量保存失败，请稍后重试') from None
            if cancelled:
                raise asyncio.CancelledError()

    async def search(self, doc, query):
        if doc.embedding_profile != self.profile:
            raise RetrievalUnavailable('向量模型配置已改变，请删除文档后重新上传')
        vectors = await self.embed([query])
        def read():
            result = self._collection(doc).query(query_embeddings=vectors, where=self._scope(doc),
                n_results=self.settings.kb_retrieve_top_k, include=['documents','metadatas'])
            return [DocumentChunk(text,meta['chunk_index'],meta.get('page'))
                for text,meta in zip(result['documents'][0],result['metadatas'][0])]
        try:
            return await asyncio.to_thread(read)
        except (ChromaError, OSError):
            raise RetrievalUnavailable('本地文档检索失败') from None

    async def delete(self, doc):
        def remove():
            self._collection(doc).delete(where=self._scope(doc))
        try:
            await asyncio.to_thread(remove)
        except (ChromaError, OSError):
            raise RetrievalUnavailable('本地文档清理失败') from None

    async def aclose(self):
        if self.owns_client:
            await self.http.aclose()
