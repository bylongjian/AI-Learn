import Taro from '@tarojs/taro'
import type { Upload } from './api'

export const uploadDocumentFile: Upload = options => {
  if (options.file.kind !== 'weapp') throw new Error('请重新选择微信文件。')
  return Taro.uploadFile({ url: options.url, filePath: options.file.path, name: 'file',
    formData: { file_name: options.file.name }, header: options.header, timeout: options.timeout })
}
