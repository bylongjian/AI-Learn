import { useRef } from 'react'
import { Btn } from './common'
import type { DocumentPickerProps } from './DocumentPicker'

export default function DocumentPicker({ disabled, onSelect }: DocumentPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <input ref={input} type='file' accept='.pdf,.docx,.md,.txt' aria-label='选择学习文档' hidden onChange={event => {
      const file = event.target.files?.[0]
      if (file) onSelect({ kind: 'h5', name: file.name, size: file.size, file })
      event.target.value = ''
    }} />
    <Btn disabled={disabled} onClick={() => input.current?.click()}>选择文档上传</Btn>
  </>
}
