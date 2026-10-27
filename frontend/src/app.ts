import { PropsWithChildren } from 'react'
import { useLaunch } from '@tarojs/taro'
import { authStore } from './services/client'

import './app.css'

if (process.env.TARO_ENV === 'h5') {
  require('./styles/h5-reset.css')
}

function App({ children }: PropsWithChildren<any>) {
  useLaunch(() => { void authStore.initialize() })
  // children 是将要会渲染的页面
  return children
}



export default App
