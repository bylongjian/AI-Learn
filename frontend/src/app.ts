import { PropsWithChildren } from 'react'

import './app.css'

if (process.env.TARO_ENV === 'h5') {
  require('./styles/h5-reset.css')
}

function App({ children }: PropsWithChildren<any>) {
  // children 是将要会渲染的页面
  return children
}



export default App
