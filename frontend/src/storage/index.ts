import Taro from '@tarojs/taro'
import { useSyncExternalStore } from 'react'
import { createLearningStore } from './store'
import { authStore } from '../services/client'

const STORAGE_KEY = 'xueximie-learning-v1'
export const learningStore = createLearningStore({
  read: scope => Taro.getStorageSync(scope === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${scope}`),
  write: (value, scope) => Taro.setStorageSync(scope === 'guest' ? STORAGE_KEY : `${STORAGE_KEY}:${scope}`, value),
})
const activateIdentity = () => learningStore.activateScope(authStore.getSnapshot().user?.id || null)
authStore.subscribe(activateIdentity)
activateIdentity()
export function useLearningStore() {
  return useSyncExternalStore(learningStore.subscribe, learningStore.getSnapshot, learningStore.getSnapshot)
}
