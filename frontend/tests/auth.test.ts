import { before, test } from 'node:test'
import assert from 'node:assert/strict'

let authModule: any
before(async () => { authModule = await import('../src/auth/store.ts').catch(() => ({})) })
const profile = (id = '1') => ({ id, nickname: `同学${id}`, avatar_url: '', total_xp: 0, quiz_count: 0, correct_count: 0, average_accuracy: null, is_test: true })
const result = (id = '1') => ({ token: `token-${id}`, expires_in: 100, user: profile(id) })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function setup(options: any = {}, raw?: any) {
  let saved = raw
  const calls: string[] = []
  const driver = { read: () => saved, write: (value: any) => { saved = structuredClone(value) }, clear: () => { saved = undefined } }
  const deps = { platform: 'h5', devEnabled: true, now: () => 1000,
    getCode: async () => { calls.push('code'); return 'wx-code' },
    login: async () => { calls.push('login'); return result() },
    devLogin: async (account: string) => { calls.push(account); return result(account === 'a' ? '1' : '2') },
    getProfile: async () => profile(), ...options }
  assert.equal(typeof authModule.createAuthStore, 'function')
  return { store: authModule.createAuthStore(driver, deps), calls, read: () => saved }
}

test('H5 首次使用保留游客模式，不调用微信登录', async () => {
  const { store, calls } = setup(); await store.initialize()
  assert.equal(store.getSnapshot().user, null); assert.deepEqual(calls, [])
})
test('微信启动登录去重，缓存 Token 和用户资料', async () => {
  const { store, calls, read } = setup({ platform: 'weapp' })
  await Promise.all([store.initialize(), store.initialize()])
  assert.deepEqual(calls, ['code', 'login']); assert.equal(read().token, 'token-1')
  assert.deepEqual(store.credentials(), { token: 'token-1', userId: '1' })
})
test('显式测试登录可切换账号，禁用时不能调用开发接口', async () => {
  const { store } = setup(); await store.loginDev('a'); await store.loginDev('b')
  assert.equal(store.getSnapshot().user.id, '2')
  const disabled = setup({ devEnabled: false })
  await assert.rejects(disabled.store.loginDev('a'), /未启用/); assert.deepEqual(disabled.calls, [])
})
test('缓存重开会从后端刷新资料，网络故障保留已缓存身份', async () => {
  const raw = { version: 1, token: 'cached', user: profile(), expiresAt: 2000, guestPreferred: false }
  const restored = setup({ getProfile: async () => ({ ...profile(), nickname: '新昵称' }) }, raw)
  await restored.store.initialize(); assert.equal(restored.store.getSnapshot().user.nickname, '新昵称')
  const offline = setup({ getProfile: async () => { throw new Error('网络中断') } }, raw)
  await offline.store.initialize(); assert.equal(offline.store.credentials().token, 'cached')
  assert.match(offline.store.getSnapshot().notice, /上次/)
})
test('过期缓存不发送 Token，微信可重新登录，H5 保持游客', async () => {
  const raw = { version: 1, token: 'expired', user: profile(), expiresAt: 999, guestPreferred: false }
  const { store } = setup({}, raw); await store.initialize(); assert.equal(store.credentials(), null)
  const wx = setup({ platform: 'weapp' }, raw); await wx.store.initialize(); assert.equal(wx.store.credentials().token, 'token-1')
})
test('退出登录后迟到的登录响应不会恢复身份', async () => {
  const pending = deferred<any>(); const { store } = setup({ devLogin: () => pending.promise })
  const login = store.loginDev('a'); store.logout(); pending.resolve(result()); await login
  assert.equal(store.credentials(), null); assert.equal(store.getSnapshot().guestPreferred, true)
})
test('先后切换账号，先发后到的响应不能覆盖当前用户', async () => {
  const first = deferred<any>(); const { store } = setup({ devLogin: (a: string) => a === 'a' ? first.promise : Promise.resolve(result('2')) })
  const a = store.loginDev('a'); await store.loginDev('b'); first.resolve(result('1')); await a
  assert.equal(store.getSnapshot().user.id, '2')
})
test('401 清理只影响对应 Token，旧请求不能清除新账号', async () => {
  const { store } = setup(); await store.loginDev('a'); await store.loginDev('b')
  store.expire('token-1'); assert.equal(store.credentials().userId, '2')
  store.expire('token-2'); assert.equal(store.credentials(), null); assert.match(store.getSnapshot().notice, /过期/)
})
test('使用游客模式的偏好在微信重开后保留', async () => {
  const first = setup(); await first.store.loginDev('a'); first.store.logout()
  const reopened = setup({ platform: 'weapp' }, first.read()); await reopened.store.initialize()
  assert.deepEqual(reopened.calls, []); assert.equal(reopened.store.credentials(), null)
})
test('写入缓存失败仍保留内存登录态，并说明关闭后需重登', async () => {
  const store = authModule.createAuthStore({ read: () => undefined, write: () => { throw new Error('quota') }, clear: () => {} },
    { platform: 'h5', devEnabled: true, now: () => 1000, devLogin: async () => result() })
  await store.loginDev('a'); assert.equal(store.credentials().userId, '1'); assert.match(store.getSnapshot().notice, /关闭/)
})
test('资料更新必须匹配当前 Token 和用户，过期结果被忽略', async () => {
  const { store } = setup(); await store.loginDev('a')
  assert.equal(store.replaceProfile({ ...profile(), nickname: '保存的昵称' }, 'token-1'), true)
  assert.equal(store.getSnapshot().user.nickname, '保存的昵称')
  await store.loginDev('b')
  assert.equal(store.replaceProfile(profile(), 'token-1'), false); assert.equal(store.getSnapshot().user.id, '2')
})

