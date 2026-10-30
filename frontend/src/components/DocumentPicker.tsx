import Taro from '@tarojs/taro'
import { Btn } from './common'
import type { SelectedFile } from '../domain/knowledge'

export interface DocumentPickerProps { disabled: boolean; onSelect(file: SelectedFile): void; onError(message: string): void }
export default function DocumentPicker({ disabled, onSelect, onError }: DocumentPickerProps) {
  async function choose() {
    try {
      const result = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['pdf', 'docx', 'md', 'txt'] })
      const file = result.tempFiles[0]
      if (file) onSelect({ kind: 'weapp', name: file.name, size: file.size, path: file.path })
    } catch (failure) {
      const message = (failure as { errMsg?: string }).errMsg || ''
      if (!message.includes('cancel')) onError('文件选择未完成，请重试。')
    }
  }
  return <Btn disabled={disabled} onClick={() => void choose()}>选择文档上传</Btn>
}
