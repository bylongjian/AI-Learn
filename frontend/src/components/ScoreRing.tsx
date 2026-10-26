import { useCallback, useEffect, useRef } from 'react'
import Taro, { useReady, useResize } from '@tarojs/taro'
import { Canvas, Text, View } from '@tarojs/components'
import { ringGeometry } from '../domain/ring'

export default function ScoreRing({ accuracy }: { accuracy: number }) {
  const id = useRef(`accuracy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`).current
  const drawVersion = useRef(0)
  const draw = useCallback(() => {
    const version = ++drawVersion.current
    function paint(width: number, height: number) {
        if (version !== drawVersion.current) return
        const { cx, cy, radius, lineWidth, start, end } = ringGeometry(width, height, accuracy)
        const ctx = Taro.createCanvasContext(id)
        ctx.clearRect(0, 0, width, height); ctx.setLineWidth(lineWidth)
        ctx.setStrokeStyle('#edeae7'); ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke()
        if (accuracy > 0) {
          ctx.setStrokeStyle('#c6531a'); ctx.setLineCap('round'); ctx.beginPath()
          ctx.arc(cx, cy, radius, start, end); ctx.stroke()
        }
        ctx.draw()
    }
    if (process.env.TARO_ENV === 'h5') {
      // Taro's Web Component otherwise infers bitmap dimensions after mounting,
      // causing a second render that clears the first drawing. Explicit 2x
      // dimensions avoid that render; draw after pending DOM work has settled.
      requestAnimationFrame(() => paint(168, 168))
    } else {
      Taro.nextTick(() => {
        Taro.createSelectorQuery().select(`#${id}-bounds`).boundingClientRect(rect => {
          const bounds = Array.isArray(rect) ? rect[0] : rect
          if (bounds && bounds.width > 0 && bounds.height > 0) paint(bounds.width, bounds.height)
        }).exec()
      })
    }
  }, [accuracy, id])
  useEffect(() => { draw(); return () => { drawVersion.current++ } }, [draw])
  useReady(() => { if (process.env.TARO_ENV !== 'h5') draw() })
  useResize(draw)
  return <View id={`${id}-bounds`} className='score-ring' ariaLabel={`本轮正确率 ${accuracy}%`}><Canvas id={id} canvasId={id} width={process.env.TARO_ENV === 'h5' ? '168' : undefined} height={process.env.TARO_ENV === 'h5' ? '168' : undefined} className='score-canvas' /><Text className='score-number'>{accuracy}<Text className='percent-unit'>%</Text></Text></View>
}