test('使用期间 Token 到期会在下一次请求前清理身份', async () => {
  let now = 1000
  const { store } = setup({ now: () => now }); await store.loginDev('a')
  now = 101001
  assert.equal(store.credentials(), null); assert.equal(store.getSnapshot().user, null)
})

test('迟到的资料刷新不能覆盖刚保存成功的新昵称', async () => {
  const old = deferred<any>(); const { store } = setup({ getProfile: () => old.promise })
  await store.loginDev('a'); const refreshing = store.refreshProfile()
  store.replaceProfile({ ...profile(), nickname: '刚保存的新昵称' }, 'token-1')
  old.resolve(profile()); await refreshing
  assert.equal(store.getSnapshot().user.nickname, '刚保存的新昵称')
})
test('微信 Token 失效后只静默重登一次，不重复处理旧 Token', async () => {
  let logins = 0
  const { store, calls } = setup({ platform: 'weapp', login: async () => ({ ...result(), token: `wx-${++logins}`, user: { ...profile(), is_test: false } }) })
  await store.initialize(); store.expire('wx-1'); store.expire('wx-1')
  await store.ensureSession()
  assert.equal(store.credentials().token, 'wx-2'); assert.equal(logins, 2)
  assert.equal(calls.filter(c => c === 'code').length, 2)
})
test('并发强制资料刷新等待旧请求后只补发一次新GET', async () => {
  const old = deferred<any>(); const fresh = deferred<any>(); let calls = 0
  const { store } = setup({ getProfile: () => ++calls === 1 ? old.promise : fresh.promise })
  await store.loginDev('a'); const earlier = store.refreshProfile()
  const one = store.refreshProfile(true); const two = store.refreshProfile(true)
  assert.equal(one, two); assert.equal(calls, 1)
  old.resolve(profile()); await earlier; await Promise.resolve()
  assert.equal(calls, 2)
  fresh.resolve({ ...profile(), total_xp: 40 }); await Promise.all([one, two])
  assert.equal(store.getSnapshot().user.total_xp, 40)
})
test('强制资料刷新排队期间切换账号，不对新账号发旧刷新也不恢复旧资料', async () => {
  const old = deferred<any>(); let calls = 0
  const { store } = setup({ getProfile: () => { calls++; return old.promise } })
  await store.loginDev('a'); const earlier = store.refreshProfile(); const forced = store.refreshProfile(true)
  await store.loginDev('b'); old.resolve({ ...profile(), total_xp: 40 }); await Promise.all([earlier, forced])
  assert.equal(calls, 1); assert.equal(store.getSnapshot().user.id, '2'); assert.equal(store.getSnapshot().user.total_xp, 0)
})
test('强制刷新不能跨越切换后又回到相同Token的登录周期', async () => {
  const old = deferred<any>(); let calls = 0
  const { store } = setup({ getProfile: () => { calls++; return old.promise } })
  await store.loginDev('a'); const earlier = store.refreshProfile(); const forced = store.refreshProfile(true)
  await store.loginDev('b'); await store.loginDev('a')
  old.resolve({ ...profile(), nickname: '旧登录资料', total_xp: 40 }); await Promise.all([earlier, forced])
  assert.equal(calls, 1); assert.equal(store.getSnapshot().user.nickname, '同学1'); assert.equal(store.getSnapshot().user.total_xp, 0)
})
test('补发的强制GET仍不能覆盖请求发出后成功保存的新昵称', async () => {
  const old = deferred<any>(); const fresh = deferred<any>(); let calls = 0
  const { store } = setup({ getProfile: () => ++calls === 1 ? old.promise : fresh.promise })
  await store.loginDev('a'); const earlier = store.refreshProfile(); const forced = store.refreshProfile(true)
  old.resolve(profile()); await earlier; await Promise.resolve()
  store.replaceProfile({ ...profile(), nickname: '新昵称' }, 'token-1')
  fresh.resolve({ ...profile(), nickname: '旧昵称', total_xp: 40 }); await forced
  assert.equal(calls, 2); assert.equal(store.getSnapshot().user.nickname, '新昵称')
})
