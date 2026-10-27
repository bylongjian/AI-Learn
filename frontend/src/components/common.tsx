import type { ReactNode } from 'react'
import Taro from '@tarojs/taro'
import { Button, Image, Text, View } from '@tarojs/components'
import { iconAssets } from './icons'
import { learningStore } from '../storage'

export type IconName = 'home' | 'layers' | 'user' | 'left' | 'right' | 'arrow' | 'check' | 'success' | 'close' | 'search' | 'clock' | 'document' | 'book' | 'refresh' | 'alert' | 'plus' | 'spark'
export function Icon({ name, tone = 'muted', className = '' }: { name: IconName; tone?: string; className?: string }) {
  return <Image className={`icon ${className}`} src={iconAssets[`${name}-${tone}`] || iconAssets[`${name}-muted`]} mode='scaleToFill' />
}
export function Btn({ children, onClick, className = 'primary', disabled = false, label }: { children: ReactNode; onClick: () => void; className?: string; disabled?: boolean; label?: string }) {
  return <Button className={className} onClick={onClick} {...(disabled ? { disabled: true } : {})} hoverClass='none' ariaLabel={label}>{children}</Button>
}
export function goRoot(page: 'index' | 'library' | 'profile') { return Taro.reLaunch({ url: `/pages/${page}/index` }) }
export function newTopic() { learningStore.setDraft(''); return goRoot('index') }
export function Empty({ title, copy, action = '去闯关', onAction = newTopic, symbol = 'book' }: { title: string; copy: string; action?: string; onAction?: () => void; symbol?: IconName }) {
  return <View className='empty-state'><Icon name={symbol} tone='soft' /><View className='empty-title'>{title}</View><View className='empty-copy'>{copy}</View><Btn className='text-action' onClick={onAction}>{action} <Icon name='arrow' tone='brand' /></Btn></View>
}
export function Loading({ report = false, onCancel, cancelLabel }: { report?: boolean; onCancel: () => void; cancelLabel?: string }) {
  const steps = report ? ['汇总本轮答题情况', '找出答对与待巩固的知识点', '生成知识总结与学习建议'] : ['理解学习主题', '梳理关键知识点', '准备题目、选项与知识讲解']
  return <View className='loading-state'><View className='loader-orbit'><Icon name={report ? 'document' : 'spark'} tone='brand' /></View><View className='state-title'>{report ? '整理这一轮的收获' : '把好奇，变成一小关'}</View><View className='state-copy'>{report ? '答题记录已保留，正在整理知识总结。' : '正在整理主题和题目，请稍等片刻。'}</View><View className='generation-steps'>{steps.map((step, index) => <View className={`generation-step${index === 2 ? ' pending' : ''}`} key={step}>{index === 2 ? <View className='mini-dot' /> : <Icon name='check' tone='green' />}<Text>{step}</Text></View>)}</View><Btn className='secondary-text' onClick={onCancel}>{cancelLabel || (report ? '返回我的' : '返回修改主题')}</Btn></View>
}
export function Failure({ report = false, readOnly = false, detail, error, onRetry, onCancel, cancelLabel }: { report?: boolean; readOnly?: boolean; detail: string; error?: string; onRetry: () => void; onCancel: () => void; cancelLabel?: string }) {
  return <View className='failure-state'><Icon name='alert' tone='soft' /><View className='state-title'>{readOnly ? '报告暂时无法读取' : report ? '报告暂时没有生成' : '这次没有生成成功'}</View><View className='state-copy'>{readOnly ? '可能是连接暂时中断了。\n已有的学习记录会保留，请重试。' : report ? '答题记录和成绩都已保留。\n可以重新整理，不需要再答一遍。' : '可能是连接暂时中断了。\n你的输入还在，稍后再试一次。'}</View><View className='failure-detail'>{detail}</View>{error && <View className='field-error'>{error}</View>}<Btn onClick={onRetry}>{readOnly ? '重新读取' : '重新生成'}</Btn><Btn className='secondary-text' onClick={onCancel}>{cancelLabel || (report ? '返回我的' : '返回修改主题')}</Btn></View>
}
