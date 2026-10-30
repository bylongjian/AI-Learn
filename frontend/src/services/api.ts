import { attachReport, isQuiz, toReportRequest, validateTopic } from '../domain/learning.ts'
import type { Quiz, Report, Session } from '../domain/types'
import { isProfile } from '../auth/types.ts'
import type { Credentials, LoginResult, UserProfile } from '../auth/types'
import { validateCloudDetail, validateHistoryPage } from '../domain/cloud.ts'
import type { HistoryQuery } from '../domain/cloud'
import { validateDocument, validateDocumentList, validateSelectedFile } from '../domain/knowledge.ts'
import type { SelectedFile } from '../domain/knowledge'

interface RequestOptions { url: string; method: 'POST' | 'GET' | 'PUT' | 'DELETE'; data?: unknown; timeout: number; header: Record<string, string> }
interface Response { statusCode: number; data: any; header?: Record<string, string> }
type Task = Promise<Response> & { abort?: () => void }
export type Request = (options: RequestOptions) => Task
export interface UploadOptions { url: string; file: SelectedFile; timeout: number; header: Record<string, string> }
export type Upload = (options: UploadOptions) => Task
export interface Pending<T> { promise: Promise<T>; cancel: () => void; userId: string | null }
interface Auth { credentials(): Credentials | null; onUnauthorized?: (token: string) => void }
export class ApiError extends Error {
  constructor(message: string, public statusCode: number, public code?: number) { super(message) }
}

export interface TopicOption { label: string; description: string }
export class TopicClarificationError extends ApiError {
  constructor(message: string, public options: TopicOption[]) { super(message, 409, 40902) }
}
function clarificationOptions(value: unknown): TopicOption[] {
  const options = (value as { options?: unknown })?.options
  if (!Array.isArray(options) || options.length < 2 || options.length > 4 ||
    !options.every(option => option && typeof option.label === 'string' && !!option.label.trim() && Array.from(option.label).length <= 40 &&
      typeof option.description === 'string' && !!option.description.trim() && Array.from(option.description).length <= 150) ||
    new Set(options.map(option => option.label)).size !== options.length) throw new ApiError('领域选项不完整，请补充具体领域后重试。', 409, 40902)
  return options.map(({ label, description }) => ({ label, description }))
}

