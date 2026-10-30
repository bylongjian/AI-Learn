import { useState } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Image, Input, Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import AccountControls from '../../components/AccountControls'
import { Btn, Empty, Icon, newTopic } from '../../components/common'
import { getProfileStats } from '../../domain/learning'
import { localHistoryItem } from '../../domain/cloud'
import { combineHistory } from '../../history/store'
import { useCloudHistory } from '../../history'
import { HistoryFeedback, ReportRows } from '../../components/HistoryList'
import { useLearningStore } from '../../storage'
import { authStore, useAuthStore } from '../../auth'
import { api } from '../../services/client'

export default function Profile() {
  const { saved, storageFailed } = useLearningStore(); const localStats = getProfileStats(saved.sessions)
  const auth = useAuthStore(); const user = auth.user
  const history = useCloudHistory({ status: 'completed' })
  const stats = user ? { xp: user.total_xp, completed: user.quiz_count, accuracy: user.average_accuracy } : localStats
  const [editing, setEditing] = useState(false); const [nickname, setNickname] = useState(''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false)
  const [editingUser, setEditingUser] = useState('')
  useDidShow(() => { void authStore.initialize().then(() => authStore.refreshProfile()) })
  useDidHide(() => { setEditing(false); setNickname(''); setError('') })
  function validateName(value: string) {
    return !value.trim() ? '请输入昵称。' : Array.from(value.trim()).length > 100 ? '昵称最多 100 字。' : /[\u0000-\u001f\u007f]/.test(value) ? '昵称不能包含换行或控制字符。' : ''
  }
  async function saveName() {
    const invalid = validateName(nickname); setError(invalid)
    const identity = authStore.credentials()
    if (invalid || saving) return
    if (!identity || identity.userId !== editingUser) { setError('登录已失效或账号已切换，请取消后重新登录，再保存昵称。'); return }
    setSaving(true)
    try {
      const updated = await api.updateProfile({ nickname: nickname.trim(), avatar_url: user?.avatar_url || '' }).promise
      if (authStore.replaceProfile(updated, identity.token)) { setEditing(false); void Taro.showToast({ title: '昵称已保存', icon: 'success' }) }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试。') }
    finally { setSaving(false) }
  }
  const overlay = editing && editingUser === user?.id && <View className='screen-overlay'><View className='screen-dialog'>
    <View className='dialog-title'>修改昵称</View><View className='field-label'>昵称</View>
    <Input className='nickname-input' ariaLabel='昵称' value={nickname} maxlength={100} focus onInput={event => { setNickname(event.detail.value); if (error) setError(validateName(event.detail.value)) }} onBlur={() => setError(validateName(nickname))} />
    {error && <View className='field-error'>{error}</View>}
    <Btn disabled={saving} onClick={() => { void saveName() }}>{saving ? '正在保存…' : '保存昵称'}</Btn>
    <Btn className='secondary' disabled={saving} onClick={() => setEditing(false)}>取消</Btn>
  </View></View>
  const recent = saved.sessions.filter(s => s.status === 'completed').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3)
  const cloud = combineHistory(history.items, saved.sessions, { status: 'completed' }, !!history.error)
  const reportRows = user ? cloud.rows : recent.map(local => ({ ...localHistoryItem(local), local }))
  return <AppShell active='profile' overlay={overlay}><View className='page-title'>我的学习</View><View className='page-subtitle'>每一小步，都算进步</View>
    <View className='profile-row'><View className='profile-avatar'>{user?.avatar_url ? <Image className='user-avatar-image' src={user.avatar_url} mode='aspectFill' /> : <Icon name='user' tone='avatar' />}</View><View className='profile-identity'><Text className='profile-name'>{user?.nickname || '学习者'}</Text>{user?.is_test && <View className='account-mode'>本地测试账号</View>}</View>{user && <Btn className='profile-edit' label='修改昵称' onClick={() => { setNickname(user.nickname); setEditingUser(user.id); setError(''); setEditing(true) }}>修改昵称</Btn>}</View>
    <View className='profile-stats'><View className='profile-stat'><Text className='stat-value'>{stats.xp}<Text className='xp-unit'> XP</Text></Text><View className='stat-label'>累计经验</View></View><View className='profile-stat'><Text className='stat-value'>{stats.completed}</Text><View className='stat-label'>完成关卡</View></View><View className='profile-stat'><Text className='stat-value'>{stats.accuracy === null ? '—' : `${stats.accuracy}%`}</Text><View className='stat-label'>{stats.accuracy === null ? '暂无正确率数据' : '平均正确率'}</View></View></View>
    <View className='profile-reports'><View className='section-title'>最近的报告</View>{!!reportRows.length && <ReportRows rows={reportRows} from='profile' />}
      {user && !!cloud.deviceRows.length && <View className='profile-reports'><View className='section-title'>本机报告 · {cloud.deviceRows.length}</View><ReportRows rows={cloud.deviceRows} from='profile' /></View>}
      {user && <HistoryFeedback history={history} />}
      {!reportRows.length && (!user || (!cloud.deviceRows.length && history.loaded && !history.loading && !history.error)) && <Empty title='完成一关，就有一份收获' copy='你的学习报告会出现在这里。' action='开始第一轮学习' symbol='document' />}</View>
    {user && <View className='account-total'>累计答对 {user.correct_count} 题</View>}
    {!!reportRows.length && <View className='profile-home'><Btn className='text-action center-action' onClick={newTopic}>去闯关 <Icon name='arrow' tone='brand' /></Btn></View>}<View className='local-note'>{user ? '账号记录保存在云端，未完成进度保留在本机' : storageFailed ? '本次记录仅在当前页面保留' : '记录保存在当前设备'}</View>
    <AccountControls />
  </AppShell>
}
