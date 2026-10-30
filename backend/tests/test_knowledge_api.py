import asyncio

import httpx
import pytest

from tests.test_user_api import client_for,login,bearer


async def test_upload_list_status_delete_over_http(repository,documents):
    async with client_for(repository,documents_service=documents) as (client,app):
        headers = bearer(await login(client))
        # WeChat transports a temporary basename; preserve the name chosen by the user.
        result = await client.post('/api/v1/knowledge/documents',files={'file':('wx_temp_without_extension',b'Knowledge material. '*5000)},
            data={'file_name':'course.txt'},headers=headers)
        assert result.status_code == 202,result.text
        assert result.json()['data']['file_name'] == 'course.txt'
        doc_id = result.json()['data']['doc_id']
        await asyncio.gather(*tuple(documents.jobs))
        status = await client.get('/api/v1/knowledge/documents/'+doc_id,headers=headers)
        assert status.json()['data']['status'] == 'ready'
        assert 'user_id' not in status.json()['data'] and 'embedding_profile' not in status.json()['data']
        assert len((await client.get('/api/v1/knowledge/documents',headers=headers)).json()['data']['items']) == 1
        deleted = await client.delete('/api/v1/knowledge/documents/'+doc_id,headers=headers)
        assert deleted.status_code == 202


async def test_private_routes_require_identity_and_do_not_reveal_other_owners(repository,documents):
    async with client_for(repository,documents_service=documents) as (client,app):
        assert (await client.post('/api/v1/knowledge/documents',files={'file':('x.txt',b'course')})).status_code == 401
        a,b = await login(client),await login(client,'b')
        result = await client.post('/api/v1/knowledge/documents',files={'file':('course.txt',b'Learning content')},headers=bearer(a))
        doc_id = result.json()['data']['doc_id']
        assert (await client.get('/api/v1/knowledge/documents/'+doc_id,headers=bearer(b))).status_code == 404
        assert (await client.delete('/api/v1/knowledge/documents/'+doc_id,headers=bearer(b))).status_code == 404


async def test_upload_limits_missing_key_and_streaming_body_cap(repository,documents):
    async with client_for(repository,documents_service=documents,kb_max_file_size_mb=1) as (client,app):
        documents.settings.kb_max_file_size_mb = 1
        headers = bearer(await login(client))
        assert (await client.post('/api/v1/knowledge/documents',files={'file':('x.doc',b'course')},headers=headers)).status_code == 422
        assert (await client.post('/api/v1/knowledge/documents',files={'file':('x.txt',b'x'*(1024*1024+1))},headers=headers)).status_code == 413
        async def large():
            yield b'--test\r\nContent-Disposition: form-data; name="file"; filename="large.txt"\r\nContent-Type: text/plain\r\n\r\n'
            for _ in range(12):
                yield b'x'*1024*1024
            yield b'\r\n--test--\r\n'
        assert (await client.post('/api/v1/knowledge/documents',content=large(),headers={**headers,'content-type':'multipart/form-data; boundary=test'})).status_code == 413
        documents.settings.dashscope_api_key = None
        assert (await client.post('/api/v1/knowledge/documents',files={'file':('x.txt',b'course')},headers=headers)).status_code == 503
        assert await documents.repository.list((await login(client))['user']['id']) == []
        preflight = await client.options('/api/v1/knowledge/documents/x',headers={'origin':'http://localhost:10086','access-control-request-method':'DELETE','access-control-request-headers':'authorization'})
        assert preflight.status_code == 200
