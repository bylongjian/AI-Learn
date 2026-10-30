import asyncio

import pytest

from app.core.content import ContentGuard
from app.core.errors import AppError
from app.llm.generation import ReliableGenerator
from app.models.quiz import QuizRequest
from app.services.document_parser import DocumentChunk
from tests.factories import quiz_content, FixedKnowledge
from tests.test_user_api import client_for, login, bearer
from tests.test_generation import SequenceProvider
from tests.test_grounded_quiz import grounded_content, review
from tests.test_search import decision


async def ready_document(repository,documents,user):
    from uuid import uuid4
    doc = await documents.repository.create(user,str(uuid4()),'课程.txt','.txt',100,documents.vectors.profile,180)
    await documents.vectors.add(doc,[DocumentChunk('A new concept is defined by its original guide.',0,2)])
    await documents.repository.ready(doc,1)
    return await documents.repository.get(user,doc.doc_id,ready=True)


async def test_document_quiz_has_verified_sources_and_normal_quiz_still_works(repository,documents):
    provider = SequenceProvider(decision(),grounded_content(),review())
    async with client_for(repository,documents_service=documents,provider=provider) as (client,app):
        user = await login(client)
        doc = await ready_document(repository,documents,user['user']['id'])
        result = await client.post('/api/v1/quiz/generate',json={'user_input':'RAG','doc_id':doc.doc_id},headers=bearer(user))
        assert result.status_code==200,result.text
        quiz = result.json()['data']
        assert quiz['generation']['mode']=='document'
        assert quiz['reference']['sources'][0]['page']==2
        saved = await app.state.user_repository.get_quiz(user['user']['id'],quiz['quiz_id'])
        assert saved['quiz']['generation']==quiz['generation']
        normal_review=review()
        for question in normal_review['questions']:
            question['evidence'][0]['quote']='Reference material for the learning topic.'
        provider.results,provider.calls = [grounded_content(),normal_review],0
        normal = await client.post('/api/v1/quiz/generate',json={'user_input':'RAG'},headers=bearer(user))
        assert normal.status_code==200 and normal.json()['data']['generation'] is None


async def test_model_fallback_remains_validated_and_saved_with_warning(repository,documents):
    provider = SequenceProvider(quiz_content())
    async with client_for(repository,documents_service=documents,provider=provider) as (client,app):
        user = await login(client)
        doc = await ready_document(repository,documents,user['user']['id'])
        documents.settings.dashscope_api_key=None
        app.state.settings.enable_web_search=False
        result = await client.post('/api/v1/quiz/generate',json={'user_input':'RAG','doc_id':doc.doc_id},headers=bearer(user))
        assert result.status_code==200,result.text
        quiz=result.json()['data']
        assert quiz['reference'] is None and quiz['generation']['mode']=='model_fallback'
        assert '未依据文档或联网资料核实' in quiz['generation']['message']
        assert len(quiz['questions'])==5
        saved=await app.state.user_repository.get_quiz(user['user']['id'],quiz['quiz_id'])
        assert saved['quiz']['generation']==quiz['generation']


@pytest.mark.parametrize('failure',['guest','owner','processing','evidence','deleted','storage'])
async def test_business_failures_never_become_successful_fallback(repository,documents,failure,monkeypatch):
    provider=SequenceProvider(decision(),grounded_content(),review(False),grounded_content(),review(False))
    async with client_for(repository,documents_service=documents,provider=provider) as (client,app):
        user,other=await login(client),await login(client,'b')
        doc=await ready_document(repository,documents,user['user']['id'])
        if failure=='processing':
            from uuid import uuid4
            doc=await documents.repository.create(user['user']['id'],str(uuid4()),'new.txt','.txt',1,documents.vectors.profile,180)
        if failure in {'deleted','storage'}:
            provider.results=[decision(),grounded_content(),review()]
            original=app.state.user_repository.save_quiz
            async def save(user_id,quiz):
                if failure=='deleted':
                    await documents.repository.start_delete(user_id,doc.doc_id)
                    return await original(user_id,quiz)
                raise AppError(50303,'云端存储暂时不可用',503)
            monkeypatch.setattr(app.state.user_repository,'save_quiz',save)
        headers={} if failure=='guest' else bearer(other if failure=='owner' else user)
        result=await client.post('/api/v1/quiz/generate',json={'user_input':'RAG','doc_id':doc.doc_id},headers=headers)
        assert result.status_code=={'guest':401,'owner':404,'processing':409,'evidence':503,'deleted':409,'storage':503}[failure],result.text
        assert (await app.state.user_repository.list_quizzes(user['user']['id'],1,10,'','all'))['total']==0
