import Taro from '@tarojs/taro'
import { createApi } from './api'
import { createAuthStore } from '../auth/store'

const AUTH_KEY = 'xueximie-auth-v1'
let activeAuth: ReturnType<typeof createAuthStore> | undefined
export const api = createApi(options => Taro.request(options), API_BASE_URL, {
  credentials: () => activeAuth?.credentials() || null,
  onUnauthorized: token => activeAuth?.expire(token),
})
export const localDevLogin = LOCAL_DEV_LOGIN && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(API_BASE_URL)
export const authStore = activeAuth = createAuthStore({
  read: () => Taro.getStorageSync(AUTH_KEY),
  write: value => Taro.setStorageSync(AUTH_KEY, value),
  clear: () => Taro.removeStorageSync(AUTH_KEY),
}, {
  platform: process.env.TARO_ENV || 'h5',
  devEnabled: localDevLogin,
  getCode: async () => (await Taro.login({ timeout: 10000 })).code,
  login: code => api.login(code).promise,
  devLogin: account => api.devLogin(account).promise,
  getProfile: () => api.getProfile().promise,
})
