import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi } from '../src/services/api.ts'
import { createSession, advanceSession, submitAnswer, restoreState } from '../src/domain/learning.ts'
import { quizFixture, reportFixture } from './fixtures.ts'

const created_at = '2026-10-20T04:00:00Z'
const item = { quiz_id: 'test-quiz', title: 'RAG', question_count: 5, correct_count: null, accuracy: null, status: 'not-started', created_at }
const page = { items: [item], total: 1, page: 1, page_size: 10, totals: { all: 1, pending: 1, completed: 0 } }
const auth = { credentials: () => ({ token: 'token', userId: '1' }) }
test('history API encodes server search, status and paging and keeps abort support', async () => {
  let seen: any; let aborted = false
  const api: any = createApi(options => { seen = options; return Object.assign(Promise.resolve({ statusCode: 200, data: { code: 0, data: page } }), { abort: () => { aborted = true } }) }, 'http://test', auth)
  const request = api.getHistory({ search: 'RAG & 中文', status: 'pending', page: 2, pageSize: 10 }, '1')
  assert.equal((await request.promise).total, 1)
  assert.equal(seen.method, 'GET'); assert.match(seen.url, /page=2&page_size=10&search=RAG%20%26%20%E4%B8%AD%E6%96%87&status=pending$/)
  assert.equal(request.userId, '1'); request.cancel(); assert.equal(aborted, true)
})
test('history rejects invalid counts, statuses, duplicate IDs and malformed timestamps', async () => {
  for (const bad of [{ ...page, total: -1 }, { ...page, items: [{ ...item, status: 'ready' }] }, { ...page, items: [item, item] }, { ...page, items: [{ ...item, created_at: 'yesterday' }] }, { ...page, items: [{ ...item, accuracy: 80 }] }, { ...page, totals: { all: 5, pending: 1, completed: 0 } }]) {
    const api: any = createApi(() => Promise.resolve({ statusCode: 200, data: { code: 0, data: bad } }), 'http://test', auth)
    await assert.rejects(api.getHistory({}, '1').promise, /格式/)
  }
})
test('detail API rejects the wrong quiz identity and ignores a response after account switches', async () => {
  let current = { token: 'one', userId: '1' }; let resolve!: (v: any) => void
  const api: any = createApi(() => new Promise(r => { resolve = r }), 'http://test', { credentials: () => current })
  const pending = api.getQuizDetail('test-quiz', '1'); current = { token: 'two', userId: '2' }
  resolve({ statusCode: 200, data: { code: 0, data: { quiz: quizFixture(), answer_records: [], report: null, created_at } } })
  await assert.rejects(pending.promise, /账号/)
  const other: any = createApi(() => Promise.resolve({ statusCode: 200, data: { code: 0, data: { quiz: quizFixture(), answer_records: [], report: null, created_at } } }), 'http://test', auth)
  await assert.rejects(other.getQuizDetail('different', '1').promise, /格式/)
})

async function adapter() { return import('../src/domain/cloud.ts') }
function completed() {
  let session = createSession(quizFixture())
  for (const [index, question] of session.quiz.questions.entries()) session = advanceSession(submitAnswer(session, index === 0 ? ['D'] : question.answer, 20))
  return session
}
test('cloud completed detail recomputes answer flags, preserves canonical report and overrides local partial progress', async () => {
  const { cloudDetailToSession } = await adapter()
  const done = completed(); const report = { ...reportFixture(), quiz_id: 'test-quiz' }
  const records = Object.values(done.records).map(r => ({ ...r, is_correct: !r.is_correct }))
  const restored = cloudDetailToSession({ quiz: done.quiz, answer_records: records, report, created_at }, createSession(done.quiz))
  assert.equal(restored.status, 'completed'); assert.equal(restored.report, report); assert.equal(restored.created_at, created_at)
  assert.equal(restored.updated_at, created_at); assert.equal(restored.records[done.quiz.questions[0].id].is_correct, false)
  assert.equal(restoreState({ version: 1, draft: '', sessions: [restored] }).state.sessions.length, 1)
})
test('cloud pending detail preserves this device progress and rejects unrecognized or incomplete records', async () => {
  const { cloudDetailToSession } = await adapter(); const quiz = quizFixture()
  const local = submitAnswer(createSession(quiz), quiz.questions[0].answer, 50)
  assert.equal(cloudDetailToSession({ quiz, answer_records: [], report: null, created_at }, local), local)
  assert.equal(cloudDetailToSession({ quiz, answer_records: [], report: null, created_at }).current_index, 0)
  const done = completed(); const detail = { quiz, answer_records: Object.values(done.records), report: reportFixture(), created_at }
  for (const records of [[], detail.answer_records.slice(1), [...detail.answer_records, detail.answer_records[0]], [{ ...detail.answer_records[0], question_id: 'unknown' }, ...detail.answer_records.slice(1)]]) assert.throws(() => cloudDetailToSession({ ...detail, answer_records: records }), /格式|记录/)
  assert.throws(() => cloudDetailToSession({ ...detail, report: { ...reportFixture(), xp: 999 } }), /报告/)
})
test('cloud blank answers remain incorrect and survive cache restore without allowing blank submissions', async () => {
  const { cloudDetailToSession } = await adapter(); const done = completed()
  const records = Object.values(done.records).map((r, i) => i === 0 ? { ...r, selected_answers: [], is_correct: true } : r)
  const restored = cloudDetailToSession({ quiz: done.quiz, answer_records: records, report: reportFixture(), created_at })
  assert.equal(restored.records[done.quiz.questions[0].id].is_correct, false)
  assert.equal(restoreState({ version: 1, draft: '', sessions: [restored] }).state.sessions.length, 1)
  assert.throws(() => submitAnswer(createSession(done.quiz), [], 0), /选择/)
})
test('cloud reports support three and four questions and reject a report for another quiz', async () => {
  const { cloudDetailToSession } = await adapter()
  for (const size of [3, 4]) {
    const quiz = quizFixture(); quiz.questions.splice(0, 5 - size)
    const report = { ...reportFixture(), quiz_id: quiz.quiz_id, correct: size, total: size, xp: size * 10, accuracy: 100, weak_points: [] }
    const records = quiz.questions.map(q => ({ question_id: q.id, selected_answers: q.answer, is_correct: false, duration_ms: 1 }))
    assert.equal(cloudDetailToSession({ quiz, answer_records: records, report, created_at }).report?.total, size)
    assert.throws(() => cloudDetailToSession({ quiz, answer_records: records, report: { ...report, quiz_id: 'other' }, created_at }), /格式/)
  }
})
