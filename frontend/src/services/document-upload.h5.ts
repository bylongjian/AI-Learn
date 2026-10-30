import type { Upload } from './api'

export const uploadDocumentFile: Upload = options => {
  if (options.file.kind !== 'h5') throw new Error('请重新选择浏览器文件。')
  const controller = new AbortController()
  const form = new FormData()
  form.append('file', options.file.file, options.file.name)
  const timer = setTimeout(() => controller.abort(), options.timeout)
  const task = fetch(options.url, { method: 'POST', body: form, headers: options.header, signal: controller.signal })
    .then(async response => ({ statusCode: response.status, data: await response.text() })).finally(() => clearTimeout(timer))
  return Object.assign(task, { abort: () => controller.abort() })
}
