import { isProfile } from './types.ts'
import type { Credentials, LoginResult, UserProfile } from './types'

interface SavedAuth { version: 1; token: string | null; user: UserProfile | null; expiresAt: number; guestPreferred: boolean }
export interface AuthSnapshot extends SavedAuth { phase: 'guest' | 'loading' | 'authenticated'; notice: string }
interface Driver { read(): unknown; write(value: SavedAuth): void; clear(): void }
interface Dependencies {
  platform: string
  devEnabled: boolean
  now?: () => number
  getCode?: () => Promise<string>
  login?: (code: string) => Promise<LoginResult>
  devLogin?: (account: 'a' | 'b') => Promise<LoginResult>
  getProfile?: () => Promise<UserProfile>
}
const empty = (): SavedAuth => ({ version: 1, token: null, user: null, expiresAt: 0, guestPreferred: false })

export function createAuthStore(driver: Driver, deps: Dependencies) {
  const now = deps.now || Date.now
  let saved = empty(); let notice = ''
  try {
    const raw = driver.read() as Partial<SavedAuth> | undefined
    if (raw?.version === 1) {
      saved.guestPreferred = raw.guestPreferred === true
      if (typeof raw.token === 'string' && raw.token && isProfile(raw.user) && typeof raw.expiresAt === 'number' && raw.expiresAt > now()) {
        saved = { version: 1, token: raw.token, user: raw.user, expiresAt: raw.expiresAt, guestPreferred: saved.guestPreferred }
      }
    }
  } catch { notice = '暂时无法读取登录信息，仍可使用游客模式。' }
  let snapshot: AuthSnapshot = { ...saved, phase: saved.token ? 'authenticated' : 'guest', notice }
  let epoch = 0
  let profileRevision = 0
  let wechatLogin: Promise<void> | undefined
  let initialization: Promise<void> | undefined
  let refresh: Promise<void> | undefined
  let forcedRefresh: { token: string; userId: string; epoch: number; promise: Promise<void> } | undefined
  const listeners = new Set<() => void>()
  function emit(next: AuthSnapshot, persist = false) {
    if (persist) {
      const { version, token, user, expiresAt, guestPreferred } = next
      try { driver.write({ version, token, user, expiresAt, guestPreferred }) }
      catch { next = { ...next, notice: '登录信息暂时无法保存，关闭后可能需要重新登录。' } }
    }
    snapshot = next; listeners.forEach(listener => listener())
  }
  function credentials(): Credentials | null {
    if (snapshot.token && snapshot.expiresAt <= now()) expire(snapshot.token)
    return snapshot.token && snapshot.user ? { token: snapshot.token, userId: snapshot.user.id } : null
  }
  function expire(token: string) {
    if (snapshot.token !== token) return
    const renewWechat = deps.platform === 'weapp' && snapshot.user?.is_test === false && !snapshot.guestPreferred
    epoch++
    emit({ ...empty(), phase: 'guest', notice: '登录已过期，请重新登录。' }, true)
    if (renewWechat) void loginWechat().catch(() => {})
  }
  async function signIn(operation: () => Promise<LoginResult>) {
    const attempt = ++epoch
    emit({ ...snapshot, phase: 'loading', notice: '' })
    try {
      const result = await operation()
      if (attempt !== epoch) return
      if (!isProfile(result.user) || !result.token || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new Error('登录数据格式不正确，请重试。')
      emit({ version: 1, token: result.token, user: result.user, expiresAt: now() + result.expires_in * 1000,
        guestPreferred: false, phase: 'authenticated', notice: '' }, true)
    } catch (error) {
      if (attempt !== epoch) return
      emit({ ...snapshot, phase: snapshot.token ? 'authenticated' : 'guest', notice: error instanceof Error ? error.message : '暂时无法登录，可以继续游客学习。' })
      throw error
    }
  }
  function loginWechat() {
    if (deps.platform !== 'weapp' || !deps.getCode || !deps.login) return Promise.reject(new Error('请在微信小程序中登录。'))
    if (wechatLogin) return wechatLogin
    wechatLogin = signIn(async () => {
      const code = await deps.getCode!()
      if (!code) throw new Error('暂时无法获取微信登录凭证，请重试。')
      return deps.login!(code)
    }).finally(() => { wechatLogin = undefined })
    return wechatLogin
  }
  function loginDev(account: 'a' | 'b') {
    if (!deps.devEnabled || !deps.devLogin) return Promise.reject(new Error('当前环境未启用测试登录。'))
    return signIn(() => deps.devLogin!(account))
  }
  function replaceProfile(user: UserProfile, token: string): boolean {
    if (snapshot.token !== token || snapshot.user?.id !== user.id || !isProfile(user)) return false
    profileRevision++
    emit({ ...snapshot, user, notice: '' }, true); return true
  }
  function refreshProfile(force = false): Promise<void> {
    const identity = credentials()
    const identityEpoch = epoch
    if (!identity || !deps.getProfile) return Promise.resolve()
    if (force && refresh) {
      if (forcedRefresh?.token === identity.token && forcedRefresh.userId === identity.userId && forcedRefresh.epoch === identityEpoch) return forcedRefresh.promise
      // A report may commit after the running GET read its snapshot; follow it with one fresh GET.
      const queued = refresh.then(() => {
        // Only coalesce commits waiting for this GET; a later commit needs a read after this one starts.
        if (forcedRefresh?.promise === queued) forcedRefresh = undefined
        const current = credentials()
        if (epoch !== identityEpoch || current?.token !== identity.token || current.userId !== identity.userId) return
        return refreshProfile()
      }).finally(() => { if (forcedRefresh?.promise === queued) forcedRefresh = undefined })
      forcedRefresh = { ...identity, epoch: identityEpoch, promise: queued }
      return queued
    }
    if (refresh) return refresh
    const revision = profileRevision
    refresh = (async () => {
      try {
        const user = await deps.getProfile!()
        if (epoch === identityEpoch && revision === profileRevision) replaceProfile(user, identity.token)
      }
      catch (error) {
        if (epoch !== identityEpoch || snapshot.token !== identity.token || snapshot.user?.id !== identity.userId) return
        if ((error as { statusCode?: number })?.statusCode === 401) expire(identity.token)
        else emit({ ...snapshot, notice: '暂时无法更新账号信息，已显示上次记录。' })
      }
    })().finally(() => { refresh = undefined })
    return refresh
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    credentials, loginWechat, loginDev, refreshProfile, replaceProfile, expire,
    async ensureSession() {
      credentials()
      if (wechatLogin) await wechatLogin.catch(() => {})
      else await this.initialize()
    },
    logout() { epoch++; emit({ ...empty(), guestPreferred: true, phase: 'guest', notice: '' }, true) },
    initialize(): Promise<void> {
      if (initialization) return initialization
      initialization = (async () => {
        if (snapshot.token) await refreshProfile()
        if (!snapshot.token && !snapshot.guestPreferred && deps.platform === 'weapp') {
          try { await loginWechat() } catch { /* Guest learning stays available. */ }
        }
      })()
      return initialization
    },
  }
}
