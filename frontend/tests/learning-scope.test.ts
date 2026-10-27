import { before, test } from 'node:test'
import assert from 'node:assert/strict'
let prepare: any
before(async () => { prepare = (await import('../src/services/learning-scope.ts').catch(() => ({})) as any).prepareLearningScope })
test('原账号重登失败时停止学习请求，不能降级上传原账号草稿', async () => {
  assert.equal(typeof prepare, 'function')
  let scope = 'user:1'; let requests = 0
  const auth = { ensureSession: async () => { scope = 'guest' } }
  await assert.rejects(async () => { await prepare(auth, { getScope: () => scope }); requests++ }, /登录/)
  assert.equal(requests, 0)
})
test('原账号恢复可以继续；等待登录时换了另一账号应停止', async () => {
  assert.equal(typeof prepare, 'function')
  assert.equal(await prepare({ ensureSession: async () => {} }, { getScope: () => 'user:1' }), 'user:1')
  let scope = 'user:1'
  await assert.rejects(prepare({ ensureSession: async () => { scope = 'user:2' } }, { getScope: () => scope }), /登录/)
})
test('首次游客输入可以在启动登录完成后明确归入当前账号', async () => {
  assert.equal(typeof prepare, 'function')
  let scope = 'guest'
  assert.equal(await prepare({ ensureSession: async () => { scope = 'user:1' } }, { getScope: () => scope }), 'user:1')
})
