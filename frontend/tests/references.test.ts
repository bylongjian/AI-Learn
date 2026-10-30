import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, isQuiz, restoreState, submitAnswer } from '../src/domain/learning.ts'
import { cloudDetailToSession } from '../src/domain/cloud.ts'
import { quizFixture } from './fixtures.ts'

function quizWithSources(): any {
  const quiz = quizFixture()
  return { ...quiz, reference: { topic: 'RAG', retrieved_at: '2026-10-28T12:00:00Z',
    sources: [{ id: 's1', kind: 'web', title: 'Original guide', url: 'https://example.org/guide', published_at: null, excerpt: 'Actual supporting passage.' }],
    question_sources: quiz.questions.map(q => ({ question_id: q.id, source_ids: ['s1'] })) } }
}

test('来源随本机题库恢复，旧题库缺省或空来源仍可读', () => {
  const quiz = quizWithSources()
  assert.equal(isQuiz(quiz), true)
  const session = createSession(quiz)
  const restored = restoreState({ version: 1, draft: '', sessions: [session] })
  assert.deepEqual((restored.state.sessions[0].quiz as any).reference, quiz.reference)
  assert.equal(isQuiz(quizFixture()), true)
  assert.equal(isQuiz({ ...quizFixture(), reference: null }), true)
})

test('损坏引用被拒绝，其他有效旧记录仍保留', () => {
  const invalid = quizWithSources()
  invalid.reference.question_sources[0].source_ids = ['unknown']
  assert.equal(isQuiz(invalid), false)
  const old = createSession(quizFixture())
  const restored = restoreState({ version: 1, draft: '', sessions: [old, { ...old, quiz: invalid }] })
  assert.equal(restored.state.sessions.length, 1)
})

test('逐题关联不能遗漏、重复或引用其他题目', () => {
  for (const change of ['missing', 'duplicate', 'other', 'unsafe-url']) {
    const quiz = quizWithSources()
    if (change === 'missing') quiz.reference.question_sources.pop()
    if (change === 'duplicate') quiz.reference.sources.push(quiz.reference.sources[0])
    if (change === 'other') quiz.reference.question_sources[0].question_id = 'other-question'
    if (change === 'unsafe-url') quiz.reference.sources[0].url = 'javascript:alert(1)'
    assert.equal(isQuiz(quiz), false, change)
  }
})

test('从云端补齐来源时保留本机未完成作答', () => {
  const local = submitAnswer(createSession(quizFixture()), ['A'], 100)
  const quiz = quizWithSources()
  const restored = cloudDetailToSession({ quiz, answer_records: [], report: null, created_at: '2026-10-28T12:00:00Z' }, local)
  assert.deepEqual(restored.records, local.records)
  assert.deepEqual((restored.quiz as any).reference, quiz.reference)
})
