import Taro from '@tarojs/taro'
import { Text, View } from '@tarojs/components'
import { Btn, Icon } from './common'
import type { HistoryRow } from '../history/store'
import type { HistorySnapshot } from '../history/store'

export function historyTime(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}
export function ReportRows({ rows, from }: { rows: HistoryRow[]; from: 'index' | 'profile' }) {
  return <View className='list-surface'>{rows.map(row => <Btn className='report-row' key={row.quiz_id} onClick={() => { void Taro.navigateTo({ url: `/pages/report/index?id=${encodeURIComponent(row.quiz_id)}&from=${from}` }) }}><View><View className='row-title'>{row.title}</View><View className='row-detail'>{row.correct_count} / {row.question_count} 题 · {row.accuracy}% · {historyTime(row.created_at)}{row.local && !row.local.report ? ' · 报告待同步' : ''}</View></View><Icon name='right' /></Btn>)}</View>
}
export function HistoryFeedback({ history }: { history: HistorySnapshot & { refresh(): void; loadMore(): void } }) {
  return <>
    {(history.loading || (!history.loaded && !history.error)) && <View className='local-note'>正在读取云端记录…</View>}
    {!!history.error && <View className='history-feedback'><View className='field-error'>{history.error}</View><View className='local-note'>已保留当前设备的学习记录。</View><Btn className='text-action center-action' disabled={history.loading} onClick={history.refresh}>重新读取 <Icon name='refresh' tone='brand' /></Btn></View>}
    {history.loaded && !history.error && history.items.length < history.total && <View className='library-new'><Btn className='text-action center-action' disabled={history.loading} onClick={history.loadMore}>{history.loading ? '正在读取…' : '加载更多'} <Text>({history.items.length}/{history.total})</Text></Btn></View>}
  </>
}
