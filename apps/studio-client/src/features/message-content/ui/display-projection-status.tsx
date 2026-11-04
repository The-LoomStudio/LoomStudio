import { useEffect, useId, useRef } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { HistoryProjectionSnapshot } from '../../../entities/index.js'

export function describeDisplayDiagnostics(diagnostics: HistoryProjectionSnapshot['diagnostics']): string {
  const descriptions = diagnostics.map(item => item.code === 'text.use_unresolved'
    ? `预设「${item.presetName ?? '未命名预设'}」的${item.resourceKind === 'extractor' ? '提取器' : '规则'}${item.resourceName ? `「${item.resourceName}」` : item.referenceIndex ? `（第 ${item.referenceIndex} 项引用，原资源名称不可用）` : '引用'}不可用，请检查预设的资源绑定。`
    : item.code === 'display.entry.stale' ? '显示结果尚未同步到当前消息，可刷新重试。'
    : '内容显示规则未能正常处理，请检查规则配置。')
  return [...new Set(descriptions)].join('\n')
}

export function DisplayProjectionStatus(props: {
  projection?: { warning?: string; error?: string; diagnostics?: HistoryProjectionSnapshot['diagnostics']; inspect?: () => void; refreshing?: boolean; retry?: () => void }
  retryLabel: string
}) {
  const ownerId = useId()
  const message = props.projection?.error ?? props.projection?.warning
  const latest = useRef(props.projection)
  latest.current = props.projection
  const failed = !!props.projection?.error
  const description = failed ? '消息显示处理未完成，可查看详情或检查显示规则。'
    : describeDisplayDiagnostics(props.projection?.diagnostics ?? []) || '内容显示规则需要检查。'
  const inspect = !failed && !props.projection?.diagnostics?.every(item => item.code === 'display.entry.stale')
  useEffect(() => {
    if (!message) return
    const options = { id: `display-projection:${ownerId}`, description, details: message,
      action: inspect && latest.current?.inspect ? { label: '检查规则', onClick: () => latest.current?.inspect?.() }
        : latest.current?.retry ? { label: props.retryLabel, onClick: () => latest.current?.retry?.() } : undefined }
    const id = failed ? notify.error('内容显示处理失败', options) : notify.warning('内容显示规则需要检查', options)
    return () => { notify.dismiss(id) }
  }, [ownerId, message, description, failed, inspect, props.retryLabel])
  return null
}
