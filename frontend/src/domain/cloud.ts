import { attachReport, createSession, getStats, isCorrect, isQuiz } from './learning.ts'
import type { AnswerRecord, Quiz, Report, Session } from './types'

export type HistoryStatus = 'all' | 'pending' | 'completed'
export interface HistoryQuery { page?: number; pageSize?: number; search?: string; status?: HistoryStatus }
export interface HistoryItem {
  quiz_id: string; title: string; question_count: number; correct_count: number | null; accuracy: number | null
  status: 'not-started' | 'completed'; created_at: string
}
export interface HistoryPage { items: HistoryItem[]; total: number; page: number; page_size: number; totals: { all: number; pending: number; completed: number } }
export interface CloudDetail { quiz: Quiz; answer_records: AnswerRecord[]; report: Report | null; created_at: string }
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const id = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(value)
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
const invalid = () => new Error('云端学习记录格式不正确，请重试。')

export function validateHistoryPage(value: unknown): HistoryPage {
  if (!object(value) || !Array.isArray(value.items) || !count(value.total) || !count(value.page) || value.page < 1 || !count(value.page_size) || value.page_size < 1 || value.page_size > 50 || value.items.length > value.page_size || value.items.length > value.total || !object(value.totals)) throw invalid()
  const totals = value.totals
  if (![totals.all, totals.pending, totals.completed].every(count) || totals.all !== totals.pending + totals.completed || value.total > totals.all) throw invalid()
  const seen = new Set<string>()
  for (const row of value.items) {
    if (!object(row) || !id(row.quiz_id) || seen.has(row.quiz_id) || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 20000 || !count(row.question_count) || row.question_count < 3 || row.question_count > 5 || !date(row.created_at)) throw invalid()
    if (row.status === 'completed') {
      if (!count(row.correct_count) || row.correct_count > row.question_count || row.accuracy !== Math.round(row.correct_count / row.question_count * 100)) throw invalid()
    } else if (row.status !== 'not-started' || row.correct_count !== null || row.accuracy !== null) throw invalid()
    seen.add(row.quiz_id)
  }
  return value as HistoryPage
}

/** Cloud only persists generated quizzes and finished reports; partial progress belongs to this device. */
export function cloudDetailToSession(value: unknown, local?: Session): Session {
  if (!object(value) || !isQuiz(value.quiz) || !date(value.created_at) || !Array.isArray(value.answer_records) || !(value.report === null || object(value.report))) throw invalid()
  const quiz = value.quiz
  let session = { ...createSession(quiz), created_at: value.created_at, updated_at: value.created_at }
  if (value.report === null) {
    if (value.answer_records.length) throw invalid()
    if (local?.quiz.quiz_id === quiz.quiz_id) {
      return (quiz.reference && !local.quiz.reference) || (quiz.generation && !local.quiz.generation) ? { ...local, quiz } : local
    }
    return session
  }
  if (value.report.quiz_id !== undefined && value.report.quiz_id !== quiz.quiz_id) throw invalid()
  if (value.answer_records.length !== quiz.questions.length) throw invalid()
  const records: Record<string, AnswerRecord> = {}
  for (const record of value.answer_records) {
    if (!object(record) || !id(record.question_id) || Object.prototype.hasOwnProperty.call(records, record.question_id)) throw invalid()
    const question = quiz.questions.find(q => q.id === record.question_id)
    const selected = record.selected_answers
    if (!question || !Array.isArray(selected) || new Set(selected).size !== selected.length || !selected.every(key => question.options.some(option => option.key === key)) || (question.type !== 'multiple' && selected.length > 1) || !count(record.duration_ms) || typeof record.is_correct !== 'boolean') throw invalid()
    records[question.id] = { question_id: question.id, selected_answers: [...selected], duration_ms: record.duration_ms, is_correct: isCorrect(question, selected) }
  }
  session = { ...session, records, status: 'completed', current_index: quiz.questions.length - 1, report_status: 'pending' }
  return { ...attachReport(session, value.report as Report), updated_at: value.created_at }
}

export function validateCloudDetail(value: unknown, expectedQuizId: string): CloudDetail {
  const session = cloudDetailToSession(value)
  if (session.quiz.quiz_id !== expectedQuizId) throw invalid()
  return value as CloudDetail
}

export function localHistoryItem(session: Session): HistoryItem {
  const stats = getStats(session); const completed = session.status === 'completed'
  return { quiz_id: session.quiz.quiz_id, title: session.quiz.title, question_count: stats.total,
    correct_count: completed ? stats.correct : null, accuracy: completed ? stats.accuracy : null,
    status: completed ? 'completed' : 'not-started', created_at: session.created_at }
}
