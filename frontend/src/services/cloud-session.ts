import { cloudDetailToSession } from '../domain/cloud.ts'
import { attachReport } from '../domain/learning.ts'
import type { CloudDetail } from '../domain/cloud'
import type { Report, Session } from '../domain/types'

interface Store { getScope(): string; findSession(id: string): Session | undefined; saveSession(session: Session, scope?: string): boolean }
interface Pending<T> { promise: Promise<T>; cancel(): void }
interface Api {
  getQuizDetail(id: string, expectedUserId: string): Pending<CloudDetail>
  generateReport(session: Session, expectedUserId: string | null): Pending<Report>
}
export function createSessionAccess(store: Store, api: Api, onReportSaved: (userId: string) => void = () => {}) {
  function operation(scope: string, run: (check: () => void, track: (request: { cancel(): void }) => void) => Promise<Session>): Pending<Session> {
    let canceled = false; let active: { cancel(): void } | undefined
    const check = () => {
      if (canceled) throw new Error('已取消读取学习记录。')
      if (store.getScope() !== scope) throw new Error('账号已切换，请在原账号重新打开学习记录。')
    }
    return { promise: run(check, request => { active = request }), cancel() { canceled = true; active?.cancel() } }
  }
  function read(quizId: string, scope: string, requireCloud = false): Pending<Session> {
    return operation(scope, async (check, track) => {
      check(); const local = store.findSession(quizId)
      if (local?.report || (local && !requireCloud) || (scope === 'guest' && local)) return local
      if (scope === 'guest') throw new Error('当前设备没有这份学习记录，请登录原账号后重试。')
      const request = api.getQuizDetail(quizId, scope.slice(5)); track(request)
      const detail = await request.promise; check()
      const session = cloudDetailToSession(detail, store.findSession(quizId))
      if (!store.saveSession(session, scope)) throw new Error('账号已切换，请在原账号重新打开学习记录。')
      return session
    })
  }
  return {
    read,
    report(quizId: string, scope: string): Pending<Session> {
      return operation(scope, async (check, track) => {
        check(); const reading = read(quizId, scope, true); track(reading)
        const current = await reading.promise; check()
        if (current.report) return current
        if (current.status !== 'completed') throw new Error('请先完成这一轮闯关，再查看学习报告。')
        const request = api.generateReport(current, scope === 'guest' ? null : scope.slice(5)); track(request)
        const report = await request.promise; check()
        const completed = attachReport(current, report)
        if (!store.saveSession(completed, scope)) throw new Error('账号已切换，请在原账号重新打开学习报告。')
        if (scope !== 'guest') onReportSaved(scope.slice(5))
        return completed
      })
    },
  }
}