export function createApi(request: Request, baseUrl: string, auth?: Auth, upload?: Upload) {
  function send<T>(method: RequestOptions['method'], path: string, data: unknown, validate: (value: unknown) => T, publicRequest = false, expectedUserId?: string | null, file?: SelectedFile): Pending<T> {
    const identity = publicRequest ? null : auth?.credentials() || null
    if (expectedUserId !== undefined && expectedUserId !== (identity?.userId || null)) throw new Error('登录已失效或账号已切换，请在原账号重试。')
    const header: Record<string, string> = file ? {} : { 'content-type': 'application/json' }
    if (identity) header.Authorization = `Bearer ${identity.token}`
    const url = baseUrl.replace(/\/+$/, '') + '/api/v1/' + path
    const task = file ? upload!({ url, file, timeout: 60000, header }) : request({ url, method, data, timeout: 60000, header })
    const promise = task.catch(() => { throw new Error(file ? '上传连接中断，请先刷新列表确认是否已上传，再决定是否重传。' : '连接暂时中断，请检查网络后重试。') }).then(response => {
      if (!publicRequest && auth && (identity?.userId || null) !== (auth.credentials()?.userId || null)) throw new Error('账号已切换，请在当前账号重新打开。')
      let body = response.data
      if (file && typeof body === 'string') {
        try { body = JSON.parse(body) } catch { throw new Error('上传返回信息不完整，请刷新知识库确认文件状态。') }
      }
      if (response.statusCode < 200 || response.statusCode >= 300 || !body || body.code !== 0) {
        if (response.statusCode === 401 && identity) auth?.onUnauthorized?.(identity.token)
        if (path === 'quiz/generate' && response.statusCode === 409 && body?.code === 40902) {
          throw new TopicClarificationError('这个主题有多个含义，请选择你想学习的领域。', clarificationOptions(body.data))
        }
        throw new ApiError(typeof body?.message === 'string' ? body.message.slice(0, 200) : '请求失败，请稍后重试。', response.statusCode, body?.code)
      }
      if (identity && (path === 'quiz/generate' || path === 'report/generate')) {
        const headers = response.header || {}
        const owner = Object.entries(headers).find(([name]) => name.toLowerCase() === 'x-learning-user')?.[1]
        if (owner !== identity.userId) {
          auth?.onUnauthorized?.(identity.token)
          throw new ApiError('登录已失效，本次内容未保存到账号。请重新登录后重试。', 401)
        }
      }
      return validate(body.data)
    })
    return { promise, cancel: () => task.abort?.(), userId: identity?.userId || null }
  }
  function profile(value: unknown): UserProfile {
    if (!isProfile(value)) throw new Error('用户资料格式不正确，请重试。')
    return value
  }
  function login(value: unknown): LoginResult {
    const result = value as LoginResult
    if (!result || typeof result.token !== 'string' || !result.token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('登录数据格式不正确，请重试。')
    return { ...result, user: profile(result.user) }
  }
  return {
    login(code: string) { return send('POST', 'user/login', { code }, login, true) },
    devLogin(account: 'a' | 'b') { return send('POST', 'user/dev-login', { account }, login, true) },
    getProfile() { return send('GET', 'user/profile', undefined, profile) },
    getKnowledgeDocuments(expectedUserId: string) {
      return send('GET', 'knowledge/documents', undefined, validateDocumentList, false, expectedUserId)
    },
    getKnowledgeDocument(docId: string, expectedUserId: string) {
      return send('GET', `knowledge/documents/${encodeURIComponent(docId)}`, undefined, validateDocument, false, expectedUserId)
    },
    deleteKnowledgeDocument(docId: string, expectedUserId: string) {
      return send('DELETE', `knowledge/documents/${encodeURIComponent(docId)}`, undefined, value => {
        const result = value as { doc_id?: unknown; status?: unknown } | null
        if (result?.doc_id !== docId || result?.status !== 'deleting') throw new Error('删除状态未确认，请刷新知识库。')
        return { doc_id: docId, status: 'deleting' as const }
      }, false, expectedUserId)
    },
    uploadDocument(file: SelectedFile, expectedUserId: string) {
      validateSelectedFile(file)
      if (!upload) throw new Error('当前客户端尚未接入文件上传。')
      return send('POST', 'knowledge/documents', undefined, validateDocument, false, expectedUserId, file)
    },
    updateProfile(data: { nickname: string; avatar_url?: string }) { return send('PUT', 'user/profile', data, profile) },
    getHistory(query: HistoryQuery = {}, expectedUserId?: string) {
      const { page = 1, pageSize = 10, search = '', status = 'all' } = query
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 || Array.from(search).length > 100 || !['all', 'pending', 'completed'].includes(status)) throw new Error('题库筛选条件不正确。')
      return send('GET', `user/quizzes?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search.trim())}&status=${status}`, undefined, validateHistoryPage, false, expectedUserId)
    },
    getQuizDetail(quizId: string, expectedUserId?: string) {
      return send('GET', `user/quizzes/${encodeURIComponent(quizId)}`, undefined, value => validateCloudDetail(value, quizId), false, expectedUserId)
    },
    generateQuiz(input: string, expectedUserId?: string | null, topicContext?: string, docId?: string): Pending<Quiz> {
      const error = validateTopic(input)
      if (error) throw new Error(error)
      if (topicContext !== undefined && (!topicContext.trim() || Array.from(topicContext).length > 200 || /[\x00-\x1f\x7f]/.test(topicContext))) throw new Error('领域描述不正确，请重新选择。')
      return send('POST', 'quiz/generate', { user_input: input, question_count: 5, difficulty: 'mixed', ...(topicContext ? { topic_context: topicContext.trim() } : {}), ...(docId ? { doc_id: docId } : {}) }, value => {
        if (!isQuiz(value)) throw new Error('题库格式不正确，请重新生成。')
        return value
      }, false, expectedUserId)
    },
    generateReport(session: Session, expectedUserId?: string | null): Pending<Report> {
      return send('POST', 'report/generate', toReportRequest(session), value => attachReport(session, value as Report).report!, false, expectedUserId)
    },
  }
}
