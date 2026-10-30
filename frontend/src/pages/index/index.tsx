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
import { ApiError, TopicClarificationError, type TopicOption } from '../../services/api'

export default function Index() {
  const { saved } = useLearningStore()
  const auth = useAuthStore(); const user = auth.user
  const history = useCloudHistory({ status: 'completed', pageSize: 3 })
  const recent = combineHistory(history.items, saved.sessions, { status: 'completed' }, !!history.error)
  const [phase, setPhase] = useState<'input' | 'loading' | 'clarification' | 'failed'>('input')
  const [options, setOptions] = useState<TopicOption[]>([])
  const [topicContext, setTopicContext] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<number | undefined>()
  const generation = useRef(0); const cancelRequest = useRef<() => void>(() => {})
  function cancel() { generation.current++; cancelRequest.current(); setOptions([]); setTopicContext(undefined); setPhase('input') }
  function changeDraft(value: string) { cancel(); learningStore.setDraft(value); setError(Array.from(value).length > 2000 ? validateTopic(value) : '') }
  useEffect(() => () => { generation.current++; cancelRequest.current() }, [])
  useDidHide(cancel)
  useDidShow(() => { if (authStore.credentials()) void authStore.refreshProfile() })
  useEffect(() => { cancel() }, [user?.id])
  async function generate(context?: string) {
    const validation = validateTopic(saved.draft)
    if (validation) { setError(validation); return }
    if (phase === 'loading') return
    const input = saved.draft
    setTopicContext(context); setOptions([])
    const token = ++generation.current; setPhase('loading'); setError(''); setErrorCode(undefined)
    try {
      const scope = await prepareLearningScope(authStore, learningStore)
      if (token !== generation.current) return
      if (scope !== learningStore.getScope()) throw new Error('账号已切换，学习主题仍保留在原账号。请重新打开后重试。')
      const request = api.generateQuiz(input, scope === 'guest' ? null : scope.slice(5), context); cancelRequest.current = request.cancel
      const quiz = await request.promise
      if (token !== generation.current) return
      if (!learningStore.saveSession(createSession(quiz), scope)) { setPhase('input'); return }
      if (scope !== 'guest') historyStore.invalidate(scope.slice(5))
      setPhase('input')
      await Taro.navigateTo({ url: `/pages/quiz/index?id=${encodeURIComponent(quiz.quiz_id)}` })
    } catch (failure) {
      if (token !== generation.current) return
      if (failure instanceof TopicClarificationError) { setOptions(failure.options); setPhase('clarification'); return }
      setErrorCode(failure instanceof ApiError ? failure.code : undefined)
      setError(failure instanceof Error ? failure.message : '生成失败，请稍后重试。'); setPhase('failed')
    }
  }
  return <AppShell active={phase === 'input' ? 'index' : undefined} onBack={cancel}>
    {phase === 'loading' ? <Loading onCancel={cancel} /> : phase === 'clarification' ? <View className='topic-clarification'>
      <View className='page-title'>你想学哪个领域？</View><View className='page-subtitle'>“{saved.draft}”有几种含义，选一下，题目会更贴近你的目标。</View>
      <View className='domain-options'>{options.map(option => <Btn key={option.label} className='domain-option' label={`学习${option.label}`} onClick={() => void generate(`${option.label}：${option.description}`)}><View className='domain-option-title'>{option.label}</View><View className='domain-option-description'>{option.description}</View><View className='domain-option-action'>学习这个领域 <Icon name='arrow' tone='brand' /></View></Btn>)}</View>
      <Btn className='secondary-text' onClick={cancel}>返回补充主题或参考资料</Btn>
    </View> : phase === 'failed' ? <Failure detail={`学习主题\n${saved.draft}`} error={error} onRetry={() => void generate(topicContext)} onCancel={cancel}
      title={errorCode === 42203 ? '资料还不足，先补充一点' : errorCode === 50304 ? '暂时没有获取到学习资料' : undefined}
      copy={errorCode === 42203 ? '你的输入已经保留。补充学习正文、具体领域或公开参考链接后，再试一次。' : errorCode === 50304 ? '可以稍后重试，或粘贴完整学习正文继续。你的输入会保留。' : undefined}
      retryLabel={errorCode === 42203 || errorCode === 50304 ? '重新获取资料' : undefined}
      cancelLabel={errorCode === 42203 || errorCode === 50304 ? '返回补充学习资料' : undefined} /> : <>
      <View className='page-title'>今天想学点什么？</View><View className='page-subtitle'>把好奇，变成一小关</View>
      <View className='topic-form'><View className='field-label'>学习主题或文本</View><View className={`textarea-wrap${error ? ' invalid' : ''}`}>
        <Textarea className='topic-input' ariaLabel='学习主题或文本' placeholder='输入想学的主题、公开网页链接，或粘贴学习正文' value={saved.draft} maxlength={-1} showCount={false} disableDefaultPadding onInput={event => changeDraft(event.detail.value)} />
        <Text className='char-counter'>{Array.from(saved.draft).length} / 2000</Text></View>
        {error && <View className='field-error'>{error}</View>}<View className='input-meta'><Icon name='clock' tone='brand' /><Text>5 道题 · 约 3 分钟</Text></View><Btn onClick={() => void generate()}>生成学习关卡</Btn></View>
      <View className='examples'><View className='section-title'>试试这些主题</View><View className='topic-chips'>{['RAG 入门', '认知心理学', '科学常识'].map(topic => <Btn key={topic} className='topic-chip' onClick={() => changeDraft(topic)}>{topic}</Btn>)}</View></View>
      {user && <View className='profile-reports'><View className='profile-row'><View className='profile-identity'><Text className='profile-name'>{user.nickname}</Text></View><Text className='profile-name'>{user.total_xp} XP</Text></View><View className='section-title'>最近的报告</View>
        {!!recent.rows.length && <ReportRows rows={recent.rows} from='index' />}
        {!!recent.deviceRows.length && <View className='profile-reports'><View className='section-title'>本机报告</View><ReportRows rows={recent.deviceRows} from='index' /></View>}
        <HistoryFeedback history={history} />
        {!recent.rows.length && !recent.deviceRows.length && history.loaded && !history.loading && !history.error && <View className='local-note'>完成一轮闯关，你的学习报告会出现在这里。</View>}
      </View>}
    </>}
  </AppShell>
}
