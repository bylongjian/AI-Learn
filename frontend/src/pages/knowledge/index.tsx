import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { Input, Text, View } from '@tarojs/components'
import AppShell from '../../components/AppShell'
import AccountControls from '../../components/AccountControls'
import DocumentPicker from '../../components/DocumentPicker'
import { Btn, Icon, goRoot } from '../../components/common'
import { api, authStore } from '../../services/client'
import { useAuthStore } from '../../auth'
import { createKnowledgeLibrary } from '../../services/knowledge-library'
import { documentStatusLabel } from '../../domain/knowledge'
import { createSession, validateTopic } from '../../domain/learning'
import { learningStore } from '../../storage'
import { historyStore } from '../../history'
import { TopicClarificationError, type TopicOption } from '../../services/api'
import './index.css'

export default function KnowledgePage() {
  const auth = useAuthStore()
  const library = useMemo(() => createKnowledgeLibrary(api, () => authStore.credentials()?.userId || null), [])
  const snapshot = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const [topics, setTopics] = useState<Record<string, string>>({})
  const [error, setError] = useState(''), [generating, setGenerating] = useState('')
  const [options, setOptions] = useState<TopicOption[]>([]), [selectedDoc, setSelectedDoc] = useState('')
  const revision = useRef(0), visible = useRef(false), cancel = useRef<() => void>(() => {})
  function stop() { revision.current++; cancel.current(); setGenerating(''); setOptions([]) }
  useDidShow(() => { visible.current = true; void library.show() })
  useDidHide(() => { visible.current = false; library.hide(); stop() })
  useEffect(() => {
    library.reset(); stop(); setTopics({}); setError('')
    if (visible.current && auth.user) void library.show()
  }, [auth.user?.id])
  useEffect(() => {
    if (selectedDoc && !snapshot.items.some(doc => doc.doc_id === selectedDoc && doc.status === 'ready')) {
      setOptions([]); setSelectedDoc('')
    }
  }, [snapshot.items, selectedDoc])
  useEffect(() => () => { library.hide(); revision.current++; cancel.current() }, [])
  async function generate(docId: string, context?: string) {
    const doc = snapshot.items.find(item => item.doc_id === docId)
    if (!doc || doc.status !== 'ready') {
      setOptions([]); setSelectedDoc(''); setError('文档已不可用，请刷新知识库后重新选择。'); return
    }
    const topic = topics[docId] ?? doc.file_name.replace(/\.[^.]+$/, '')
    const invalid = validateTopic(topic)
    if (invalid) { setError(invalid); return }
    if (generating) return
    const identity = authStore.credentials()
    if (!identity) { setError('请先登录，再从文档开始闯关。'); return }
    const attempt = ++revision.current, scope = learningStore.getScope()
    setGenerating(docId); setError(''); setOptions([]); setSelectedDoc(docId)
    try {
      const request = api.generateQuiz(topic, identity.userId, context, docId); cancel.current = request.cancel
      const quiz = await request.promise
      if (attempt !== revision.current) return
      if (!learningStore.saveSession(createSession(quiz), scope)) throw new Error('账号已切换，请在原账号重新打开。')
      historyStore.invalidate(identity.userId)
      await Taro.navigateTo({ url: `/pages/quiz/index?id=${encodeURIComponent(quiz.quiz_id)}` })
    } catch (failure) {
      if (attempt !== revision.current) return
      if (failure instanceof TopicClarificationError) setOptions(failure.options)
      else setError(failure instanceof Error ? failure.message : '生成失败，请稍后重试。')
    } finally { if (attempt === revision.current) setGenerating('') }
  }
  async function remove(docId: string) {
    const identity = authStore.credentials()?.userId
    const answer = await Taro.showModal({ title: '删除这份文档？', content: '检索片段将清除，已生成的题库、报告和引用摘录会保留。', confirmText: '删除文档', cancelText: '保留' })
    if (answer.confirm && identity === authStore.credentials()?.userId) await library.remove(docId)
  }
  return <AppShell onBack={() => { void goRoot('profile') }} backLabel='返回我的'>
    <View className='page-title'>我的知识库</View><View className='page-subtitle'>把自己的资料，变成一轮学习</View>
    {!auth.user ? <View className='knowledge-login'><Icon name='book' tone='brand' /><View className='section-title'>登录后，资料只属于你</View><View className='knowledge-copy'>登录后可上传课程讲义、学习笔记和培训资料。</View><AccountControls /></View> : <>
      <View className='knowledge-upload'><View className='knowledge-section-heading'><View className='section-title'>添加学习资料</View><Text className='knowledge-count'>{snapshot.items.length} / {snapshot.limit} 篇</Text></View>
        <View className='knowledge-copy'>PDF / DOCX / Markdown / TXT，每篇不超过 10MB。PDF 需能复制文字。</View>
        <DocumentPicker disabled={snapshot.busy || snapshot.loading || !!generating || snapshot.items.length >= snapshot.limit} onSelect={file => {
          if (!visible.current || authStore.credentials()?.userId !== auth.user?.id) return
          setError(''); void library.upload(file)
        }} onError={setError} />
        <View className='knowledge-privacy'>文字片段将发送至百炼向量化，检索片段发送至 DeepSeek 出题。原文件解析后删除；联网补充只发送学习主题。</View>
        {snapshot.busy && <View className='knowledge-progress' role='status'>正在提交操作，请稍等…</View>}
      </View>
      {(error || snapshot.error) && <View className='field-error' role='alert'>{error || snapshot.error}</View>}
      {!!generating && <View className='knowledge-progress' role='status'><View>正在准备资料和五道题，最多等待 55 秒。</View><View className='knowledge-copy'>先检索文档，再联网补充；仍失败时会生成明确标注的模型练习。</View><Btn className='text-action' onClick={stop}>取消等待</Btn></View>}
      {!!options.length && <View className='knowledge-options'><View className='section-title'>你想学习哪个领域？</View>{options.map(option => <Btn key={option.label} className='secondary' onClick={() => void generate(selectedDoc, `${option.label}：${option.description}`)}>{option.label} · {option.description}</Btn>)}</View>}
      <View className='knowledge-section-heading'><View className='section-title'>我的文档</View><Btn className='text-action' disabled={snapshot.loading || snapshot.busy} onClick={() => void library.refresh()}>{snapshot.loading ? '刷新中…' : '刷新列表'}</Btn></View>
      {snapshot.loaded && !snapshot.items.length && <View className='knowledge-empty'><Icon name='document' tone='soft' /><View className='section-title'>第一份学习资料，从这里开始</View><View className='knowledge-copy'>上传后会显示处理状态，文档就绪即可开始闯关。</View></View>}
      {snapshot.items.map(doc => <View className='knowledge-card' key={doc.doc_id}>
        <View className='knowledge-document-heading'><Icon name='document' tone='brand' /><View className='knowledge-document-title'>{doc.file_name}</View><Text className={`knowledge-status ${doc.status}`}>{documentStatusLabel[doc.status]}</Text></View>
        <View className='knowledge-copy'>{(doc.file_size / 1024).toFixed(1)} KB{doc.status === 'ready' ? ` · ${doc.chunk_count} 个检索片段` : ''}</View>
        {doc.status === 'processing' && <View className='knowledge-copy'>正在解析与准备检索，含排队最多 180 秒。离开页面后仍会处理。</View>}
        {doc.error_message && <View className='field-error'>{doc.error_message}</View>}
        {doc.status === 'ready' && <View className='knowledge-topic'><View className='field-label'>学习主题</View><Input ariaLabel={`${doc.file_name} 的学习主题`} className='knowledge-topic-input' maxlength={2000} disabled={!!generating || snapshot.busy} value={topics[doc.doc_id] ?? doc.file_name.replace(/\.[^.]+$/, '')} onInput={event => setTopics(current => ({ ...current, [doc.doc_id]: event.detail.value }))} /><View className='knowledge-copy'>可修改为具体知识点，题目会更贴近目标。</View></View>}
        <View className='knowledge-actions'><Btn disabled={doc.status !== 'ready' || !!generating || snapshot.busy || snapshot.loading} onClick={() => void generate(doc.doc_id)}>开始闯关</Btn>
          <Btn className='text-action' disabled={doc.status === 'deleting' || !!generating || snapshot.busy || snapshot.loading} onClick={() => { void remove(doc.doc_id).catch(() => setError('删除确认未完成，请重试。')) }}>{doc.status === 'delete_failed' ? '重试删除' : '删除'}</Btn></View>
      </View>)}
      <View className='knowledge-footer'>失败记录仍占文档名额；删除文档不会移除已有题库、报告和引用摘录。</View>
    </>}
  </AppShell>
}
