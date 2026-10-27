import { localHistoryItem } from '../domain/cloud.ts'
import type { HistoryItem, HistoryPage, HistoryQuery } from '../domain/cloud'
import type { Session } from '../domain/types'

export interface HistorySnapshot {
  items: HistoryItem[]; total: number; totals: HistoryPage['totals']; page: number
  loading: boolean; loaded: boolean; error: string; revision: number
}
interface Entry { snapshot: HistorySnapshot; attempt: number; cancel?: () => void; work?: Promise<void> }
type FetchHistory = (query: HistoryQuery, userId: string) => { promise: Promise<HistoryPage>; cancel(): void }
const normalized = (query: HistoryQuery) => ({ pageSize: query.pageSize || 10, search: (query.search || '').trim(), status: query.status || 'all' as const })
const empty = (): HistorySnapshot => ({ items: [], total: 0, totals: { all: 0, pending: 0, completed: 0 }, page: 0, loading: false, loaded: false, error: '', revision: 0 })

export function createHistoryStore(fetchHistory: FetchHistory) {
  let activeUser: string | null = null
  const entries = new Map<string, Entry>(); const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(listener => listener())
  function entry(userId: string | null, query: HistoryQuery) {
    const key = JSON.stringify([userId, normalized(query)])
    if (!entries.has(key)) entries.set(key, { snapshot: empty(), attempt: 0 })
    return entries.get(key)!
  }
  function cancel(target: Entry) {
    target.attempt++; target.cancel?.(); target.cancel = undefined; target.work = undefined
    if (target.snapshot.loading) target.snapshot = { ...target.snapshot, loading: false }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    activateUser(userId: string | null) {
      if (userId === activeUser) return
      for (const target of entries.values()) cancel(target)
      activeUser = userId; emit()
    },
    getSnapshot(userId: string | null, query: HistoryQuery) { return entry(userId, query).snapshot },
    cancel(userId: string | null, query: HistoryQuery) { cancel(entry(userId, query)); emit() },
    invalidate(userId: string | null) {
      if (!userId) return
      for (const [key, target] of entries) if (JSON.parse(key)[0] === userId) {
        cancel(target); target.snapshot = { ...target.snapshot, loaded: false, revision: target.snapshot.revision + 1 }
      }
      emit()
    },
    load(userId: string, query: HistoryQuery, more = false): Promise<void> {
      if (userId !== activeUser) return Promise.resolve()
      const target = entry(userId, query)
      if (target.work) return target.work
      if (more && target.snapshot.loaded && target.snapshot.items.length >= target.snapshot.total) return Promise.resolve()
      const attempt = ++target.attempt
      const page = more ? target.snapshot.page + 1 : 1
      target.snapshot = { ...target.snapshot, loading: true, error: '' }; emit()
      const work = (async () => {
        try {
          const request = fetchHistory({ ...normalized(query), page }, userId); target.cancel = request.cancel
          const result = await request.promise
          if (attempt !== target.attempt || activeUser !== userId) return
          const merged = more ? [...target.snapshot.items, ...result.items] : result.items
          const byId = new Map(merged.map(item => [item.quiz_id, item]))
          target.snapshot = { items: [...byId.values()], total: result.total, totals: result.totals, page: result.page,
            loading: false, loaded: true, error: '', revision: target.snapshot.revision }
        } catch (failure) {
          if (attempt !== target.attempt || activeUser !== userId) return
          target.snapshot = { ...target.snapshot, loading: false, error: failure instanceof Error ? failure.message : '暂时无法读取云端题库，请重试。' }
        } finally {
          if (attempt === target.attempt) { target.cancel = undefined; target.work = undefined; emit() }
        }
      })()
      target.work = work
      // A credential guard can throw before the first await; release that completed operation too.
      void work.then(() => { if (target.work === work) target.work = undefined })
      return work
    },
  }
}

export interface HistoryRow extends HistoryItem { local?: Session }
export function combineHistory(items: HistoryItem[], sessions: Session[], query: HistoryQuery, offline = false) {
  const { search, status } = normalized(query)
  const matches = (row: HistoryItem) => row.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (status === 'all' || (status === 'completed' ? row.status === 'completed' : row.status !== 'completed'))
  const byId = new Map(sessions.map(session => [session.quiz.quiz_id, session]))
  const serverIds = new Set(items.map(row => row.quiz_id))
  const rows: HistoryRow[] = items.filter(matches).map(item => {
    const local = byId.get(item.quiz_id)
    return item.status === 'completed' || !local ? item : { ...localHistoryItem(local), local }
  })
  const deviceRows: HistoryRow[] = sessions.filter(session => !serverIds.has(session.quiz.quiz_id) && (offline || session.status === 'in-progress' || (session.status === 'completed' && !session.report)))
    .map(local => ({ ...localHistoryItem(local), local })).filter(matches)
  return { rows, deviceRows }
}
