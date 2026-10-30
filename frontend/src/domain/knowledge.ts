export type DocumentStatus = 'processing' | 'ready' | 'failed' | 'deleting' | 'delete_failed'
export interface KnowledgeDocument {
  doc_id: string; file_name: string; file_type: string; file_size: number; status: DocumentStatus; chunk_count: number
  error_code: string | null; error_message: string | null; created_at: string; updated_at: string
}
export interface DocumentList { items: KnowledgeDocument[]; limit: number; max_file_bytes: number }
export type SelectedFile = { name: string; size: number } & ({ kind: 'weapp'; path: string } | { kind: 'h5'; file: File })

export function validateDocument(value: unknown): KnowledgeDocument {
  const doc = value as KnowledgeDocument
  if (!doc || typeof doc.doc_id !== 'string' || !/^[0-9a-f-]{36}$/.test(doc.doc_id) ||
    typeof doc.file_name !== 'string' || !doc.file_name.trim() || doc.file_name.length > 255 ||
    !['.pdf', '.docx', '.md', '.txt'].includes(doc.file_type) || !Number.isSafeInteger(doc.file_size) || doc.file_size < 1 ||
    !['processing', 'ready', 'failed', 'deleting', 'delete_failed'].includes(doc.status) || !Number.isSafeInteger(doc.chunk_count) || doc.chunk_count < 0 ||
    ![doc.created_at, doc.updated_at].every(time => typeof time === 'string' && /(Z|[+-]\d\d:\d\d)$/.test(time) && Number.isFinite(Date.parse(time))) ||
    ![doc.error_code, doc.error_message].every(text => text === null || typeof text === 'string')) throw new Error('文档信息格式不正确，请刷新知识库。')
  return doc
}

export function validateDocumentList(value: unknown): DocumentList {
  const list = value as DocumentList
  if (!list || !Array.isArray(list.items) || !Number.isSafeInteger(list.limit) || list.limit < 1 || list.limit > 10 ||
    list.items.length > list.limit || !Number.isSafeInteger(list.max_file_bytes) || list.max_file_bytes < 1) throw new Error('知识库列表格式不正确，请重试。')
  const items = list.items.map(validateDocument)
  if (new Set(items.map(doc => doc.doc_id)).size !== items.length) throw new Error('知识库列表有重复记录，请重试。')
  return { ...list, items }
}

export function validateSelectedFile(file: SelectedFile): void {
  if (!/\.(pdf|docx|md|txt)$/i.test(file.name)) throw new Error('请选择 PDF、DOCX、Markdown 或 TXT 文件。')
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('请选择有内容且不超过 10MB 的文件。')
  if (file.name.length > 255) throw new Error('文件名过长，请重命名后上传。')
}

export const documentStatusLabel: Record<DocumentStatus, string> = {
  processing: '处理中', ready: '已就绪', failed: '处理失败', deleting: '正在删除', delete_failed: '删除未完成',
}
