import { attachReport, isQuiz, toReportRequest, validateTopic } from '../domain/learning.ts'
import type { Quiz, Report, Session } from '../domain/types'

interface RequestOptions { url: string; method: 'POST'; data: unknown; timeout: number; header: Record<string, string> }
interface Response { statusCode: number; data: any }
type Task = Promise<Response> & { abort?: () => void }
export type Request = (options: RequestOptions) => Task
export interface Pending<T> { promise: Promise<T>; cancel: () => void }

export function createApi(request: Request, baseUrl: string) {
  function post<T>(path: string, data: unknown, validate: (value: unknown) => T): Pending<T> {
    const task = request({ url: baseUrl.replace(/\/+$/, '') + '/api/v1/' + path, method: 'POST', data,
      timeout: 60000, header: { 'content-type': 'application/json' } })
    const promise = task.catch(() => { throw new Error('连接暂时中断，请检查网络后重试。') }).then(response => {
      const body = response.data
      if (response.statusCode < 200 || response.statusCode >= 300 || !body || body.code !== 0) {
        throw new Error(typeof body?.message === 'string' ? body.message.slice(0, 200) : '生成失败，请稍后重试。')
      }
      return validate(body.data)
    })
    return { promise, cancel: () => task.abort?.() }
  }
  return {
    generateQuiz(input: string): Pending<Quiz> {
      const error = validateTopic(input)
      if (error) throw new Error(error)
      return post('quiz/generate', { user_input: input, question_count: 5, difficulty: 'mixed' }, value => {
        if (!isQuiz(value)) throw new Error('题库格式不正确，请重新生成。')
        return value
      })
    },
    generateReport(session: Session): Pending<Report> {
      return post('report/generate', toReportRequest(session), value => attachReport(session, value as Report).report!)
    },
  }
}
