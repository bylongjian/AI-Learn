import { useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Empty, goRoot, Icon } from '../../components/common'
import { advanceSession, getAnswerRecord, getStats, submitAnswer } from '../../domain/learning'
import type { OptionKey } from '../../domain/types'
import { learningStore, useLearningStore } from '../../storage'
import QuestionReferences from '../../components/QuestionReferences'
import GenerationNotice from '../../components/GenerationNotice'

export default function QuizPage() {
  const { params } = useRouter(); const { saved, storageFailed } = useLearningStore()
  const session = saved.sessions.find(s => s.quiz.quiz_id === params.id)
  const [selected, setSelected] = useState<OptionKey[]>([]); const [exitOpen, setExitOpen] = useState(false)
  const started = useRef(Date.now())
  if (!session) return <AppShell><Empty title='还没有学习关卡' copy='先输入一个主题，开始你的第一轮学习。' /></AppShell>
  const q = session.quiz.questions[session.current_index]; const record = getAnswerRecord(session, q.id); const stats = getStats(session)
  function submit() {
    try { learningStore.saveSession(submitAnswer(session!, selected, Math.max(0, Date.now() - started.current))) }
    catch (error) { void Taro.showToast({ title: (error as Error).message, icon: 'none' }) }
  }
  function next() {
    setSelected([]); started.current = Date.now()
    const updated = advanceSession(session!); learningStore.saveSession(updated)
    if (updated.status === 'completed') void Taro.redirectTo({ url: `/pages/report/index?id=${encodeURIComponent(updated.quiz.quiz_id)}&from=profile` })
  }
  const overlay = exitOpen && <View className='screen-overlay'><View className='screen-dialog'><View className='dialog-title'>先休息一下？</View><View className='dialog-copy'>{storageFailed ? '本轮进度会保留在当前页面中，可以到题库继续学习。' : '本轮进度会保存在题库中，下次可以从这里继续。'}</View><Btn onClick={() => setExitOpen(false)}>继续答题</Btn><Btn className='secondary' onClick={() => { void goRoot('library') }}>退出本轮</Btn></View></View>
  return <AppShell onBack={() => setExitOpen(true)} overlay={overlay}>
    <View className='quiz-heading'><View className='page-title'>{session.quiz.title}</View><Text className='quiz-xp'>{stats.xp} XP</Text></View>
    <GenerationNotice quiz={session.quiz} />
    <View className='progress-track'><View className='progress-value' style={{ width: `${stats.answered / stats.total * 100}%` }} /></View>
    <View className='question-meta'><Text>第 {session.current_index + 1} / {stats.total} 题 · {{ single: '单选题', multiple: '多选题', judge: '判断题' }[q.type]}</Text>{q.type === 'multiple' && !record && <Text>可选择多个答案</Text>}</View>
    <View className='question-stem'>{q.stem}</View><View className='answer-options'>{q.options.map(option => {
      const picked = (record?.selected_answers || selected).includes(option.key)
      const correct = !!record && q.answer.includes(option.key)
      const wrong = !!record && picked && !correct
      return <Btn key={option.key} className={`answer-option${q.type === 'multiple' ? ' multiple' : ''}${picked && !record ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}`} disabled={!!record} onClick={() => setSelected(current => q.type === 'multiple' ? current.includes(option.key) ? current.filter(key => key !== option.key) : [...current, option.key] : [option.key])}><Text className='option-key'>{option.key}</Text><Text className='option-text'>{option.text}</Text><View className='option-state'>{(correct || wrong) && <Icon name={correct ? 'check' : 'close'} tone={correct ? 'green' : 'red'} />}</View></Btn>
    })}</View>
    {record ? <View className='answer-feedback'><View className={`result-line${record.is_correct ? '' : ' wrong'}`}><Icon name={record.is_correct ? 'success' : 'alert'} tone={record.is_correct ? 'green' : 'red'} /><Text>{record.is_correct ? '答对了 · +10 XP' : `这题还差一点 · 正确答案 ${q.answer.join('、')}`}</Text></View><View className='explanation'><View className='explanation-title'>知识讲解</View><View className='explanation-copy'>{q.explanation}</View></View><QuestionReferences key={q.id} quiz={session.quiz} questionId={q.id} /><Btn onClick={next}>{session.current_index === stats.total - 1 ? '完成闯关，查看报告' : '下一题'}</Btn></View> : <View className='answer-submit'><Btn disabled={!selected.length} onClick={submit}>提交答案</Btn><View className='answer-hint'>提交后，立即查看正确答案与知识讲解</View></View>}
  </AppShell>
}
