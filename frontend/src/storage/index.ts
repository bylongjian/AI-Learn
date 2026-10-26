import Taro from '@tarojs/taro'
import { useSyncExternalStore } from 'react'
import { createLearningStore } from './store'

const STORAGE_KEY = 'xueximie-learning-v1'
export const learningStore = createLearningStore({
  read: () => Taro.getStorageSync(STORAGE_KEY),
  write: value => Taro.setStorageSync(STORAGE_KEY, value),
})
export function useLearningStore() {
  return useSyncExternalStore(learningStore.subscribe, learningStore.getSnapshot, learningStore.getSnapshot)
}
