import { api, authStore } from './client'
import { createSessionAccess } from './cloud-session'
import { learningStore } from '../storage'
import { historyStore } from '../history'

export const sessionAccess = createSessionAccess(learningStore, api, userId => {
  historyStore.invalidate(userId)
  void authStore.refreshProfile(true)
})
