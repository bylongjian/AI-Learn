import { useState, type CSSProperties, type ReactNode } from 'react'
import Taro, { useDidShow, useRouter } from '@tarojs/taro'
import { Image, Text, View } from '@tarojs/components'
import { Btn, goRoot, Icon } from './common'
import { useLearningStore } from '../storage'
import signal from '../assets/icons/status-signal.svg'
import wifi from '../assets/icons/status-wifi.svg'
import battery from '../assets/icons/status-battery.svg'

type Root = 'index' | 'library' | 'profile'
const rootOrder: Root[] = ['index', 'library', 'profile']
let lastRoot: Root = 'index'
let lastPage = ''
function nativeMetrics(): CSSProperties {
  if (process.env.TARO_ENV !== 'weapp') return {}
  try {
    const info = Taro.getWindowInfo(); const capsule = Taro.getMenuButtonBoundingClientRect()
    const status = info.statusBarHeight || 0
    return { '--status-height': `${status}px`, '--nav-height': `${Math.max(40, capsule.height + (capsule.top - status) * 2)}px`, '--bottom-inset': `${Math.max(0, info.screenHeight - (info.safeArea?.bottom || info.screenHeight))}px` } as CSSProperties
  } catch { return {} }
}
export default function AppShell({ children, active, onBack, backLabel = '返回闯关', overlay }: { children: ReactNode; active?: Root; onBack?: () => void; backLabel?: string; overlay?: ReactNode }) {
  const { notice } = useLearningStore()
  const route = useRouter()
  const [transition, setTransition] = useState({ revision: 0, direction: 1 })
  useDidShow(() => {
    const page = `${route.path}:${route.params.id || ''}`
    if (page === lastPage) return
    const direction = active && rootOrder.indexOf(active) <= rootOrder.indexOf(lastRoot) ? -1 : 1
    lastPage = page
    if (active) lastRoot = active
    setTransition(value => ({ revision: value.revision + 1, direction }))
  })
  const isWeapp = process.env.TARO_ENV === 'weapp'
  return <View className={`app-shell ${isWeapp ? 'weapp-shell' : 'h5-shell'}`} style={nativeMetrics()}>
    {isWeapp ? <View className='native-status' /> : <View className='status-bar'><Text>9:41</Text><View className='system-icons'><Image src={signal} /><Image src={wifi} /><Image src={battery} /></View></View>}
    <View className='app-header'>{active ? <Text className='app-wordmark'>学习咩</Text> : <Btn className='back-button' onClick={onBack || (() => goRoot('index'))}><Icon name='left' /><Text>{backLabel}</Text></Btn>}{!isWeapp && <View className='wechat-capsule'><Text className='capsule-dots'>•••</Text><View className='capsule-line' /><View className='capsule-ring' /></View>}</View>
    <View className={`screen-main${transition.revision ? ` page-slide-${transition.revision % 2 ? 'a' : 'b'}` : ''}`} style={{ '--page-slide-x': `${transition.direction * 100}%` } as CSSProperties}>{notice && <View className='storage-notice'>{notice}</View>}{children}</View>
    {active && <View className='tab-bar'>{(['index', 'library', 'profile'] as Root[]).map((key, index) => <Btn key={key} className={`tab-item${active === key ? ' active' : ''}`} onClick={() => { if (key !== active) void goRoot(key) }}><Icon name={(['home', 'layers', 'user'] as const)[index]} tone={active === key ? 'active' : 'muted'} /><Text>{['闯关', '题库', '我的'][index]}</Text></Btn>)}</View>}
    <View className='home-area' />{overlay}
  </View>
}
