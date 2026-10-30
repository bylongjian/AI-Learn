import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSession, isQuiz, restoreState, submitAnswer } from '../src/domain/learning.ts'
import { cloudDetailToSession } from '../src/domain/cloud.ts'
import { quizFixture } from './fixtures.ts'

export function knowledgeQuiz(mode: 'document' | 'model_fallback' = 'document'): any {
  const quiz = quizFixture()
  return { ...quiz, generation: { mode, doc_id: '26abc7a0-6639-4a4d-842f-2889d3f555cc', doc_name: '课程.pdf',
    reason: mode === 'model_fallback' ? 'web_unavailable' : null,
    message: mode === 'model_fallback' ? '模型生成，未依据文档或联网资料核实' : '依据所选文档出题' },
    reference: mode === 'model_fallback' ? null : { topic: 'RAG', retrieved_at: '2026-10-30T03:00:00Z',
      sources: [{ id: 's1', kind: 'document', title: '课程.pdf', url: null, published_at: null,
        excerpt: '文档中的真实片段。', doc_id: '26abc7a0-6639-4a4d-842f-2889d3f555cc', chunk_id: 'doc:0', page: 2 }],
      question_sources: quiz.questions.map(q => ({ question_id: q.id, source_ids: ['s1'] })) } }
}

test('文档来源和生成方式通过本机与云端保存往返保留', () => {
  const quiz = knowledgeQuiz()
  assert.equal(isQuiz(quiz), true)
  const session = createSession(quiz)
  assert.deepEqual(restoreState({ version: 1, draft: '', sessions: [session] }).state.sessions[0].quiz, quiz)
  const cloud = cloudDetailToSession({ quiz, answer_records: [], report: null, created_at: session.created_at })
  assert.deepEqual(cloud.quiz.generation, quiz.generation)
})

test('模型兜底不能冒充有来源的题库，旧记录继续可读', () => {
  const quiz = knowledgeQuiz('model_fallback')
  assert.equal(isQuiz(quiz), true)
  assert.equal(isQuiz({ ...quiz, reference: knowledgeQuiz().reference }), false)
  assert.equal(isQuiz({ ...knowledgeQuiz(), reference: null }), false)
  assert.equal(isQuiz(quizFixture()), true)
})

test('云端补回兜底信息时保留本机已答进度', () => {
  const local = submitAnswer(createSession(quizFixture()), ['A'], 100)
  const quiz = knowledgeQuiz('model_fallback')
  const updated = cloudDetailToSession({ quiz, answer_records: [], report: null, created_at: local.created_at }, local)
  assert.deepEqual(updated.records, local.records)
  assert.deepEqual(updated.quiz.generation, quiz.generation)
})
