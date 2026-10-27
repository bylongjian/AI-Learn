import { useSyncExternalStore } from 'react'
import { authStore } from '../services/client'
export { authStore }
export function useAuthStore() {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot)
}
