import { useEffect, useRef, useState } from 'react'
import Taro from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Empty, Icon, newTopic } from '../../components/common'
import { HistoryFeedback, historyTime } from '../../components/HistoryList'
import { getStats } from '../../domain/learning'
import { localHistoryItem } from '../../domain/cloud'
import type { HistoryStatus } from '../../domain/cloud'
import type { HistoryRow } from '../../history/store'
import { combineHistory } from '../../history/store'
import { useCloudHistory } from '../../history'
import { useAuthStore } from '../../auth'
import { sessionAccess } from '../../services/sessions'
import { learningStore, useLearningStore } from '../../storage'

export default function Library() {
  const { saved } = useLearningStore(); const auth = useAuthStore(); const userId = auth.user?.id || null
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState<HistoryStatus>('all')
  const history = useCloudHistory({ search, status: filter }); const [opening, setOpening] = useState(''); const [openError, setOpenError] = useState('')
  const openAttempt = useRef(0); const currentRequest = useRef<{ cancel(): void } | null>(null)
  useEffect(() => { setOpening(''); setOpenError(''); return () => { openAttempt.current++; currentRequest.current?.cancel() } }, [userId])
  const sessions = saved.sessions; const completed = sessions.filter(s => s.status === 'completed').length
  const local = sessions.map(session => ({ ...localHistoryItem(session), local: session })).filter(row => row.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) && (filter === 'all' || (filter === 'completed' ? row.status === 'completed' : row.status !== 'completed')))
  const combined = combineHistory(history.items, sessions, { search, status: filter }, !!history.error)
  const rows = userId ? combined.rows : local; const deviceRows = userId ? combined.deviceRows : []
  function clear() { setSearch(''); setFilter('all') }
  async function open(row: HistoryRow) {
    if (opening) return
    if (row.status === 'completed') { void Taro.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(row.quiz_id)}&from=library` }); return }
    const attempt = ++openAttempt.current; const scope = learningStore.getScope(); setOpening(row.quiz_id); setOpenError('')
    try {
      const request = sessionAccess.read(row.quiz_id, scope); currentRequest.current = request
      const session = await request.promise
      if (attempt !== openAttempt.current || scope !== learningStore.getScope()) return
      if (session.status === 'completed') { void Taro.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(row.quiz_id)}&from=library` }); return }
      if (session.status === 'not-started') learningStore.saveSession({ ...session, status: 'in-progress', updated_at: new Date().toISOString() }, scope)
      void Taro.navigateTo({ url: `/pages/quiz/index?id=${encodeURIComponent(row.quiz_id)}` })
    } catch (failure) { if (attempt === openAttempt.current) setOpenError(failure instanceof Error ? failure.message : '暂时无法打开关卡，请重试。') }
    finally { if (attempt === openAttempt.current) { currentRequest.current = null; setOpening('') } }
  }
  function renderRows(list: HistoryRow[]) {
    return <View className='list-surface'>{list.map(row => {
      const done = row.status === 'completed'; const progress = row.local && getStats(row.local); const pending = !row.local || row.local.status === 'not-started'
      return <View className='library-row' key={row.quiz_id}><View className='row-top'><View className='row-title'>{row.title}</View><Text className={`small-state${done ? ' complete' : ''}`}>{done ? row.local && !row.local.report ? '本机已完成' : '已完成' : pending ? '未开始' : '学习中'}</Text></View><View className='row-detail'>{historyTime(row.created_at)}</View><View className='row-bottom'><Text className='row-detail'>{row.question_count} 题 · {done ? `正确率 ${row.accuracy}%${row.local && !row.local.report ? ' · 报告待同步' : ''}` : pending ? '未开始' : `已答 ${progress && progress.answered}/${row.question_count} 题`}</Text><Btn className='row-link' disabled={!!opening} onClick={() => { void open(row) }}>{opening === row.quiz_id ? '正在打开…' : done ? '查看报告' : pending ? '开始闯关' : '继续学习'} <Icon name='right' tone='brand' /></Btn></View></View>
    })}</View>
  }
  const counts = userId ? [history.totals.all, history.totals.pending, history.totals.completed] : [sessions.length, sessions.length - completed, completed]
  return <AppShell active='library'><View className='page-title'>我的题库</View><View className='page-subtitle'>{userId ? `云端共 ${history.totals.all} 组学习关卡` : `共 ${sessions.length} 组学习关卡`}</View>
    <View className='search-field'><Icon name='search' /><Input className='search-input' ariaLabel='搜索学习主题' placeholder='搜索学习主题' value={search} maxlength={100} onInput={event => setSearch(event.detail.value)} />{search && <Btn className='search-clear' label='清空搜索' onClick={clear}><Icon name='close' /></Btn>}</View>
    <View className='filter-bar'>{(['all', 'pending', 'completed'] as const).map((value, i) => <Btn key={value} className={`filter-button${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>{['全部', '未完成', '已完成'][i]} {counts[i]}</Btn>)}</View>
    {userId && <View className='row-detail'>数量和筛选以云端记录为准，本机续答进度会保留。</View>}
    {!!openError && <View className='field-error'>{openError} 请再次点击关卡重试。</View>}
    {!!rows.length && renderRows(rows)}
    {!!deviceRows.length && <View className='profile-reports'><View className='section-title'>本机进度 · {deviceRows.length}</View><View className='row-detail'>保留本机续答和待同步报告，云端数量单独统计。</View>{renderRows(deviceRows)}</View>}
    {userId && <HistoryFeedback history={history} />}
    {!rows.length && !deviceRows.length && (!userId || (history.loaded && !history.loading && !history.error)) && (sessions.length || history.totals.all || search || filter !== 'all' ? <Empty title='没有找到相关关卡' copy='换一个关键词，或查看全部学习关卡。' action='清空筛选' onAction={clear} /> : <Empty title='还没有学习关卡' copy='从一个感兴趣的问题开始，生成你的第一组题。' action='去生成第一组关卡' />)}
    {(!!rows.length || !!deviceRows.length) && <View className='library-new'><Btn className='text-action center-action' onClick={newTopic}><Icon name='plus' tone='brand' /> 新建关卡</Btn></View>}
  </AppShell>
}
