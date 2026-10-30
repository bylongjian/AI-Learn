import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

interface NativeUi {
  navigateTo(options: { url: string }): Promise<unknown>
  showLoading(options: { title: string; mask: boolean }): Promise<unknown>
  hideLoading(options: { noConflict: boolean; complete?(): void }): void
  showToast(options: { title: string }): Promise<unknown>
}

function loadNavigation(native: NativeUi) {
  const source = readFileSync(new URL('../src/components/common.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const exports: { goReport?: (id: string, from: 'index' | 'library' | 'profile') => Promise<unknown> } = {}
  vm.runInNewContext(code, { exports, require(name: string) {
    if (name === '@tarojs/taro') return { __esModule: true, default: native }
    if (['react/jsx-runtime', '@tarojs/components', './icons', '../storage'].includes(name)) return {}
    throw new Error(`Unexpected UI dependency: ${name}`)
  } })
  assert.ok(exports.goReport)
  return exports.goReport
}

test('报告打开期间立即提示，连续点击只跳转一次，完成后可以再次打开', async () => {
  let finish!: () => void
  const route = new Promise<void>(resolve => { finish = resolve })
  const urls: string[] = [], prompts: string[] = []
  let hides = 0
  const open = loadNavigation({
    navigateTo: async options => { urls.push(options.url); await route },
    showLoading: async options => { assert.equal(options.mask, true); prompts.push(options.title) },
    hideLoading: options => { assert.equal(options.noConflict, true); hides++; queueMicrotask(() => options.complete?.()) },
    showToast: async () => { throw new Error('Successful navigation must not show an error') },
  })
  const first = open('quiz?1', 'library')
  assert.strictEqual(first, open('quiz?1', 'library'))
  assert.deepEqual(prompts, ['正在打开报告'])
  assert.deepEqual(urls, ['/pages/report/index?id=quiz%3F1&from=library'])
  finish(); await first
  await open('quiz-2', 'profile')
  assert.equal(urls.length, 2)
  assert.equal(hides, 2)
})

test('提示接口不可用时仍能报告导航失败并重试，不留下导航锁', async () => {
  let attempts = 0, hides = 0
  const messages: string[] = []
  const open = loadNavigation({
    navigateTo: async () => { if (++attempts === 1) throw new Error('native route failed') },
    showLoading: async () => { throw new Error('native loading unavailable') },
    hideLoading: options => {
      options.complete?.()
      if (++hides === 1) return Promise.reject(new Error('native hide unavailable'))
      return Promise.resolve()
    },
    showToast: async options => { messages.push(options.title) },
  })
  await open('quiz-1', 'index')
  assert.deepEqual(messages, ['报告页面未打开，请重试'])
  await open('quiz-1', 'index')
  assert.equal(attempts, 2)
  assert.equal(hides, 2)
  assert.equal(messages.length, 1)
})
