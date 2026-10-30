import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../src/services/api.ts'
import { quizFixture } from './fixtures.ts'

const doc = { doc_id: '26abc7a0-6639-4a4d-842f-2889d3f555cc', file_name: '课程.txt', file_type: '.txt', file_size: 10,
  status: 'processing', chunk_count: 0, error_code: null, error_message: null, created_at: '2026-10-30T03:00:00Z', updated_at: '2026-10-30T03:00:00Z' }
const success = (data: unknown) => ({ statusCode: 200, data: { code: 0, data } })

test('上传使用独立 multipart 网络调用并可查看状态、删除和指定文档出题', async () => {
  const calls: any[] = []
  const api = createApi(async options => {
    calls.push(options)
    return { ...success(options.method === 'DELETE' ? { doc_id: doc.doc_id, status: 'deleting' } : options.url.endsWith('quiz/generate') ? quizFixture() : { ...doc, status: 'ready', chunk_count: 1 }), header: { 'X-Learning-User': '1' } }
  }, 'https://api.example', { credentials: () => ({ userId: '1', token: 'token1' }) }, async options => {
    assert.equal(options.header.Authorization, 'Bearer token1')
    assert.equal(options.header['content-type'], undefined)
    assert.equal(options.timeout, 60000)
    return { statusCode: 202, data: JSON.stringify({ code: 0, data: doc }) }
  })
  assert.equal((await api.uploadDocument({ kind: 'weapp', name: doc.file_name, size: 10, path: '/tmp/course' }, '1').promise).status, 'processing')
  assert.equal((await api.getKnowledgeDocument(doc.doc_id, '1').promise).status, 'ready')
  assert.equal((await api.deleteKnowledgeDocument(doc.doc_id, '1').promise).status, 'deleting')
  await api.generateQuiz('RAG', '1', undefined, doc.doc_id).promise
  assert.equal(calls.at(-1).data.doc_id, doc.doc_id)
})

test('上传失败保留服务端提示，过期凭证退出登录', async () => {
  let expired = ''
  const api = createApi(async () => success(null), '', {
    credentials: () => ({ userId: '1', token: 'old' }), onUnauthorized: token => { expired = token },
  }, async () => ({ statusCode: 401, data: JSON.stringify({ code: 40101, message: '请重新登录' }) }))
  await assert.rejects(api.uploadDocument({ kind: 'weapp', name: '课程.txt', size: 10, path: '/tmp/course' }, '1').promise, /请重新登录/)
  assert.equal(expired, 'old')
})

test('账号切换后上传迟到响应不会进入新账号', async () => {
  let identity = { userId: '1', token: 'a' }
  let finish!: (value: any) => void
  const api = createApi(async () => success(null), '', { credentials: () => identity }, () => new Promise(resolve => { finish = resolve }))
  const pending = api.uploadDocument({ kind: 'weapp', name: '课程.txt', size: 10, path: '/tmp/course' }, '1')
  identity = { userId: '2', token: 'b' }
  finish({ statusCode: 202, data: JSON.stringify({ code: 0, data: doc }) })
  await assert.rejects(pending.promise, /账号已切换/)
})
