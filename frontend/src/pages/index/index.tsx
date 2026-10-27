import { useEffect, useRef, useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Text, Textarea, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Failure, Icon, Loading } from '../../components/common'
import { createSession, validateTopic } from '../../domain/learning'
import { api, authStore } from '../../services/client'
import { prepareLearningScope } from '../../services/learning-scope'
import { learningStore, useLearningStore } from '../../storage'
import { useAuthStore } from '../../auth'
import { historyStore, useCloudHistory } from '../../history'
import { HistoryFeedback, ReportRows } from '../../components/HistoryList'
import { combineHistory } from '../../history/store'

export default function Index() {
  const { saved } = useLearningStore()
  const auth = useAuthStore(); const user = auth.user
  const history = useCloudHistory({ status: 'completed', pageSize: 3 })
  const recent = combineHistory(history.items, saved.sessions, { status: 'completed' }, !!history.error)
  const [phase, setPhase] = useState<'input' | 'loading' | 'failed'>('input')
  const [error, setError] = useState('')
  const generation = useRef(0); const cancelRequest = useRef<() => void>(() => {})
  function cancel() { generation.current++; cancelRequest.current(); setPhase('input') }
  useEffect(() => () => { generation.current++; cancelRequest.current() }, [])
  useDidHide(cancel)
  useDidShow(() => { if (authStore.credentials()) void authStore.refreshProfile() })
  async function generate() {
    const validation = validateTopic(saved.draft)
    if (validation) { setError(validation); return }
    if (phase === 'loading') return
    const input = saved.draft
    const token = ++generation.current; setPhase('loading'); setError('')
    try {
      const scope = await prepareLearningScope(authStore, learningStore)
      if (token !== generation.current) return
      if (scope !== learningStore.getScope()) throw new Error('账号已切换，学习主题仍保留在原账号。请重新打开后重试。')
      const request = api.generateQuiz(input, scope === 'guest' ? null : scope.slice(5)); cancelRequest.current = request.cancel
      const quiz = await request.promise
      if (token !== generation.current) return
      if (!learningStore.saveSession(createSession(quiz), scope)) { setPhase('input'); return }
      if (scope !== 'guest') historyStore.invalidate(scope.slice(5))
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
      {user && <View className='profile-reports'><View className='profile-row'><View className='profile-identity'><Text className='profile-name'>{user.nickname}</Text></View><Text className='profile-name'>{user.total_xp} XP</Text></View><View className='section-title'>最近的报告</View>
        {!!recent.rows.length && <ReportRows rows={recent.rows} from='index' />}
        {!!recent.deviceRows.length && <View className='profile-reports'><View className='section-title'>本机报告</View><ReportRows rows={recent.deviceRows} from='index' /></View>}
        <HistoryFeedback history={history} />
        {!recent.rows.length && !recent.deviceRows.length && history.loaded && !history.loading && !history.error && <View className='local-note'>完成一轮闯关，你的学习报告会出现在这里。</View>}
      </View>}
    </>}
  </AppShell>
}
