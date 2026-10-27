import { useEffect, useSyncExternalStore } from 'react'
import { useDidShow } from '@tarojs/taro'
import { useAuthStore } from '../auth'
import { api, authStore } from '../services/client'
import type { HistoryQuery } from '../domain/cloud'
import { createHistoryStore } from './store'

export const historyStore = createHistoryStore((query, userId) => api.getHistory(query, userId))
const activate = () => historyStore.activateUser(authStore.getSnapshot().user?.id || null)
authStore.subscribe(activate); activate()

export function useCloudHistory(query: HistoryQuery = {}) {
  const auth = useAuthStore(); const userId = auth.user?.id || null
  const search = (query.search || '').trim(); const status = query.status || 'all'; const pageSize = query.pageSize || 10
  const stableQuery = { search, status, pageSize }
  const snapshot = useSyncExternalStore(historyStore.subscribe, () => historyStore.getSnapshot(userId, stableQuery), () => historyStore.getSnapshot(userId, stableQuery))
  const refresh = () => { if (userId) void historyStore.load(userId, stableQuery) }
  useEffect(() => {
    if (userId) void historyStore.load(userId, stableQuery)
    return () => historyStore.cancel(userId, stableQuery)
  }, [userId, search, status, pageSize, snapshot.revision])
  useDidShow(() => { refresh() })
  return { ...snapshot, refresh, loadMore: () => { if (userId) void historyStore.load(userId, stableQuery, true) } }
}
