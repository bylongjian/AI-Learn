import type { AnswerRecord, OptionKey, Question, Quiz, Report, SavedState, Session } from './types'

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 20000): v is string => typeof v === 'string' && !!v.trim() && Array.from(v).length <= max
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key)
const safeId = (v: unknown): v is string => text(v, 200) && !['__proto__', 'constructor', 'prototype'].includes(v)
const unique = (v: unknown[]): boolean => new Set(v).size === v.length
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => text(item))

export function validateTopic(value: string): string {
  if (!value.trim()) return '先输入一个想学的主题或一段文本。'
  if (Array.from(value).length > 2000) return '内容超过 2000 字，请精简后再试。'
  return ''
}

function isQuestion(q: unknown): q is Question {
  if (!object(q) || !safeId(q.id) || !text(q.stem) || !text(q.explanation) || !text(q.knowledge_point) ||
    !['single', 'multiple', 'judge'].includes(q.type) || !['easy', 'medium', 'hard'].includes(q.difficulty) ||
    !Array.isArray(q.options) || !Array.isArray(q.answer)) return false
  const keys = q.type === 'judge' ? ['A', 'B'] : ['A', 'B', 'C', 'D']
  return q.options.length === keys.length && q.options.every((o: unknown) => object(o) && keys.includes(o.key) && text(o.text)) &&
    unique(q.options.map((o: any) => o.key)) && unique(q.answer) &&
    q.answer.length >= (q.type === 'multiple' ? 2 : 1) && q.answer.length <= (q.type === 'multiple' ? 4 : 1) &&
    q.answer.every((key: unknown) => keys.includes(key as string))
}

export function isQuiz(value: unknown): value is Quiz {
  if (!object(value) || !safeId(value.quiz_id) || !text(value.title) || !text(value.summary) || value.source_type !== 'text' ||
    !text(value.user_input, 2000) || !Array.isArray(value.questions) || value.questions.length < 3 || value.questions.length > 5 ||
    !value.questions.every(isQuestion) || !unique(value.questions.map((q: Question) => q.id))) return false
  return value.questions.filter((q: Question) => q.type === 'single').length === value.questions.length - 2 &&
    value.questions.filter((q: Question) => q.type === 'multiple').length === 1 &&
    value.questions.filter((q: Question) => q.type === 'judge').length === 1
}

export function createSession(quiz: Quiz): Session {
  if (!isQuiz(quiz)) throw new Error('题库格式不正确，请重新生成。')
  const now = new Date().toISOString()
  return { quiz, created_at: now, updated_at: now, current_index: 0, records: {}, status: 'not-started', report_status: 'none' }
}

export function isCorrect(question: Question, selected: OptionKey[]): boolean {
  return selected.length === question.answer.length && question.answer.every(key => selected.includes(key))
}

export function getAnswerRecord(session: Session, questionId: string): AnswerRecord | undefined {
  return own(session.records, questionId) ? session.records[questionId] : undefined
}

function validSelection(question: Question, selected: unknown): selected is OptionKey[] {
  return Array.isArray(selected) && !!selected.length && unique(selected) &&
    selected.every(key => question.options.some(o => o.key === key)) && (question.type === 'multiple' || selected.length === 1)
}

export function submitAnswer(session: Session, selected: OptionKey[], durationMs: number): Session {
  const q = session.quiz.questions[session.current_index]
  if (session.status === 'completed' || own(session.records, q.id)) throw new Error('本题已提交，请继续下一题。')
  if (!selected.length) throw new Error('请先选择答案。')
  if (!unique(selected)) throw new Error('不能重复选择同一个选项。')
  if (q.type !== 'multiple' && selected.length !== 1) throw new Error('这道题请选择一个答案。')
  if (!validSelection(q, selected)) throw new Error('包含无效选项。')
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('作答用时不正确，请重试。')
  const record: AnswerRecord = { question_id: q.id, selected_answers: [...selected], is_correct: isCorrect(q, selected), duration_ms: Math.round(durationMs) }
  return { ...session, status: 'in-progress', updated_at: new Date().toISOString(), records: { ...session.records, [q.id]: record } }
}

export function advanceSession(session: Session): Session {
  const q = session.quiz.questions[session.current_index]
  if (!own(session.records, q.id)) throw new Error('请先完成本题作答。')
  if (session.current_index === session.quiz.questions.length - 1) {
    return { ...session, status: 'completed', report_status: session.report ? 'ready' : 'pending', updated_at: new Date().toISOString() }
  }
  return { ...session, current_index: session.current_index + 1, updated_at: new Date().toISOString() }
}

