import { useEffect, useRef, useState } from 'react'
import { useDidHide, useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import ScoreRing from '../../components/ScoreRing'
import { Btn, Empty, Failure, goRoot, Loading, newTopic } from '../../components/common'
import { getAnswerRecord, getStats } from '../../domain/learning'
import { authStore } from '../../services/client'
import { useAuthStore } from '../../auth'
import { sessionAccess } from '../../services/sessions'
import { learningStore, useLearningStore } from '../../storage'

export default function ReportPage() {
  const { params } = useRouter(); const { saved } = useLearningStore()
  const auth = useAuthStore()
  const session = saved.sessions.find(s => s.quiz.quiz_id === params.id)
  const from = params.from === 'library' ? 'library' : params.from === 'index' ? 'index' : 'profile'
  const backLabel = `返回${from === 'library' ? '题库' : from === 'index' ? '闯关' : '我的'}`
  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>(session?.report ? 'ready' : 'loading')
  const [error, setError] = useState(''); const [review, setReview] = useState(false); const [more, setMore] = useState(false)
  const token = useRef(0); const pending = useRef<{ cancel(): void } | null>(null)
  const activeScope = useRef(learningStore.getScope())
  function stop() {
    token.current++; pending.current?.cancel(); pending.current = null
    const current = learningStore.findSession(params.id)
    if (activeScope.current === learningStore.getScope() && current?.status === 'completed' && !current.report) learningStore.saveSession({ ...current, report_status: 'failed' }, activeScope.current)
  }
  async function generate() {
    const current = learningStore.findSession(params.id)
    if (pending.current) return
    if (current?.report) { setPhase('ready'); return }
    const attempt = ++token.current; setPhase('loading'); setError('')
    const scope = learningStore.getScope()
    activeScope.current = scope
    if (current?.status === 'completed') learningStore.saveSession({ ...current, report_status: 'pending' }, scope)
    try {
      await authStore.ensureSession()
      if (attempt !== token.current) return
      if (scope !== learningStore.getScope()) throw new Error('登录已失效或账号已切换，作答仍保留在原账号。请重新登录后重试。')
      const request = sessionAccess.report(params.id || '', scope); pending.current = request
      await request.promise
      if (attempt !== token.current) return
      setPhase('ready')
    } catch (failure) {
      if (attempt !== token.current) return
      const latest = learningStore.findSession(params.id)
      if (latest?.status === 'completed' && !latest.report) learningStore.saveSession({ ...latest, report_status: 'failed' }, scope)
      setError(failure instanceof Error ? failure.message : '报告生成失败，请重试。'); setPhase('failed')
    } finally { if (attempt === token.current) pending.current = null }
  }
  useEffect(() => { void generate(); return stop }, [params.id, auth.user?.id])
  useDidHide(() => { if (phase === 'loading') { stop(); setPhase('failed') } })
  function back() { stop(); void goRoot(from) }
  if (!session || session.status !== 'completed') return <AppShell onBack={back} backLabel={backLabel}>{phase === 'loading' ? <Loading report onCancel={back} cancelLabel={backLabel} /> : auth.user && !session ? <Failure report readOnly detail='云端学习记录' error={error} onRetry={generate} onCancel={back} cancelLabel={backLabel} /> : <Empty title='还没有学习报告' copy='完成一轮闯关，就能看到知识总结。' action='开始学习' />}</AppShell>
  const stats = getStats(session); const report = session.report
  return <AppShell onBack={back} backLabel={backLabel}>
    {phase === 'loading' ? <Loading report onCancel={back} cancelLabel={backLabel} /> : phase === 'failed' || !report ? <Failure report detail={`${session.quiz.title}\n答对 ${stats.correct} / ${stats.total} 题 · ${stats.xp} XP`} error={error} onRetry={generate} onCancel={back} cancelLabel={backLabel} /> : <>
      <View className='page-title'>学习报告</View><View className='page-subtitle'>{session.quiz.title} · {stats.total} 道题</View>
      <View className='report-score'><ScoreRing accuracy={stats.accuracy} /><View className='score-copy'><View className='score-title'>本轮正确率</View><View className='score-count'>答对 {stats.correct} / {stats.total} 题</View><View className='report-xp'>+{stats.xp} XP</View></View></View>
      <View className='summary-section'><View className='section-title'>知识总结</View><View className='knowledge-summary'>{report.three_line_summary.map((line, i) => <View className='summary-item' key={i}><Text className='summary-number'>{i + 1}</Text><Text>{line}</Text></View>)}</View></View>
      <View className='weak-section'><View className='section-title'>{report.weak_points.length ? '待巩固' : '本轮全部答对'}</View><View className='weak-copy'>{report.weak_points.length ? report.weak_points.join('、') : '这些知识点都答对了，继续探索新的主题吧。'}</View></View>
      <View className='report-actions'><Btn onClick={newTopic}>再学一个主题</Btn><Btn className='secondary-text' onClick={() => setReview(!review)}>{review ? '收起本轮题目' : '回看本轮题目'}</Btn></View>
      {review && <View className='review-list'>{session.quiz.questions.map((q, i) => {
        const record = getAnswerRecord(session, q.id)!
        const labels = (keys: string[]) => keys.length ? keys.map(key => `${key} ${q.options.find(o => o.key === key)?.text || ''}`).join('；') : '未作答'
        return <View className='review-item' key={q.id}><View className='review-title'>{i + 1}. {q.stem}</View><View className={`review-copy ${record.is_correct ? 'review-correct' : 'review-wrong'}`}>我的答案：{labels(record.selected_answers)}</View><View className='review-copy'>正确答案：{labels(q.answer)}</View><View className='review-copy'>{q.explanation}</View></View>
      })}</View>}
      <View className='report-more'><Btn className='report-more-toggle' onClick={() => setMore(!more)}>{more ? '▾' : '▸'} 学习建议与已掌握知识点</Btn>{more && <><View className='section-title'>下一步怎么学</View>{report.advice.map((line, i) => <View className='advice-copy' key={i}>{line}</View>)}<View className='section-title'>本轮答对的知识点</View>{report.mastered_points.length ? <View className='point-tags'>{report.mastered_points.map(point => <Text className='point-tag' key={point}>{point}</Text>)}</View> : <View className='advice-copy'>先从上面的讲解开始，一次理解一个知识点。</View>}</>}</View>
    </>}
  </AppShell>
}
