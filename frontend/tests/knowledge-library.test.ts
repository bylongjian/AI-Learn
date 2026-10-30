import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKnowledgeLibrary } from '../src/services/knowledge-library.ts'

const row = { doc_id: '26abc7a0-6639-4a4d-842f-2889d3f555cc', file_name: '课程.txt', file_type: '.txt', file_size: 10,
  status: 'processing' as const, chunk_count: 0, error_code: null, error_message: null, created_at: '2026-10-30T03:00:00Z', updated_at: '2026-10-30T03:00:00Z' }
const pending = <T>(data: T) => ({ promise: Promise.resolve(data), cancel() {}, userId: '1' })

test('知识库刷新状态到就绪并在隐藏时停止轮询', async () => {
  let calls = 0
  const api = { getKnowledgeDocuments: () => { calls++; return pending({ items: [{ ...row, status: calls === 1 ? 'processing' : 'ready' }], limit: 10, max_file_bytes: 10485760 }) } }
  const library = createKnowledgeLibrary(api as any, () => '1')
  await library.show()
  assert.equal(library.getSnapshot().items[0].status, 'processing')
  library.hide()
  const before = calls
  await new Promise(resolve => setTimeout(resolve, 2100))
  assert.equal(calls, before)
  await library.show()
  assert.equal(library.getSnapshot().items[0].status, 'ready')
  library.hide()
})

test('删除失败可刷新后重试，上传结果不明不自动重传', async () => {
  let deletes = 0, uploads = 0
  let oldRefresh!: (value: any) => void
  let delayNextRead = false
  const api = {
    getKnowledgeDocuments: () => {
      if (delayNextRead) {
        delayNextRead = false
        return { ...pending(null), promise: new Promise(resolve => { oldRefresh = resolve }) }
      }
      return pending({ items: [{ ...row, status: deletes ? 'deleting' : 'delete_failed' }], limit: 10, max_file_bytes: 10485760 })
    },
    deleteKnowledgeDocument: () => { deletes++; return pending({ doc_id: row.doc_id, status: 'deleting' }) },
    uploadDocument: () => { uploads++; return { ...pending(row), promise: Promise.reject(new Error('连接中断，请刷新列表')) } },
  }
  const library = createKnowledgeLibrary(api as any, () => '1')
  await library.show()
  delayNextRead = true
  const refreshing = library.refresh()
  await library.remove(row.doc_id)
  oldRefresh({ items: [{ ...row, status: 'ready' }], limit: 10, max_file_bytes: 10485760 })
  await refreshing
  assert.equal(library.getSnapshot().items[0].status, 'deleting')
  await library.upload({ kind: 'weapp', name: '课程.txt', size: 10, path: '/tmp/course' })
  assert.equal(uploads, 1)
  assert.match(library.getSnapshot().error, /连接中断/)
  library.hide()
})

test('账号切换清空列表并丢弃迟到响应', async () => {
  let user = '1', canceled = false
  let finish!: (value: any) => void
  const api = { getKnowledgeDocuments: () => ({ promise: new Promise(resolve => { finish = resolve }), cancel() { canceled = true }, userId: '1' }) }
  const library = createKnowledgeLibrary(api as any, () => user)
  const loading = library.show()
  user = '2'
  library.reset()
  finish({ items: [row], limit: 10, max_file_bytes: 10485760 })
  await loading
  assert.deepEqual(library.getSnapshot().items, [])
  assert.equal(canceled, true)
  library.hide()
})
