import type { createApi, Pending } from './api'
import type { DocumentList, SelectedFile } from '../domain/knowledge'

type Api = Pick<ReturnType<typeof createApi>, 'getKnowledgeDocuments' | 'uploadDocument' | 'deleteKnowledgeDocument'>
interface Snapshot extends DocumentList { loading: boolean; loaded: boolean; busy: boolean; error: string }
const empty = (): Snapshot => ({ items: [], limit: 10, max_file_bytes: 10485760, loading: false, loaded: false, busy: false, error: '' })

export function createKnowledgeLibrary(api: Api, currentUser: () => string | null) {
  let snapshot = empty(), revision = 0, visible = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const requests = new Set<Pending<unknown>>()
  function emit(changes: Partial<Snapshot>) { snapshot = { ...snapshot, ...changes }; listeners.forEach(listener => listener()) }
  function stop() { clearTimeout(timer); timer = undefined }
  function poll() {
    stop()
    if (visible && !snapshot.busy && !snapshot.error && snapshot.items.some(doc => doc.status === 'processing' || doc.status === 'deleting')) {
      timer = setTimeout(() => { void refresh() }, 2000)
    }
  }
  function current(token: number, user: string) { return token === revision && user === currentUser() }
  async function refresh() {
    const user = currentUser(), token = revision
    if (!user || snapshot.loading) return
    stop(); emit({ loading: true, error: '' })
    let request: Pending<DocumentList> | undefined
    try {
      request = api.getKnowledgeDocuments(user); requests.add(request)
      const result = await request.promise
      if (current(token, user)) emit({ ...result, loaded: true })
    } catch (failure) {
      if (current(token, user)) emit({ error: failure instanceof Error ? failure.message : '暂时无法读取知识库，请重试。' })
    } finally {
      if (request) requests.delete(request)
      if (current(token, user)) { emit({ loading: false }); poll() }
    }
  }
  async function action(run: (user: string) => Pending<unknown>) {
    const user = currentUser()
    if (!user || snapshot.busy) return
    const token = ++revision
    stop()
    for (const pending of requests) pending.cancel()
    requests.clear()
    emit({ busy: true, loading: false, error: '' })
    let request: Pending<unknown> | undefined
    try {
      request = run(user); requests.add(request)
      await request.promise
      if (current(token, user)) await refresh()
    } catch (failure) {
      if (current(token, user)) emit({ error: failure instanceof Error ? failure.message : '操作未完成，请刷新后重试。' })
    } finally {
      if (request) requests.delete(request)
      if (current(token, user)) { emit({ busy: false }); poll() }
    }
  }
  function hide() {
    visible = false; revision++; stop()
    for (const request of requests) request.cancel()
    requests.clear(); emit({ loading: false, busy: false })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async show() { visible = true; await refresh() },
    hide,
    reset() { hide(); snapshot = empty(); emit({}) },
    refresh,
    upload(file: SelectedFile) { return action(user => api.uploadDocument(file, user)) },
    remove(docId: string) { return action(user => api.deleteKnowledgeDocument(docId, user)) },
  }
}
