import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import { Btn, Empty, Icon, newTopic } from '../../components/common'
import { getProfileStats, getStats } from '../../domain/learning'
import { useLearningStore } from '../../storage'

export default function Profile() {
  const { saved, storageFailed } = useLearningStore(); const stats = getProfileStats(saved.sessions)
  const recent = saved.sessions.filter(s => s.status === 'completed').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3)
  return <AppShell active='profile'><View className='page-title'>我的学习</View><View className='page-subtitle'>每一小步，都算进步</View>
    <View className='profile-row'><View className='profile-avatar'><Icon name='user' tone='avatar' /></View><Text className='profile-name'>学习者</Text></View>
    <View className='profile-stats'><View className='profile-stat'><Text className='stat-value'>{stats.xp}<Text className='xp-unit'> XP</Text></Text><View className='stat-label'>累计经验</View></View><View className='profile-stat'><Text className='stat-value'>{stats.completed}</Text><View className='stat-label'>完成关卡</View></View><View className='profile-stat'><Text className='stat-value'>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</Text><View className='stat-label'>{stats.accuracy === null ? '暂无正确率数据' : '平均正确率'}</View></View></View>
    <View className='profile-reports'><View className='section-title'>最近的报告</View>{recent.length ? <View className='list-surface'>{recent.map(session => {
      const score = getStats(session)
      return <Btn className='report-row' key={session.quiz.quiz_id} onClick={() => { void Taro.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(session.quiz.quiz_id)}&from=profile` }) }}><View><View className='row-title'>{session.quiz.title}</View><View className='row-detail'>{score.correct} / {score.total} 题 · {score.accuracy}%</View></View><Icon name='right' /></Btn>
    })}</View> : <Empty title='完成一关，就有一份收获' copy='你的学习报告会出现在这里。' action='开始第一轮学习' symbol='document' />}</View>
    {!!recent.length && <View className='profile-home'><Btn className='text-action center-action' onClick={newTopic}>去闯关 <Icon name='arrow' tone='brand' /></Btn></View>}<View className='local-note'>{storageFailed ? '本次记录仅在当前页面保留' : '记录保存在当前设备'}</View>
  </AppShell>
}
