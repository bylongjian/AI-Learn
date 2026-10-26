import { emptyState, restoreState } from '../domain/learning.ts'
import type { SavedState, Session } from '../domain/types'

interface Driver { read(): unknown; write(value: SavedState): void }
export interface Snapshot { saved: SavedState; storageFailed: boolean; notice: string }

export function createLearningStore(driver: Driver) {
  let snapshot: Snapshot
  let recoveryNotice = ''
  try {
    const restored = restoreState(driver.read())
    recoveryNotice = restored.warning
    snapshot = { saved: restored.state, storageFailed: false, notice: restored.warning }
  } catch {
    snapshot = { saved: emptyState(), storageFailed: true, notice: '暂时无法读取设备记录，本次仍可继续学习。' }
  }
  const listeners = new Set<() => void>()
  function save(saved: SavedState) {
    let storageFailed = false
    try { driver.write(saved) } catch { storageFailed = true }
    snapshot = { saved, storageFailed, notice: storageFailed ? '本次记录仅在当前页面保留，关闭后可能丢失。' : recoveryNotice }
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    setDraft(draft: string) { save({ ...snapshot.saved, draft }) },
    saveSession(session: Session) {
      const sessions = snapshot.saved.sessions
      const exists = sessions.some(s => s.quiz.quiz_id === session.quiz.quiz_id)
      save({ ...snapshot.saved, sessions: exists ? sessions.map(s => s.quiz.quiz_id === session.quiz.quiz_id ? session : s) : [session, ...sessions] })
    },
    findSession(id?: string) { return snapshot.saved.sessions.find(s => s.quiz.quiz_id === id) },
  }
}
