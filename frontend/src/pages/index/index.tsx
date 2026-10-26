import { useEffect, useRef, useState } from 'react'
import Taro, { useDidHide } from '@tarojs/taro'
import { Text, Textarea, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Failure, Icon, Loading } from '../../components/common'
import { createSession, validateTopic } from '../../domain/learning'
import { api } from '../../services/client'
import { learningStore, useLearningStore } from '../../storage'

export default function Index() {
  const { saved } = useLearningStore()
  const [phase, setPhase] = useState<'input' | 'loading' | 'failed'>('input')
  const [error, setError] = useState('')
  const generation = useRef(0); const cancelRequest = useRef<() => void>(() => {})
  function cancel() { generation.current++; cancelRequest.current(); setPhase('input') }
  useEffect(() => () => { generation.current++; cancelRequest.current() }, [])
  useDidHide(cancel)
  async function generate() {
    const validation = validateTopic(saved.draft)
    if (validation) { setError(validation); return }
    if (phase === 'loading') return
    const token = ++generation.current; setPhase('loading'); setError('')
    try {
      const request = api.generateQuiz(saved.draft); cancelRequest.current = request.cancel
      const quiz = await request.promise
      if (token !== generation.current) return
      learningStore.saveSession(createSession(quiz))
      setPhase('input')
      await Taro.navigateTo({ url: `/pages/quiz/index?id=${encodeURIComponent(quiz.quiz_id)}` })
    } catch (failure) {
      if (token !== generation.current) return
      setError(failure instanceof Error ? failure.message : '生成失败，请稍后重试。'); setPhase('failed')
    }
  }
  return <AppShell active={phase === 'input' ? 'index' : undefined} onBack={cancel}>
    {phase === 'loading' ? <Loading onCancel={cancel} /> : phase === 'failed' ? <Failure detail={`学习主题\n${saved.draft}`} error={error} onRetry={generate} onCancel={cancel} /> : <>
      <View className='page-title'>今天想学点什么？</View><View className='page-subtitle'>把好奇，变成一小关</View>
      <View className='topic-form'><View className='field-label'>学习主题或文本</View><View className={`textarea-wrap${error ? ' invalid' : ''}`}>
        <Textarea className='topic-input' ariaLabel='学习主题或文本' placeholder='比如：我想理解 RAG 和传统搜索的区别' value={saved.draft} maxlength={-1} showCount={false} disableDefaultPadding onInput={event => { learningStore.setDraft(event.detail.value); setError(Array.from(event.detail.value).length > 2000 ? validateTopic(event.detail.value) : '') }} />
        <Text className='char-counter'>{Array.from(saved.draft).length} / 2000</Text></View>
        {error && <View className='field-error'>{error}</View>}<View className='input-meta'><Icon name='clock' tone='brand' /><Text>5 道题 · 约 3 分钟</Text></View><Btn onClick={generate}>生成学习关卡</Btn></View>
      <View className='examples'><View className='section-title'>试试这些主题</View><View className='topic-chips'>{['RAG 入门', '认知心理学', '科学常识'].map(topic => <Btn key={topic} className='topic-chip' onClick={() => { learningStore.setDraft(topic); setError('') }}>{topic}</Btn>)}</View></View>
    </>}
  </AppShell>
}
