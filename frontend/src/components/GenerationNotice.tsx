import { Text, View } from '@tarojs/components'
import type { Quiz } from '../domain/types'
import { Icon } from './common'
import './GenerationNotice.css'

const reasons = {
  document_insufficient: '文档资料不足，已联网补充', document_unavailable: '文档检索未成功，已联网补充',
  web_insufficient: '文档与网络资料仍不足', web_unavailable: '资料获取或联网补充不可用', preparation_timeout: '资料准备达到等待上限',
}

export default function GenerationNotice({ quiz }: { quiz: Quiz }) {
  const info = quiz.generation
  if (!info) return null
  const fallback = info.mode === 'model_fallback'
  return <View className={`generation-notice${fallback ? ' unverified' : ''}`} role='note'>
    <Icon name={fallback ? 'alert' : 'document'} tone={fallback ? 'red' : 'brand'} />
    <View><Text className='generation-notice-title'>{fallback ? '模型生成，未依据文档或联网资料核实' : { document: '依据文档出题', document_web: '依据文档与联网资料出题', web_fallback: '本次依据联网资料出题' }[info.mode]}</Text>
      <View className='generation-notice-copy'>{info.doc_name}{info.reason && ` · ${reasons[info.reason]}`}</View></View>
  </View>
}
