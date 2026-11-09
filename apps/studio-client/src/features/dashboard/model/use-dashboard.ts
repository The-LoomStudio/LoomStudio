import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { DashboardPeriod, DashboardSnapshot, DashboardTone, DashboardView } from '../../../widgets/dashboard/dashboard-view.js'

const tones: DashboardTone[] = ['accent', 'info', 'success', 'warning', 'pink', 'cyan', 'muted']
function captureRange(period: DashboardPeriod) {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - (period === '7' ? 6 : 29))
  from.setHours(0, 0, 0, 0)
  return { to: to.toISOString(), ...(period !== 'all' ? { from: from.toISOString() } : {}), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
}

export function useDashboard(api: StudioApi, endpoint: string, open: boolean) {
  const [selection, setSelection] = useState(() => ({ period: '30' as DashboardPeriod, revision: 0, open, range: captureRange('30') }))
  const [view, setView] = useState<DashboardView>('overview')
  // Capture before constructing queries so reopening never subscribes to the previous range first.
  let current = selection
  if (selection.open !== open) {
    current = { ...selection, open, range: open ? captureRange(selection.period) : selection.range }
    setSelection(current)
  }
  const { period, revision, range } = current
  const setPeriod = (next: DashboardPeriod) => setSelection(previous => next === previous.period ? previous : {
    ...previous, period: next, range: open ? captureRange(next) : previous.range,
  })
  const refresh = () => {
    if (open) setSelection(previous => ({ ...previous, revision: previous.revision + 1, range: captureRange(previous.period) }))
  }
  const base = ['dashboard', endpoint]
  const usage = useQuery({ queryKey: [...base, 'usage', range], queryFn: () => api.dashboard.usage(range), enabled: open, staleTime: 30000 })
  const play = useQuery({ queryKey: [...base, 'play', range], queryFn: () => api.dashboard.play(range), enabled: open, staleTime: 30000 })
  const resources = useQuery({ queryKey: [...base, 'resources', revision], queryFn: () => api.dashboard.resources(), enabled: open, staleTime: 30000 })
  const storage = useQuery({ queryKey: [...base, 'storage', revision], queryFn: () => api.dashboard.storage(revision > 0), enabled: open && view === 'storage', staleTime: 60000 })
  const database = useQuery({ queryKey: [...base, 'database', revision], queryFn: () => api.dashboard.database(), enabled: open && view === 'storage', staleTime: 60000 })
  const queries = [usage, play, resources, ...(view === 'storage' ? [storage, database] : [])]
  const notices: string[] = []
  if (queries.some(query => query.isPending)) notices.push('正在读取统计…')
  if (queries.some(query => query.isError)) notices.push('部分统计读取失败，请刷新重试。')
  const showUsage = view === 'overview' || view === 'usage'
  if (showUsage && usage.data?.collectionErrors) notices.push(`存在 ${usage.data.collectionErrors} 次用量采集异常。`)
  if (showUsage && usage.data?.totals.unreported) notices.push(`${usage.data.totals.unreported} 次调用未返回 Token 数据。`)
  if (showUsage && usage.data && usage.data.totals.totalReported < usage.data.totals.reported) notices.push('部分调用仅返回了单向 Token 数据。')
  if (view === 'storage' && database.data?.unavailable) notices.push('当前环境不支持读取 SQLite 表空间明细。')
  if (view === 'storage' && storage.data && storage.data.volumes.length > 1) notices.push('数据、缓存与日志位于不同磁盘，磁盘剩余仅显示数据目录。')
  if (view === 'storage') notices.push(...(storage.data?.errors ?? []))
  const data: DashboardSnapshot = {
    rangeLabel: `${range.from ? new Date(range.from).toLocaleDateString() : '采集开始'} — ${new Date(range.to).toLocaleDateString()}`,
    collectionStartedAt: usage.data?.collectionStartedAt,
    notices,
    ready: Boolean(usage.data && play.data && resources.data),
    usage: usage.data?.providers.map((row, index) => ({
      id: JSON.stringify([row.id, row.modelId, row.capabilityId]), providerProfileId: row.id, provider: row.name,
      model: row.modelId ?? row.capabilityId ?? '未报告模型', input: row.input, output: row.output, total: row.total,
      totalReported: row.totalReported, inputReported: row.inputReported, outputReported: row.outputReported,
      requests: row.requests, unreported: row.unreported, tone: tones[index % tones.length]!,
    })) ?? [],
    days: usage.data?.days.map(day => ({ date: day.date, input: day.input, output: day.output, requests: day.requests, total: day.total })) ?? [],
    play: play.data?.rows.map((row, index) => ({ id: row.id ?? 'unassociated', name: row.name,
      subtitle: `最近发送 ${new Date(row.lastSent).toLocaleString()}`, tone: tones[index % tones.length]!, sends: row.sends, activeDays: row.days, canOpen: Boolean(row.available), stories: row.stories.map(story => ({ ...story, name: story.name ?? '未命名故事', updated: new Date(story.updated).toLocaleDateString() })),
    })) ?? [],
    resources: resources.data?.items,
    storageUpdatedAt: storage.data ? new Date(storage.data.asOf).toLocaleString() : '尚未读取',
    diskFreeBytes: storage.data?.volumes.find(volume => volume.isDataVolume)?.freeBytes,
    storage: storage.data?.groups.map((group, index) => ({
      id: group.id, name: group.name, bytes: group.bytes, tone: tones[index % tones.length]!,
      description: group.id === 'database' ? '包含 SQLite 主库及 WAL/SHM 缓存文件' : `${group.files} 个文件`,
      action: group.id === 'cards' ? '管理角色' : group.id === 'extensions' ? '管理扩展' : group.id === 'logs' ? '打开日志' : '',
      items: group.id === 'database' && database.data && !database.data.unavailable
        ? [...database.data.tables.map(table => ({ name: table.name, bytes: table.bytes })), { name: '空闲页', description: '数据库内空闲页面', bytes: database.data.freeBytes }]
        : [{ name: group.name, description: `${group.files} 个文件`, bytes: group.bytes, count: group.files }],
    })) ?? [],
  }
  return { data, range, period, setPeriod, setView, refresh, refreshing: queries.some(query => query.isFetching) }
}
