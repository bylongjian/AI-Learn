import { Text, View } from '@tarojs/components'
import { authStore, useAuthStore } from '../auth'
import { localDevLogin } from '../services/client'
import { Btn } from './common'

export default function AccountControls() {
  const auth = useAuthStore(); const busy = auth.phase === 'loading'
  async function login(account?: 'a' | 'b') {
    try {
      if (account) await authStore.loginDev(account)
      else await authStore.loginWechat()
    } catch { /* The auth store exposes the safe error next to these controls. */ }
  }
  return <View className='account-controls'>
    {auth.notice && <View className='field-error'>{auth.notice}</View>}
    {localDevLogin && <><View className='account-mode'>本地开发测试 · 使用独立测试身份</View><View className='account-buttons'>
      <Btn className='account-button' disabled={busy} onClick={() => { void login('a') }}>测试账号 A</Btn>
      <Btn className='account-button' disabled={busy} onClick={() => { void login('b') }}>测试账号 B</Btn>
    </View></>}
    {!auth.user && process.env.TARO_ENV === 'weapp' && <Btn className='secondary' disabled={busy} onClick={() => { void login() }}>{busy ? '正在登录…' : '微信登录'}</Btn>}
    {auth.user && <Btn className='secondary-text' onClick={() => authStore.logout()}>使用游客模式</Btn>}
    {!auth.user && <Text className='account-copy'>游客记录保存在本机，登录后新关卡保存到账号。</Text>}
  </View>
}
