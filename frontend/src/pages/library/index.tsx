import { useState } from 'react'
import Taro from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Empty, Icon, newTopic } from '../../components/common'
import { getStats } from '../../domain/learning'
import { learningStore, useLearningStore } from '../../storage'

export default function Library() {
  const { saved } = useLearningStore(); const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const sessions = saved.sessions; const completed = sessions.filter(s => s.status === 'completed').length
  const filtered = sessions.filter(s => s.quiz.title.toLowerCase().includes(search.trim().toLowerCase()) && (filter === 'all' || (filter === 'completed' ? s.status === 'completed' : s.status !== 'completed')))
  function clear() { setSearch(''); setFilter('all') }
  return <AppShell active='library'><View className='page-title'>我的题库</View><View className='page-subtitle'>共 {sessions.length} 组学习关卡</View>
    <View className='search-field'><Icon name='search' /><Input className='search-input' ariaLabel='搜索学习主题' placeholder='搜索学习主题' value={search} onInput={event => setSearch(event.detail.value)} />{search && <Btn className='search-clear' label='清空搜索' onClick={clear}><Icon name='close' /></Btn>}</View>
    <View className='filter-bar'>{(['all', 'pending', 'completed'] as const).map((value, i) => <Btn key={value} className={`filter-button${filter === value ? ' active' : ''}`} onClick={() => setFilter(value)}>{['全部', '未完成', '已完成'][i]} {[sessions.length, sessions.length - completed, completed][i]}</Btn>)}</View>
    {filtered.length ? <><View className='list-surface'>{filtered.map(session => {
      const stats = getStats(session); const done = session.status === 'completed'; const pending = session.status === 'not-started'
      function open() {
        if (done) void Taro.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(session.quiz.quiz_id)}&from=library` })
        else {
          if (pending) learningStore.saveSession({ ...session, status: 'in-progress', updated_at: new Date().toISOString() })
          void Taro.navigateTo({ url: `/pages/quiz/index?id=${encodeURIComponent(session.quiz.quiz_id)}` })
        }
      }
      return <View className='library-row' key={session.quiz.quiz_id}><View className='row-top'><View className='row-title'>{session.quiz.title}</View><Text className={`small-state${done ? ' complete' : ''}`}>{done ? '已完成' : pending ? '未开始' : '学习中'}</Text></View><View className='row-bottom'><Text className='row-detail'>{stats.total} 题 · {done ? `正确率 ${stats.accuracy}%` : pending ? '未开始' : `已答 ${stats.answered}/${stats.total} 题`}</Text><Btn className='row-link' onClick={open}>{done ? '查看报告' : pending ? '开始闯关' : '继续学习'} <Icon name='right' tone='brand' /></Btn></View></View>
    })}</View><View className='library-new'><Btn className='text-action center-action' onClick={newTopic}><Icon name='plus' tone='brand' /> 新建关卡</Btn></View></> : sessions.length ? <Empty title='没有找到相关关卡' copy='换一个关键词，或查看全部学习关卡。' action='清空筛选' onAction={clear} /> : <Empty title='还没有学习关卡' copy='从一个感兴趣的问题开始，生成你的第一组题。' action='去生成第一组关卡' />}
  </AppShell>
}
