import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import type { Quiz } from '../domain/types'
import { Btn } from './common'

export default function QuestionReferences({ quiz, questionId }: { quiz: Quiz; questionId: string }) {
  const [expanded, setExpanded] = useState(false)
  const reference = quiz.reference
  if (!reference) return <View className='reference-empty'>本次记录未保存参考来源</View>
  const ids = reference.question_sources.find(item => item.question_id === questionId)?.source_ids || []
  const sources = reference.sources.filter(source => ids.includes(source.id))
  async function copy(url: string) {
    try { await Taro.setClipboardData({ data: url }) }
    catch { void Taro.showToast({ title: '复制未完成，请重试', icon: 'none' }) }
  }
  return <View className='question-references'>
    <Btn className='reference-toggle' onClick={() => setExpanded(!expanded)}>{expanded ? '收起参考来源' : `查看参考来源（${sources.length}）`}</Btn>
    {expanded && <View className='reference-list'><View className='reference-time'>资料准备于 {new Date(reference.retrieved_at).toLocaleString('zh-CN')}</View>
      {sources.map(source => <View className='reference-card' key={source.id}>
        <View className='reference-title'>{source.title}</View>
        <View className='reference-meta'>{source.kind === 'user_text' ? '用户提供的资料 · 未独立联网核实' : source.published_at ? `发布日期：${source.published_at.slice(0, 10)}` : '发布日期未提供'}</View>
        <Text className='reference-excerpt' selectable>{source.excerpt}</Text>
        {source.url && <><Text className='reference-url' selectable>{source.url}</Text><Btn className='reference-copy' onClick={() => void copy(source.url!)}>复制来源链接</Btn></>}
      </View>)}
    </View>}
  </View>
}
