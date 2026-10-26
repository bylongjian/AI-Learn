import { useEffect, useRef, useState } from 'react'
import { useDidHide, useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import ScoreRing from '../../components/ScoreRing'
import { Btn, Empty, Failure, goRoot, Loading, newTopic } from '../../components/common'
import { attachReport, getAnswerRecord, getStats } from '../../domain/learning'
import { api } from '../../services/client'
import { learningStore, useLearningStore } from '../../storage'

export default function ReportPage() {
  const { params } = useRouter(); const { saved } = useLearningStore()
  const session = saved.sessions.find(s => s.quiz.quiz_id === params.id)
  const from = params.from === 'library' ? 'library' : 'profile'
  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>(session?.report ? 'ready' : 'loading')
  const [error, setError] = useState(''); const [review, setReview] = useState(false); const [more, setMore] = useState(false)
  const token = useRef(0); const pending = useRef<{ cancel(): void } | null>(null)
  function stop() {
    token.current++; pending.current?.cancel(); pending.current = null
    const current = learningStore.findSession(params.id)
    if (current?.status === 'completed' && !current.report) learningStore.saveSession({ ...current, report_status: 'failed' })
  }
  async function generate() {
    const current = learningStore.findSession(params.id)
    if (!current || current.status !== 'completed' || pending.current) return
    if (current.report) { setPhase('ready'); return }
    const attempt = ++token.current; setPhase('loading'); setError('')
    learningStore.saveSession({ ...current, report_status: 'pending' })
    try {
      const request = api.generateReport(current); pending.current = request
      const report = await request.promise
      if (attempt !== token.current) return
      learningStore.saveSession(attachReport(current, report)); setPhase('ready')
    } catch (failure) {
      if (attempt !== token.current) return
      learningStore.saveSession({ ...current, report_status: 'failed' })
      setError(failure instanceof Error ? failure.message : '报告生成失败，请重试。'); setPhase('failed')
    } finally { if (attempt === token.current) pending.current = null }
  }
  useEffect(() => { void generate(); return stop }, [params.id])
  useDidHide(() => { if (pending.current) { stop(); setPhase('failed') } })
  function back() { stop(); void goRoot(from) }
  if (!session || session.status !== 'completed') return <AppShell onBack={back} backLabel={`返回${from === 'library' ? '题库' : '我的'}`}><Empty title='还没有学习报告' copy='完成一轮闯关，就能看到知识总结。' action='开始学习' /></AppShell>
  const stats = getStats(session); const report = session.report
  return <AppShell onBack={back} backLabel={`返回${from === 'library' ? '题库' : '我的'}`}>
    {phase === 'loading' ? <Loading report onCancel={back} /> : phase === 'failed' || !report ? <Failure report detail={`${session.quiz.title}\n答对 ${stats.correct} / ${stats.total} 题 · ${stats.xp} XP`} error={error} onRetry={generate} onCancel={back} /> : <>
      <View className='page-title'>学习报告</View><View className='page-subtitle'>{session.quiz.title} · {stats.total} 道题</View>
      <View className='report-score'><ScoreRing accuracy={stats.accuracy} /><View className='score-copy'><View className='score-title'>本轮正确率</View><View className='score-count'>答对 {stats.correct} / {stats.total} 题</View><View className='report-xp'>+{stats.xp} XP</View></View></View>
      <View className='summary-section'><View className='section-title'>知识总结</View><View className='knowledge-summary'>{report.three_line_summary.map((line, i) => <View className='summary-item' key={i}><Text className='summary-number'>{i + 1}</Text><Text>{line}</Text></View>)}</View></View>
      <View className='weak-section'><View className='section-title'>{report.weak_points.length ? '待巩固' : '本轮全部答对'}</View><View className='weak-copy'>{report.weak_points.length ? report.weak_points.join('、') : '这些知识点都答对了，继续探索新的主题吧。'}</View></View>
      <View className='report-actions'><Btn onClick={newTopic}>再学一个主题</Btn><Btn className='secondary-text' onClick={() => setReview(!review)}>{review ? '收起本轮题目' : '回看本轮题目'}</Btn></View>
      {review && <View className='review-list'>{session.quiz.questions.map((q, i) => {
        const record = getAnswerRecord(session, q.id)!
        const labels = (keys: string[]) => keys.map(key => `${key} ${q.options.find(o => o.key === key)?.text || ''}`).join('；')
        return <View className='review-item' key={q.id}><View className='review-title'>{i + 1}. {q.stem}</View><View className={`review-copy ${record.is_correct ? 'review-correct' : 'review-wrong'}`}>我的答案：{labels(record.selected_answers)}</View><View className='review-copy'>正确答案：{labels(q.answer)}</View><View className='review-copy'>{q.explanation}</View></View>
      })}</View>}
      <View className='report-more'><Btn className='report-more-toggle' onClick={() => setMore(!more)}>{more ? '▾' : '▸'} 学习建议与已掌握知识点</Btn>{more && <><View className='section-title'>下一步怎么学</View>{report.advice.map((line, i) => <View className='advice-copy' key={i}>{line}</View>)}<View className='section-title'>本轮答对的知识点</View>{report.mastered_points.length ? <View className='point-tags'>{report.mastered_points.map(point => <Text className='point-tag' key={point}>{point}</Text>)}</View> : <View className='advice-copy'>先从上面的讲解开始，一次理解一个知识点。</View>}</>}</View>
    </>}
  </AppShell>
}
