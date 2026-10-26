import { before, test } from 'node:test'
import assert from 'node:assert/strict'

let ring: any
before(async () => { ring = await import('../src/domain/ring.ts').catch(() => ({})) })

for (const screen of [320, 375, 414]) {
  test(`圆环在${screen}宽设备上随实际画布居中且不裁切`, () => {
    const size = 84 * screen / 375
    const result = ring.ringGeometry(size, size, 80)
    assert.equal(result.cx, size / 2)
    assert.equal(result.cy, size / 2)
    assert.ok(result.radius + result.lineWidth / 2 < size / 2)
    assert.ok(Math.abs(result.end - result.start - Math.PI * 1.6) < 1e-12)
  })
}

test('非正方形画布按短边绘制，空分数与满分弧度正确', () => {
  const result = ring.ringGeometry(100, 84, 0)
  assert.equal(result.cx, 50); assert.equal(result.cy, 42)
  assert.equal(result.end, result.start)
  const full = ring.ringGeometry(84, 84, 100)
  assert.ok(Math.abs(full.end - full.start - Math.PI * 2) < 1e-12)
  for (const args of [[0, 84, 80], [84, -1, 80], [84, 84, NaN], [84, 84, 101]]) {
    assert.throws(() => ring.ringGeometry(...args), /圆环/)
  }
})
