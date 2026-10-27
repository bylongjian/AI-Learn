import { emptyState, restoreState } from '../domain/learning.ts'
import type { SavedState, Session } from '../domain/types'

interface Driver { read(scope?: string): unknown; write(value: SavedState, scope?: string): void }
export interface Snapshot { saved: SavedState; storageFailed: boolean; notice: string }

export function createLearningStore(driver: Driver) {
  let scope = 'guest'
  const snapshots = new Map<string, Snapshot>()
  let snapshot: Snapshot
  let recoveryNotice = ''
  function read(): Snapshot {
    try {
      const restored = restoreState(driver.read(scope))
      recoveryNotice = restored.warning
      return { saved: restored.state, storageFailed: false, notice: restored.warning }
    } catch {
      recoveryNotice = ''
      return { saved: emptyState(), storageFailed: true, notice: '暂时无法读取设备记录，本次仍可继续学习。' }
    }
  }
  snapshot = read()
  const listeners = new Set<() => void>()
  function save(saved: SavedState) {
    let storageFailed = false
    try { driver.write(saved, scope) } catch { storageFailed = true }
    snapshot = { saved, storageFailed, notice: storageFailed ? '本次记录仅在当前页面保留，关闭后可能丢失。' : recoveryNotice }
    listeners.forEach(listener => listener())
  }
  return {
    getScope: () => scope,
    activateScope(userId: string | null) {
      const nextScope = userId === null ? 'guest' : `user:${userId}`
      if (nextScope === scope) return
      snapshots.set(scope, snapshot); scope = nextScope
      snapshot = snapshots.get(scope) || read()
      recoveryNotice = snapshot.storageFailed ? '' : snapshot.notice
      listeners.forEach(listener => listener())
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setDraft(draft: string) { save({ ...snapshot.saved, draft }) },
    saveSession(session: Session, expectedScope = scope) {
      if (expectedScope !== scope) return false
      const sessions = snapshot.saved.sessions
      const exists = sessions.some(s => s.quiz.quiz_id === session.quiz.quiz_id)
      save({ ...snapshot.saved, sessions: exists ? sessions.map(s => s.quiz.quiz_id === session.quiz.quiz_id ? session : s) : [session, ...sessions] })
      return true
    },
    findSession(id?: string) { return snapshot.saved.sessions.find(s => s.quiz.quiz_id === id) },
  }
}
