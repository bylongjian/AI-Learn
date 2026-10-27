import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, submitAnswer } from '../src/domain/learning.ts'
import { quizFixture } from './fixtures.ts'

const stamp = '2026-10-20T04:00:00Z'
const item = (id: string) => ({ quiz_id: id, title: `Topic ${id}`, question_count: 5, correct_count: null, accuracy: null, status: 'not-started' as const, created_at: stamp })
const page = (ids: string[], n = 1) => ({ items: ids.map(item), total: 3, page: n, page_size: 2, totals: { all: 3, pending: 3, completed: 0 } })
const deferred = () => { let resolve!: (v: any) => void; let reject!: (e: any) => void; return { promise: new Promise<any>((a, b) => { resolve = a; reject = b }), resolve: (v: any) => resolve(v), reject: (e: any) => reject(e) } }

test('history changes accounts immediately, cancels old requests and ignores late responses', async () => {
  const { createHistoryStore } = await import('../src/history/store.ts')
  const old = deferred(); let canceled = 0
  const store = createHistoryStore(() => ({ promise: old.promise, cancel: () => { canceled++ } }))
  store.activateUser('a'); const pending = store.load('a', {})
  store.activateUser('b'); assert.equal(canceled, 1)
  assert.deepEqual(store.getSnapshot('b', {}).items, [])
  old.resolve(page(['private-a'])); await pending
  assert.deepEqual(store.getSnapshot('b', {}).items, []); assert.deepEqual(store.getSnapshot('a', {}).items, [])
})
test('history pagination deduplicates IDs, search uses the server, failed refresh keeps fallback and can retry', async () => {
  const { createHistoryStore } = await import('../src/history/store.ts')
  const queries: any[] = []; let fail = false
  const store = createHistoryStore((query, userId) => {
    queries.push({ ...query, userId })
    return { promise: fail ? Promise.reject(new Error('offline')) : Promise.resolve(page(query.page === 2 ? ['2', '3'] : ['1', '2'], query.page)), cancel() {} }
  })
  store.activateUser('a'); const query = { pageSize: 2 }
  await store.load('a', query); await store.load('a', query, true)
  assert.deepEqual(store.getSnapshot('a', query).items.map(i => i.quiz_id), ['1', '2', '3'])
  await store.load('a', { search: '中文', status: 'completed' }); assert.equal(queries.at(-1).search, '中文'); assert.equal(queries.at(-1).status, 'completed')
  fail = true; await store.load('a', query)
  assert.equal(store.getSnapshot('a', query).error, 'offline'); assert.equal(store.getSnapshot('a', query).items.length, 3)
  fail = false; await store.load('a', query); assert.equal(store.getSnapshot('a', query).error, '')
})
test('invalidating history cancels obsolete pagination and reloads a clean first page', async () => {
  const { createHistoryStore } = await import('../src/history/store.ts'); const late = deferred(); let count = 0
  const store = createHistoryStore(() => ({ promise: ++count === 2 ? late.promise : Promise.resolve(page(['1', '2'])), cancel() {} }))
  store.activateUser('a'); await store.load('a', {})
  const pending = store.load('a', {}, true); store.invalidate('a'); await store.load('a', {})
  late.resolve(page(['wrong'], 2)); await pending
  assert.deepEqual(store.getSnapshot('a', {}).items.map(i => i.quiz_id), ['1', '2']); assert.equal(store.getSnapshot('a', {}).page, 1)
})
test('history overlays this device progress and separates unsynced/offline records without duplicate cards', async () => {
  const { combineHistory } = await import('../src/history/store.ts')
  const quiz = quizFixture(); const local = submitAnswer(createSession(quiz), quiz.questions[0].answer, 50)
  const unsynced = { ...local, quiz: { ...quiz, quiz_id: 'local-failed', title: 'Unsynced' }, status: 'completed' as const, report_status: 'failed' as const }
  const rows = combineHistory([item('test-quiz')], [local, unsynced], {})
  assert.equal(rows.rows[0].local, local); assert.deepEqual(rows.deviceRows.map(r => r.quiz_id), ['local-failed'])
  const done = { ...item('test-quiz'), status: 'completed' as const, correct_count: 5, accuracy: 100 }
  assert.equal(combineHistory([done], [local], {}).rows[0].status, 'completed')
  assert.deepEqual(combineHistory([], [local], { search: 'missing' }, true).deviceRows, [])
  assert.equal(combineHistory([], [unsynced], { status: 'completed' }, true).deviceRows.length, 1)
})
test('a synchronous authentication failure can be retried after the same account is restored', async () => {
  const { createHistoryStore } = await import('../src/history/store.ts'); let fail = true
  const store = createHistoryStore(() => { if (fail) throw new Error('登录已失效'); return { promise: Promise.resolve(page(['restored'])), cancel() {} } })
  store.activateUser('a'); await store.load('a', {}); assert.match(store.getSnapshot('a', {}).error, /登录/)
  fail = false; await store.load('a', {})
  assert.deepEqual(store.getSnapshot('a', {}).items.map(item => item.quiz_id), ['restored'])
})
test('cloud pending filter keeps an unsynced completed device overlay visible under its server count', async () => {
  const { combineHistory } = await import('../src/history/store.ts')
  const session = { ...createSession(quizFixture()), status: 'completed' as const, report_status: 'failed' as const }
  const result = combineHistory([item('test-quiz')], [session], { status: 'pending' })
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].local, session); assert.equal(result.rows[0].status, 'completed')
  assert.equal(result.deviceRows.length, 0)
})
