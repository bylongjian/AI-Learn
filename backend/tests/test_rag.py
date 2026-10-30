import asyncio
import json

import httpx
import pytest
from pydantic import SecretStr
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import StructuredTool

from app.core.content import ContentGuard
from app.llm.generation import ReliableGenerator
from app.models.quiz import QuizRequest
from app.services.document_parser import DocumentChunk
from app.services.vectors import VectorStore
from tests.test_generation import SequenceProvider
from tests.test_search import decision, public_dns
from tests.test_vectors import vector_settings,document,embedding_response


class ToolModel(FakeMessagesListChatModel):
    def bind_tools(self,tools,**kwargs):
        return self


async def test_ready_document_is_used_without_web_calls(tmp_path):
    from app.services.rag import RagService
    settings = vector_settings(tmp_path)
    async with httpx.AsyncClient(transport=httpx.MockTransport(embedding_response)) as client:
        vectors = VectorStore(settings,client=client)
        doc = document(vectors)
        await vectors.add(doc,[DocumentChunk('Private lesson contains sufficient learning material.',0,3)])
        generator = ReliableGenerator(SequenceProvider(decision()),settings,ContentGuard([]))
        result = await RagService(settings,generator,vectors,model=None).prepare(QuizRequest(user_input='RAG'),doc)
        assert result.generation.mode == 'document'
        assert result.knowledge.sources[0].kind == 'document'
        assert result.knowledge.sources[0].page == 3


@pytest.mark.parametrize('top_k,failure',[(1,None),(4,None),(5,None),(1,'unavailable'),(1,'retry_unavailable')])
async def test_document_is_first_and_web_only_receives_public_topic(tmp_path,monkeypatch,top_k,failure):
    from app.services.rag import RagService
    settings = vector_settings(tmp_path)
    settings.tavily_api_key = SecretStr('test-key')
    settings.kb_retrieve_top_k = top_k
    events = []
    def embedding(request):
        events.append('document')
        query = json.loads(request.content)['input']
        if (failure == 'unavailable' and query == ['RAG']) or (failure == 'retry_unavailable' and query == ['retry RAG']):
            return httpx.Response(503)
        return embedding_response(request)
    async def lookup(query:str):
        """Retrieve public material."""
        events.append('web-started')
        await asyncio.sleep(0.01)
        events.append('web')
        assert query == 'RAG' and 'SECRET' not in query
        return {'results':[{'title':'Independent guide','url':f'https://{host}/guide','raw_content':f'Public evidence from {host}.'}
            for host in ['example.org','example.net']]}
    raw = StructuredTool.from_function(coroutine=lookup,name='tavily_search_deep')
    monkeypatch.setattr('app.services.rag.build_tavily_tools',lambda _: [raw])
    monkeypatch.setattr('app.services.rag.resolve_addresses',public_dns)
    calls = [{'name':raw.name,'args':{},'id':'web1'}]
    if failure:
        # A real model attempted a private retry alongside public search; that retry must not cancel search.
        calls.insert(0,{'name':'search_knowledge_base','args':{'query':'retry RAG'},'id':'retry'})
    model = ToolModel(responses=[AIMessage(content='',tool_calls=calls),AIMessage(content='Done')])
    async with httpx.AsyncClient(transport=httpx.MockTransport(embedding)) as client:
        vectors = VectorStore(settings,client=client)
        doc = document(vectors)
        await vectors.add(doc,[DocumentChunk(f'SECRET internal excerpt {index}',index) for index in range(top_k)])
        events.clear()
        source_ids=['s1','s2'] if failure == 'unavailable' else ['s1',f's{min(top_k,3)+1}',f's{min(top_k,3)+2}']
        assessment = decision(source_ids=source_ids,reviews=[
            {'source_id':identifier,'primary':False,'independent_origin':identifier} for identifier in source_ids])
        replies = [assessment] if failure == 'unavailable' else [decision('insufficient'),assessment]
        generator = ReliableGenerator(SequenceProvider(*replies),settings,ContentGuard([]))
        result = await RagService(settings,generator,vectors,model=model).prepare(QuizRequest(user_input='RAG'),doc)
        assert result.generation.mode == ('web_fallback' if failure == 'unavailable' else 'document_web')
        assert events == ['document',*(['document'] if failure == 'retry_unavailable' else []),'web-started','web']


@pytest.mark.parametrize('failure',['unavailable','timeout'])
async def test_failed_preparation_enters_explicit_fallback_with_shared_deadline(tmp_path,failure):
    from app.services.rag import RagService
    settings = vector_settings(tmp_path)
    settings.enable_web_search = False
    settings.knowledge_timeout_seconds = 0.03 if failure == 'timeout' else 25
    cancelled = asyncio.Event()
    async def respond(request):
        if failure == 'unavailable':
            return httpx.Response(503)
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        vectors = VectorStore(settings,client=client)
        generator = ReliableGenerator(SequenceProvider(),settings,ContentGuard([]))
        result = await RagService(settings,generator,vectors,model=None).prepare(QuizRequest(user_input='RAG'),document(vectors))
        assert result.generation.mode == 'model_fallback' and result.knowledge is None
        assert '未依据文档或联网资料核实' in result.generation.message
        if failure == 'timeout':
            assert cancelled.is_set()
