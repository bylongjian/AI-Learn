import Taro from '@tarojs/taro'
import { createApi } from './api'

export const api = createApi(options => Taro.request(options), API_BASE_URL)
