import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { quizFixture, reportFixture } from './fixtures.ts'
import type { Session } from '../src/domain/types'

let M: any
before(async () => { M = await import('../src/domain/learning.ts').catch(() => ({})) })

function complete(wrong = [4]): Session {
  let session = M.createSession(quizFixture())
  for (let i = 0; i < 5; i++) {
    const q = session.quiz.questions[i]
    const selected = wrong.includes(i) ? [q.options.find(o => !q.answer.includes(o.key))!.key] : q.answer
    session = M.advanceSession(M.submitAnswer(session, selected, 1200))
  }
  return session
}

test('空白、2000 字边界与 emoji 按码点校验', () => {
  assert.equal(typeof M.validateTopic, 'function')
  assert.match(M.validateTopic('  \n'), /输入/)
  assert.equal(M.validateTopic('😀'.repeat(2000)), '')
  assert.match(M.validateTopic('😀'.repeat(2001)), /2000/)
})

test('接收题库时拒绝非法答案、重复题号及题型缺失', () => {
  assert.equal(M.isQuiz(quizFixture()), true)
  for (const mutate of [
    (q: any) => { q.questions[0].answer = ['Z'] },
    (q: any) => { q.questions[1].id = q.questions[0].id },
    (q: any) => { q.questions[3].type = 'single' },
    (q: any) => { q.questions[0].options[0].text = '' },
  ]) {
    const q = quizFixture(); mutate(q); assert.equal(M.isQuiz(q), false)
  }
})

test('未选择不能提交，未作答不能下一题，已提交不能重复加分', () => {
  const s = M.createSession(quizFixture())
  assert.throws(() => M.submitAnswer(s, [], 1), /选择/)
  assert.throws(() => M.advanceSession(s), /作答/)
  assert.throws(() => M.submitAnswer(s, ['A', 'B'], 1), /一个/)
  assert.throws(() => M.submitAnswer(s, ['Z'], 1), /选项/)
  const answered = M.submitAnswer(s, ['A'], 100)
  assert.equal(M.getStats(answered).xp, 10)
  assert.throws(() => M.submitAnswer(answered, ['B'], 1), /提交/)
  assert.equal(Object.keys(s.records).length, 0)
})

test('多选精确集合判定，乱序正确，少选、多选错误', () => {
  let s = M.createSession(quizFixture())
  for (let i = 0; i < 3; i++) s = M.advanceSession(M.submitAnswer(s, ['A'], 1))
  assert.equal(M.submitAnswer(s, ['B', 'A'], 1).records['rag-4'].is_correct, true)
  assert.equal(M.submitAnswer(s, ['A'], 1).records['rag-4'].is_correct, false)
  assert.equal(M.submitAnswer(s, ['A', 'B', 'C'], 1).records['rag-4'].is_correct, false)
  assert.throws(() => M.submitAnswer(s, ['A', 'A'], 1), /重复/)
})

test('五题对四题得到80%/40XP，答完进入报告待生成状态', () => {
  const s = complete()
  assert.deepEqual(M.getStats(s), { total: 5, answered: 5, correct: 4, xp: 40, accuracy: 80 })
  assert.equal(s.status, 'completed')
  assert.equal(s.report_status, 'pending')
  assert.equal(s.report, undefined)
  const body = M.toReportRequest(s)
  assert.equal(body.answer_records.length, 5)
  assert.equal(body.quiz_id, s.quiz.quiz_id)
})

test('报告统计必须和记录一致，重试不会增加 XP', () => {
  const s = complete()
  const ready = M.attachReport(s, reportFixture())
  assert.equal(ready.report_status, 'ready')
  assert.equal(M.getStats(ready).xp, 40)
  assert.throws(() => M.attachReport(s, { ...reportFixture(), accuracy: 100 }), /报告/)
  assert.throws(() => M.toReportRequest(M.createSession(quizFixture())), /完成/)
})

test('个人统计累计未完成XP，正确率按已完成总题数加权', () => {
  const full = complete()
  const perfect = complete([])
  const pending = M.submitAnswer(M.createSession({ ...quizFixture(), quiz_id: 'pending' }), ['A'], 1)
  assert.deepEqual(M.getProfileStats([full, perfect, pending]), { xp: 100, completed: 2, accuracy: 90 })
  assert.equal(M.getProfileStats([]).accuracy, null)
})

test('缓存可恢复完整进度；损坏记录隔离处理，保留有效关卡与草稿', () => {
  const completed = complete()
  const valid = { version: 1, draft: '我的草稿', sessions: [completed] }
  assert.equal(M.restoreState(valid).state.sessions.length, 1)
  const corrupt = structuredClone(completed)
  corrupt.quiz.quiz_id = 'broken'
  corrupt.records['rag-1'].is_correct = false
  const result = M.restoreState({ ...valid, sessions: [completed, corrupt] })
  assert.equal(result.state.sessions.length, 1)
  assert.equal(result.state.draft, '我的草稿')
  assert.match(result.warning, /记录/)
  assert.equal(M.restoreState(undefined).state.sessions.length, 0)
  assert.equal(M.restoreState({ version: 99 }).state.sessions.length, 0)
})

test('已完成但报告生成失败的关卡可恢复，不必重新答题', () => {
  const s = { ...complete(), report_status: 'failed' }
  const result = M.restoreState({ version: 1, draft: '', sessions: [s] })
  assert.equal(result.state.sessions[0].report_status, 'failed')
  assert.equal(result.state.sessions[0].current_index, 4)
})

test('合法题号与Object原型同名时仍是未作答，缓存恢复不丢弃关卡', () => {
  const quiz = quizFixture(); quiz.questions[0].id = 'toString'
  const session = M.createSession(quiz)
  const restored = M.restoreState(JSON.parse(JSON.stringify({ version: 1, draft: '', sessions: [session] })))
  assert.equal(restored.state.sessions.length, 1)
  assert.equal(M.getAnswerRecord(session, 'toString'), undefined)
  const answered = M.submitAnswer(session, ['A'], 1)
  assert.equal(M.getAnswerRecord(answered, 'toString').is_correct, true)
  assert.equal(M.getStats(answered).xp, 10)
})
