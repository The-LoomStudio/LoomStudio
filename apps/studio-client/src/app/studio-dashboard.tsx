import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@loom-studio/ui'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useDashboard } from '../features/dashboard/model/use-dashboard.js'
import { DashboardDialog } from '../widgets/dashboard/dashboard-panel.js'
import type { DashboardAction } from '../widgets/dashboard/dashboard-view.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import styles from '../widgets/dashboard/dashboard-panel.module.scss'

export function StudioDashboard(props: { api: StudioApi; endpoint: string; open: boolean; onClose(): void; onAction(action: DashboardAction): void }) {
  const dashboard = useDashboard(props.api, props.endpoint, props.open)
  const [providerId, setProviderId] = useState<string>()
  const onAction = (action: DashboardAction) => {
    if (action.kind === 'calls') { setProviderId(action.id); return }
    props.onAction(action)
  }
  return <DashboardDialog open={props.open} onClose={props.onClose} data={dashboard.data} period={dashboard.period}
    onPeriodChange={dashboard.setPeriod} onViewChange={dashboard.setView} onAction={onAction}
    detailContent={providerId && <DashboardCalls api={props.api} endpoint={props.endpoint} open={props.open}
      providerId={providerId} range={dashboard.range} rangeLabel={dashboard.data.rangeLabel}
      providerName={dashboard.data.usage.find(row => row.providerProfileId === providerId)?.provider}
      onBack={() => setProviderId(undefined)} />}
    headerActions={<Button aria-label="刷新统计" title="刷新统计" disabled={dashboard.refreshing} onClick={dashboard.refresh}><RefreshCw size={15} /></Button>} />
}

function DashboardCalls(props: {
  api: StudioApi; endpoint: string; open: boolean; providerId: string
  range: ReturnType<typeof useDashboard>['range']; rangeLabel: string; providerName?: string; onBack(): void
}) {
  const calls = useInfiniteQuery({
    queryKey: ['dashboard', props.endpoint, 'calls', props.providerId, props.range],
    enabled: props.open,
    initialPageParam: undefined as { startedAt: string; id: string } | undefined,
    queryFn: ({ pageParam }) => props.api.dashboard.usageRequests({ ...props.range, providerProfileId: props.providerId, limit: 30, cursor: pageParam }),
    getNextPageParam: page => page.nextCursor,
  })
  return <section className={styles.scroll} aria-label="调用记录">
    <Button size="small" variant="ghost" onClick={props.onBack}><ArrowLeft size={15} />返回用量明细</Button>
    <h2>调用记录</h2><p className={styles.note}>{props.rangeLabel} · {props.providerName}</p>
    <p className={styles.note}>仅保存调用与用量事实，不包含消息正文。缺少的字段显示为 —。</p>
    {calls.isPending && <p role="status">正在读取调用记录…</p>}
    {calls.isError && <p role="alert">调用记录读取失败。<Button size="small" onClick={() => void calls.refetch()}>重试</Button></p>}
    {calls.data && <div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>时间 / 模型</th><th>状态</th><th>输入</th><th>输出</th><th>总 Token</th></tr></thead>
      <tbody>{calls.data.pages.flatMap(page => page.items).map(call => <tr key={call.id}>
        <td>{new Date(call.startedAt).toLocaleString()}<small>{call.modelId ?? call.capabilityId ?? '未报告模型'}</small></td>
        <td>{({ completed: '完成', failed: '失败', cancelled: '取消', running: '进行中', unknown: '结果未知' } as Record<string, string>)[call.status] ?? call.status}</td>
        <td>{call.usage?.inputTokens?.toLocaleString() ?? '—'}</td><td>{call.usage?.outputTokens?.toLocaleString() ?? '—'}</td>
        <td>{(call.usage?.totalTokens ?? (call.usage?.inputTokens !== undefined && call.usage.outputTokens !== undefined ? call.usage.inputTokens + call.usage.outputTokens : undefined))?.toLocaleString() ?? '—'}</td>
      </tr>)}</tbody>
    </table>{calls.data.pages[0]?.items.length === 0 && <p>此范围内没有调用记录。</p>}</div>}
    {calls.hasNextPage && <Button disabled={calls.isFetchingNextPage} onClick={() => void calls.fetchNextPage()}>加载更多</Button>}
  </section>
}
