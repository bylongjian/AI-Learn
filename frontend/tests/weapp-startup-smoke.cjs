const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Run after build:weapp. This exercises the emitted entry and its real chunk/module graph.
const root = path.resolve(__dirname, '../dist/weapp')
const loaded = new Set()
const timers = new Map()
let timerId = 0
let app
let page
const wx = {
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.15.0', version: '8.0.0', pixelRatio: 2, windowWidth: 375, windowHeight: 800, screenWidth: 375, screenHeight: 800, language: 'zh_CN' }),
  getStorageSync: () => '', getAppBaseInfo: () => ({ language: 'zh_CN' }), canIUse: () => true,
  nextTick: callback => Promise.resolve().then(callback),
}
const context = vm.createContext({
  wx, console, Promise, performance, TextEncoder, TextDecoder,
  setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
  clearTimeout: id => timers.delete(id),
  App: options => { app = options }, Page: options => { page = options }, Component: () => {},
  getApp: () => app, getCurrentPages: () => [], Behavior: options => options,
})
function evaluate(file) {
  file = path.resolve(file)
  if (loaded.has(file)) return
  loaded.add(file)
  const previous = context.require
  context.require = request => evaluate(path.resolve(path.dirname(file), request.endsWith('.js') ? request : `${request}.js`))
  try { vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file, timeout: 5000 }) }
  finally { context.require = previous }
}
try { evaluate(path.join(root, 'app.js')) }
catch (error) { assert.fail(`WeChat App entry failed before registration: ${error.name}: ${error.message}`) }
assert.ok(app && typeof app.onLaunch === 'function', 'App must register before a page can render')
evaluate(path.join(root, 'pages/index/index.js'))
assert.ok(page, 'The first real page must register')

// Inspect the real runtime exports without relying on generated numeric module IDs.
let requireRuntime
wx.webpackJsonp.push([[987654321], {}, require => { requireRuntime = require }])
const candidates = Object.entries(requireRuntime.m).filter(([, factory]) => {
  const source = factory.toString()
  return source.includes('requestAnimationFrame') && source.includes('cancelAnimationFrame') && source.includes('createPageConfig') && source.includes('MutationObserver')
})
assert.equal(candidates.length, 1, 'Find the emitted Taro runtime barrel')
const runtime = requireRuntime(candidates[0][0])
let tick
const scheduled = runtime.requestAnimationFrame(value => { tick = value })
assert.ok(timers.has(scheduled), 'Mini RAF must retain its timer fallback')
timers.get(scheduled).callback()
assert.equal(typeof tick, 'number')
const canceled = runtime.requestAnimationFrame(() => assert.fail('Canceled RAF must not run'))
runtime.cancelAnimationFrame(canceled)
assert.equal(timers.has(canceled), false, 'Mini cancelAnimationFrame must cancel the fallback timer')
console.log('WeChat emitted App/Page startup and RAF timer/cancellation smoke passed.')
