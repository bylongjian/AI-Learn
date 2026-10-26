import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { quizFixture } from './fixtures.ts'

let apiModule: any; let storeModule: any
before(async () => {
  apiModule = await import('../src/services/api.ts').catch(() => ({}))
  storeModule = await import('../src/storage/store.ts').catch(() => ({}))
})

test('出题请求使用统一地址和60000ms超时，返回真实契约', async () => {
  const seen: any[] = []
  const api = apiModule.createApi((opts: any) => { seen.push(opts); return Promise.resolve({ statusCode: 200, data: { code: 0, data: quizFixture(), message: 'ok' } }) }, 'http://localhost:8000/')
  assert.equal((await api.generateQuiz('RAG 入门').promise).quiz_id, 'test-quiz')
  assert.equal(seen[0].url, 'http://localhost:8000/api/v1/quiz/generate')
  assert.equal(seen[0].timeout, 60000)
  assert.equal(seen[0].data.question_count, 5)
})

test('HTTP失败与网络失败给出可重试说明，不返回模拟题库', async () => {
  const api = apiModule.createApi(() => Promise.resolve({ statusCode: 503, data: { code: 5001, data: null, message: '题库生成失败，请稍后重试' } }), 'http://localhost')
  await assert.rejects(api.generateQuiz('RAG').promise, /生成失败/)
  const network = apiModule.createApi(() => Promise.reject(new Error('secret internal error')), 'http://localhost')
  await assert.rejects(network.generateQuiz('RAG').promise, /连接/)
})

test('格式不正确的成功响应也被拒绝，取消调用转发abort', async () => {
  let aborted = false
  const request = () => Object.assign(Promise.resolve({ statusCode: 200, data: { code: 0, data: {} } }), { abort: () => { aborted = true } })
  const api = apiModule.createApi(request, 'http://localhost')
  const pending = api.generateQuiz('RAG')
  pending.cancel()
  await assert.rejects(pending.promise, /格式/)
  assert.equal(aborted, true)
})

test('存储首次为空，草稿写入并能从新实例恢复', () => {
  let raw: unknown
  const driver = { read: () => raw, write: (value: unknown) => { raw = structuredClone(value) } }
  const store = storeModule.createLearningStore(driver)
  assert.equal(store.getSnapshot().saved.sessions.length, 0)
  store.setDraft('RAG')
  assert.equal(storeModule.createLearningStore(driver).getSnapshot().saved.draft, 'RAG')
})

test('写入失败保留内存与学习记录，并标记未能保存到设备', async () => {
  const learning = await import('../src/domain/learning.ts')
  const store = storeModule.createLearningStore({ read: () => undefined, write: () => { throw new Error('quota') } })
  store.saveSession(learning.createSession(quizFixture()))
  assert.equal(store.getSnapshot().saved.sessions.length, 1)
  assert.equal(store.getSnapshot().storageFailed, true)
})

test('订阅可解除，读取失败会提示，不会让应用崩溃', () => {
  const store = storeModule.createLearningStore({ read: () => { throw new Error('disabled') }, write: () => {} })
  assert.equal(store.getSnapshot().storageFailed, true)
  let calls = 0
  const unsubscribe = store.subscribe(() => { calls++ })
  store.setDraft('RAG'); unsubscribe(); store.setDraft('Python')
  assert.equal(calls, 1)
})

test('设备写入从失败恢复成功后清除过期告警', () => {
  let fail = true
  const store = storeModule.createLearningStore({ read: () => undefined, write: () => { if (fail) throw new Error('quota') } })
  store.setDraft('RAG')
  assert.equal(store.getSnapshot().storageFailed, true)
  assert.match(store.getSnapshot().notice, /仅在当前页面/)
  fail = false; store.setDraft('Python')
  assert.equal(store.getSnapshot().storageFailed, false)
  assert.equal(store.getSnapshot().notice, '')
})
