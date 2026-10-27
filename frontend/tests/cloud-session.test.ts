import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLearningStore } from '../src/storage/store.ts'
import { createSession, submitAnswer, advanceSession, attachReport } from '../src/domain/learning.ts'
import { quizFixture, reportFixture } from './fixtures.ts'
import { createAuthStore } from '../src/auth/store.ts'

const pending = <T>(value: T) => ({ promise: Promise.resolve(value), cancel() {} })
const detail = (session: any, report: any = null) => ({ quiz: session.quiz, answer_records: report ? Object.values(session.records) : [], report, created_at: '2026-10-20T04:00:00Z' })
function setup() { const store = createLearningStore({ read() {}, write() {} }); store.activateScope('a'); return store }
function completed() {
  let session = createSession(quizFixture())
  for (const [i, q] of session.quiz.questions.entries()) session = advanceSession(submitAnswer(session, i === 0 ? ['D'] : q.answer, 10))
  return session
}
test('canonical cloud report opens without another AI request and replaces local failed report state', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const done = completed()
  store.saveSession({ ...done, report_status: 'failed' }); let generated = 0
  const access = createSessionAccess(store, { getQuizDetail: () => pending(detail(done, reportFixture())), generateReport: () => { generated++; return pending(reportFixture()) } })
  const result = await access.report('test-quiz', 'user:a').promise
  assert.equal(result.report_status, 'ready'); assert.equal(generated, 0); assert.equal(store.findSession('test-quiz')?.report_status, 'ready')
})
test('an owned local report opens offline without any cloud lookup', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const saved = attachReport(completed(), reportFixture()); store.saveSession(saved)
  const access = createSessionAccess(store, { getQuizDetail() { throw new Error('must not fetch') }, generateReport() { throw new Error('must not generate') } })
  assert.equal(await access.report('test-quiz', 'user:a').promise, saved)
})
test('cloud pending keeps this device answers before generating one report and notifying one refresh', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const done = completed(); store.saveSession(done)
  let generated = 0; let refreshed = 0
  const access = createSessionAccess(store, { getQuizDetail: () => pending(detail(done)), generateReport: session => { assert.equal(Object.keys(session.records).length, 5); generated++; return pending(reportFixture()) } }, () => { refreshed++ })
  assert.equal((await access.report('test-quiz', 'user:a').promise).report_status, 'ready'); assert.equal(generated, 1); assert.equal(refreshed, 1)
})
test('failed cloud lookup preserves owned local progress and never silently regenerates a report', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const done = completed(); store.saveSession(done)
  const access = createSessionAccess(store, { getQuizDetail: () => ({ promise: Promise.reject(new Error('offline')), cancel() {} }), generateReport() { throw new Error('must not generate') } })
  await assert.rejects(access.report('test-quiz', 'user:a').promise, /offline/); assert.equal(store.findSession('test-quiz'), done)
})
test('detail arriving after account switch cannot populate the next account or start AI generation', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const done = completed(); let resolve!: (v: any) => void
  const access = createSessionAccess(store, { getQuizDetail: () => ({ promise: new Promise<any>(r => { resolve = r }), cancel() {} }), generateReport() { throw new Error('must not generate') } })
  const request = access.read('test-quiz', 'user:a', true); store.activateScope('b'); resolve(detail(done, reportFixture()))
  await assert.rejects(request.promise, /账号/); assert.equal(store.findSession('test-quiz'), undefined)
})
test('canceling during cloud lookup ignores a late response and leaves local storage intact', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts'); const store = setup(); const done = completed(); let resolve!: (v: any) => void
  const access = createSessionAccess(store, { getQuizDetail: () => ({ promise: new Promise<any>(r => { resolve = r }), cancel() {} }), generateReport() { throw new Error('must not generate') } })
  const request = access.read('test-quiz', 'user:a', true); request.cancel(); resolve(detail(done, reportFixture()))
  await assert.rejects(request.promise, /取消/); assert.equal(store.findSession('test-quiz'), undefined)
})
test('report success refreshes XP after an older profile GET completes instead of joining its stale result', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts')
  const store = setup(); store.activateScope('1'); const done = completed(); store.saveSession(done)
  const initial = { id: '1', nickname: '同学', avatar_url: '', total_xp: 0, quiz_count: 0, correct_count: 0, average_accuracy: null, is_test: true }
  let resolveOld!: (value: typeof initial) => void; let calls = 0; let refreshed: Promise<void> | undefined
  const old = new Promise<typeof initial>(resolve => { resolveOld = resolve })
  const auth = createAuthStore({ read() {}, write() {}, clear() {} }, { platform: 'h5', devEnabled: true,
    devLogin: async () => ({ token: 'a-token', expires_in: 100, user: initial }),
    getProfile: () => ++calls === 1 ? old : Promise.resolve({ ...initial, total_xp: 40, quiz_count: 1, correct_count: 4, average_accuracy: 80 }),
  })
  await auth.loginDev('a'); const earlier = auth.refreshProfile()
  const access = createSessionAccess(store, { getQuizDetail: () => pending(detail(done)), generateReport: () => pending(reportFixture()) }, () => { refreshed = auth.refreshProfile(true) })
  assert.equal((await access.report('test-quiz', 'user:1').promise).report?.xp, 40)
  resolveOld(initial); await earlier; await refreshed
  assert.equal(auth.getSnapshot().user?.total_xp, 40); assert.equal(calls, 2)
})
test('a second report committed after the queued GET starts schedules another fresh profile read', async () => {
  const { createSessionAccess } = await import('../src/services/cloud-session.ts')
  const store = setup(); store.activateScope('1'); const first = completed()
  const second = { ...completed(), quiz: { ...first.quiz, quiz_id: 'second-quiz' } }; store.saveSession(first); store.saveSession(second)
  const initial = { id: '1', nickname: '同学', avatar_url: '', total_xp: 0, quiz_count: 0, correct_count: 0, average_accuracy: null, is_test: true }
  let resolveOld!: (value: typeof initial) => void; let resolveNext!: (value: typeof initial) => void
  const old = new Promise<typeof initial>(resolve => { resolveOld = resolve }); const next = new Promise<typeof initial>(resolve => { resolveNext = resolve })
  let reads = 0; let committedXp = 0; const refreshes: Promise<void>[] = []
  const auth = createAuthStore({ read() {}, write() {}, clear() {} }, { platform: 'h5', devEnabled: true,
    devLogin: async () => ({ token: 'one-token', expires_in: 100, user: initial }),
    getProfile: () => ++reads === 1 ? old : reads === 2 ? next : Promise.resolve({ ...initial, total_xp: committedXp, quiz_count: 2, correct_count: 8, average_accuracy: 80 }),
  })
  await auth.loginDev('a'); const earlier = auth.refreshProfile()
  const access = createSessionAccess(store, { getQuizDetail: id => pending(detail(id === 'test-quiz' ? first : second)), generateReport: () => { committedXp += 40; return pending(reportFixture()) } }, () => { refreshes.push(auth.refreshProfile(true)) })
  await access.report('test-quiz', 'user:1').promise; resolveOld(initial); await earlier; await Promise.resolve()
  assert.equal(reads, 2)
  await access.report('second-quiz', 'user:1').promise
  resolveNext({ ...initial, total_xp: 40 }); await Promise.all(refreshes)
  assert.equal(committedXp, 80); assert.equal(auth.getSnapshot().user?.total_xp, 80); assert.equal(reads, 3)
})
