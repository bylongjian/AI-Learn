export function ringGeometry(width: number, height: number, accuracy: number) {
  if (![width, height, accuracy].every(Number.isFinite) || width <= 0 || height <= 0 || accuracy < 0 || accuracy > 100) {
    throw new Error('圆环尺寸或正确率无效。')
  }
  const size = Math.min(width, height)
  const start = -Math.PI / 2
  return { cx: width / 2, cy: height / 2, radius: size * 34 / 80, lineWidth: size * 6 / 80,
    start, end: start + Math.PI * 2 * accuracy / 100 }
}
