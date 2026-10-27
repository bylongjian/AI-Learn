import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../src/services/api.ts'
import { quizFixture } from './fixtures.ts'

const profile = { id: '1', nickname: '同学', avatar_url: '', total_xp: 0, quiz_count: 0, correct_count: 0, average_accuracy: null, is_test: true }
test('用户 API 使用 GET/PUT 与 Bearer，登录请求不携带旧 Token', async () => {
  const seen: any[] = []
  const api: any = (createApi as any)((options: any) => { seen.push(options); return Promise.resolve({ statusCode: 200, data: { code: 0, data: options.url.includes('login') ? { token: 'new', expires_in: 60, user: profile } : profile } }) }, 'http://localhost/',
    { credentials: () => ({ token: 'old', userId: '1' }), onUnauthorized: () => {} })
  await api.getProfile().promise; await api.updateProfile({ nickname: '同学', avatar_url: '' }).promise; await api.devLogin('a').promise
  assert.equal(seen[0].method, 'GET'); assert.equal(seen[0].header.Authorization, 'Bearer old')
  assert.equal(seen[1].method, 'PUT'); assert.equal(seen[2].header.Authorization, undefined)
})
test('401 清理对应登录态，保留状态码并且不重复发出变更请求', async () => {
  const expired: string[] = []; let calls = 0
  const api: any = (createApi as any)(() => { calls++; return Promise.resolve({ statusCode: 401, data: { code: 40101, message: '请重新登录', data: null } }) }, 'http://test',
    { credentials: () => ({ token: 'old', userId: '1' }), onUnauthorized: (token: string) => expired.push(token) })
  await assert.rejects(api.updateProfile({ nickname: '同学' }).promise, (error: any) => error.statusCode === 401)
  assert.deepEqual(expired, ['old']); assert.equal(calls, 1)
})
test('题库请求期间切换账号，拒绝旧响应以免写入另一账号', async () => {
  let current = { token: 'one', userId: '1' }; let resolve!: (v: any) => void
  const api: any = (createApi as any)(() => new Promise(r => { resolve = r }), 'http://test', { credentials: () => current })
  const pending = api.generateQuiz('RAG'); current = { token: 'two', userId: '2' }
  resolve({ statusCode: 200, data: { code: 0, data: quizFixture() } })
  await assert.rejects(pending.promise, /账号/)
})
test('拒绝不完整资料与非法用户数据，错误不包含原始响应', async () => {
  const api: any = createApi(() => Promise.resolve({ statusCode: 200, data: { code: 0, data: { token: 'private' } } }), 'http://test')
  await assert.rejects(api.getProfile().promise, /格式/)
})

test('已登录的出题响应必须确认云端归属，否则提示重新登录', async () => {
  const expired: string[] = []
  const auth = { credentials: () => ({ token: 'old', userId: '1' }), onUnauthorized: (token: string) => expired.push(token) }
  const response = (header: Record<string, string>) => () => Promise.resolve({ statusCode: 200, header, data: { code: 0, data: quizFixture() } })
  const anonymous = createApi(response({}), 'http://test', auth)
  await assert.rejects(anonymous.generateQuiz('RAG').promise, /登录/); assert.deepEqual(expired, ['old'])
  const cloud = createApi(response({ 'x-learning-user': '1' }), 'http://test', auth)
  assert.equal((await cloud.generateQuiz('RAG').promise).quiz_id, 'test-quiz')
})

test('发请求前身份已改变时，不把原账号主题发送给新账号或游客', async () => {
  for (const identity of [null, { token: 'two', userId: '2' }]) {
    let requests = 0
    const api: any = createApi(() => { requests++; return Promise.resolve({ statusCode: 200, data: { code: 0, data: quizFixture() } }) }, 'http://test', { credentials: () => identity })
    await assert.rejects(async () => api.generateQuiz('账号一的私有主题', '1').promise, /账号/)
    assert.equal(requests, 0)
  }
})