export function getStats(session: Session) {
  const total = session.quiz.questions.length
  const answered = session.quiz.questions.filter(q => own(session.records, q.id))
  const correct = answered.filter(q => isCorrect(q, session.records[q.id].selected_answers)).length
  return { total, answered: answered.length, correct, xp: correct * 10, accuracy: Math.round(correct / total * 100) }
}

export function getProfileStats(sessions: Session[]) {
  let xp = 0; let completed = 0; let correct = 0; let total = 0
  for (const session of sessions) {
    const stats = getStats(session); xp += stats.xp
    if (session.status === 'completed') { completed++; correct += stats.correct; total += stats.total }
  }
  return { xp, completed, accuracy: total ? Math.round(correct / total * 100) : null }
}

export function toReportRequest(session: Session) {
  if (session.status !== 'completed' || getStats(session).answered !== session.quiz.questions.length) throw new Error('请先完成本轮学习。')
  return { quiz_id: session.quiz.quiz_id, topic: session.quiz.user_input, questions: session.quiz.questions,
    answer_records: session.quiz.questions.map(q => session.records[q.id]) }
}

function isReport(r: unknown, session: Session): r is Report {
  if (!object(r)) return false
  const stats = getStats(session)
  return r.accuracy === stats.accuracy && r.correct === stats.correct && r.total === stats.total && r.xp === stats.xp &&
    strings(r.mastered_points) && strings(r.weak_points) && strings(r.three_line_summary) && r.three_line_summary.length === 3 &&
    strings(r.advice) && r.advice.length > 0 && text(r.share_quote) && (stats.correct !== stats.total || r.weak_points.length === 0)
}

export function attachReport(session: Session, report: Report): Session {
  if (session.status !== 'completed' || !isReport(report, session)) throw new Error('报告数据不完整或与答题记录不一致，请重试。')
  return { ...session, report, report_status: 'ready', updated_at: new Date().toISOString() }
}

function isSession(s: unknown): s is Session {
  if (!object(s) || !isQuiz(s.quiz) || !text(s.created_at) || !text(s.updated_at) || !Number.isFinite(Date.parse(s.created_at)) ||
    !Number.isFinite(Date.parse(s.updated_at)) || !object(s.records) || !Number.isInteger(s.current_index) || s.current_index < 0 ||
    s.current_index >= s.quiz.questions.length || !['not-started', 'in-progress', 'completed'].includes(s.status) ||
    !['none', 'pending', 'failed', 'ready'].includes(s.report_status)) return false
  const session = s as Session
  if (Object.keys(session.records).some(id => !session.quiz.questions.some(q => q.id === id))) return false
  for (let i = 0; i < session.quiz.questions.length; i++) {
    const q = session.quiz.questions[i]; const r = getAnswerRecord(session, q.id)
    const canonicalBlank = session.status === 'completed' && session.report_status === 'ready' && Array.isArray(r?.selected_answers) && r.selected_answers.length === 0
    if (r !== undefined && (!object(r) || r.question_id !== q.id || (!validSelection(q, r.selected_answers) && !canonicalBlank) ||
      r.is_correct !== isCorrect(q, r.selected_answers) || !Number.isInteger(r.duration_ms) || r.duration_ms < 0)) return false
    if ((i < session.current_index && !r) || (i > session.current_index && r)) return false
  }
  const stats = getStats(session)
  if (session.status === 'not-started' && (stats.answered || session.current_index !== 0)) return false
  if (session.status === 'completed' && (stats.answered !== stats.total || session.current_index !== stats.total - 1)) return false
  if (session.status !== 'completed' && (session.report_status !== 'none' || session.report !== undefined)) return false
  if (session.status === 'completed' && session.report_status === 'none') return false
  if (session.report_status === 'ready') return isReport(session.report, session)
  return session.report === undefined
}

export const emptyState = (): SavedState => ({ version: 1, draft: '', sessions: [] })

export function restoreState(value: unknown): { state: SavedState; warning: string } {
  if (value === undefined || value === null || value === '') return { state: emptyState(), warning: '' }
  if (!object(value) || value.version !== 1 || !Array.isArray(value.sessions)) {
    return { state: emptyState(), warning: '原有学习记录无法读取，本次可以继续学习。' }
  }
  const seen = new Set<string>()
  const sessions: Session[] = value.sessions.filter((s: unknown) => {
    if (!isSession(s) || seen.has(s.quiz.quiz_id)) return false
    seen.add(s.quiz.quiz_id); return true
  })
  const draft = typeof value.draft === 'string' && Array.from(value.draft).length <= 2000 ? value.draft : ''
  return { state: { version: 1, draft, sessions }, warning: sessions.length !== value.sessions.length || draft !== value.draft
    ? '部分学习记录无法读取，已保留其他有效关卡。' : '' }
}
