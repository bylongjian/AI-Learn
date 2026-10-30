import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApi, TopicClarificationError } from '../src/services/api.ts'
import { quizFixture } from './fixtures.ts'

const options = [{ label: '领域一', description: '这个概念的第一种含义' }, { label: '领域二', description: '另一种不同含义' }]

test('领域确认是有类型的响应，不会被当作普通生成失败', async () => {
  const api = createApi(() => Promise.resolve({ statusCode: 409, data: { code: 40902, message: '请选择领域', data: { options } } }), 'http://localhost')
  await assert.rejects(api.generateQuiz('Term').promise, (error: any) => {
    assert.equal(error instanceof TopicClarificationError, true)
    assert.deepEqual(error.options, options)
    return true
  })
})

test('领域选择重发原始输入，保留取消与身份检查', async () => {
  let seen: any
  let aborted = false
  const api = createApi((request: any) => {
    seen = request
    return Object.assign(Promise.resolve({ statusCode: 200, data: { code: 0, data: quizFixture() } }), { abort: () => { aborted = true } })
  }, 'http://localhost')
  const pending = (api.generateQuiz as any)('Term', null, '领域一：第一种含义')
  pending.cancel()
  await pending.promise
  assert.equal(seen.data.user_input, 'Term')
  assert.equal(seen.data.topic_context, '领域一：第一种含义')
  assert.equal(aborted, true)
})

test('畸形或无意义领域选项不会进入确认状态', async () => {
  for (const bad of [[], options.slice(0, 1), [...options, ...options, ...options], [{ label: '', description: 'x' }, options[1]], [options[0], options[0]]]) {
    const api = createApi(() => Promise.resolve({ statusCode: 409, data: { code: 40902, data: { options: bad } } }), 'http://localhost')
    await assert.rejects(api.generateQuiz('Term').promise, (error: any) => {
      assert.equal(error instanceof TopicClarificationError, false)
      assert.match(error.message, /领域选项/)
      return true
    })
  }
})

test('资料不足与检索故障保留可理解的说明，不产生题库', async () => {
  for (const [statusCode, code, message] of [[422, 42203, '请补充学习正文'], [503, 50304, '请重试或补充正文']]) {
    const api = createApi(() => Promise.resolve({ statusCode: statusCode as number, data: { code, message, data: null } }), 'http://localhost')
    await assert.rejects(api.generateQuiz('Term').promise, new RegExp(message as string))
  }
})
