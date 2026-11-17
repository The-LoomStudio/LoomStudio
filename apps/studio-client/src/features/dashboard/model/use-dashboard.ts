import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { DashboardPeriod, DashboardSnapshot, DashboardTone, DashboardView, UsageDay } from '../../../widgets/dashboard/dashboard-view.js'

const tones: DashboardTone[] = ['accent', 'info', 'success', 'warning', 'pink', 'cyan', 'muted']
function captureRange(period: DashboardPeriod) {
  const now = new Date()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (period === '7') {
    // 以自然周（周一至周日）为统计单位
    const dayOfWeek = (now.getDay() + 6) % 7 // 0 为周一，6 为周日
    const from = new Date(now)
    from.setDate(now.getDate() - dayOfWeek)
    from.setHours(0, 0, 0, 0)

    const to = new Date(from)
    to.setDate(from.getDate() + 7)
    to.setHours(0, 0, 0, 0)
    return { from: from.toISOString(), to: to.toISOString(), timeZone }
  }
  const to = new Date(now)
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  from.setHours(0, 0, 0, 0)
  return { to: to.toISOString(), ...(period !== 'all' ? { from: from.toISOString() } : {}), timeZone }
}

export function useDashboard(api: StudioApi, endpoint: string, open: boolean, view: DashboardView = 'overview') {
  const [selection, setSelection] = useState(() => ({ period: '30' as DashboardPeriod, revision: 0, open, range: captureRange('30') }))
  const [storageRevision, setStorageRevision] = useState(0)
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
  const usage = useQuery({ queryKey: [...base, 'usage', range], queryFn: () => api.dashboard.usage(range), enabled: open, staleTime: 30000, placeholderData: keepPreviousData })
  const play = useQuery({ queryKey: [...base, 'play', range], queryFn: () => api.dashboard.play(range), enabled: open, staleTime: 30000, placeholderData: keepPreviousData })
  const resources = useQuery({ queryKey: [...base, 'resources', revision], queryFn: () => api.dashboard.resources(), enabled: open, staleTime: 30000 })
  const storage = useQuery({ queryKey: [...base, 'storage', revision, storageRevision], queryFn: () => api.dashboard.storage(revision > 0 || storageRevision > 0), enabled: open && view === 'storage', staleTime: 60000 })
  const database = useQuery({ queryKey: [...base, 'database', revision, storageRevision], queryFn: () => api.dashboard.database(), enabled: open && view === 'storage', staleTime: 60000 })
  const backup = useMutation({
    mutationFn: () => api.dashboard.createBackup(),
    onSuccess: () => {
      setStorageRevision(previous => previous + 1)
    },
  })
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

  // OpenRouter 鲜明分色系（用于每日模型/提供商堆叠图）
  const slicePalette = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#eab308', '#06b6d4']
  const othersColor = '#64748b'

  // 模型 Top 6
  const topModelKeys = (usage.data?.providers ?? []).slice(0, 6).map(p => `${p.id}::${p.modelId ?? ''}`)
  const modelColorMap = new Map<string, string>()
  topModelKeys.forEach((key, idx) => {
    modelColorMap.set(key, slicePalette[idx % slicePalette.length]!)
  })

  // 提供商 Top 6
  const providerTotals = new Map<string, { total: number; name: string }>()
  for (const p of usage.data?.providers ?? []) {
    const existing = providerTotals.get(p.id)
    const pTotal = p.total ?? (p.input + p.output)
    if (existing) existing.total += pTotal
    else providerTotals.set(p.id, { total: pTotal, name: p.name })
  }
  const topProviderIds = Array.from(providerTotals.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6)
    .map(e => e[0])
  const providerColorMap = new Map<string, string>()
  topProviderIds.forEach((id, idx) => {
    providerColorMap.set(id, slicePalette[idx % slicePalette.length]!)
  })

  type RawBreakdown = { date: string; providerId: string; providerName: string; modelId: string | null; total: number }
  const rawBreakdowns = (usage.data as { breakdown?: RawBreakdown[] } | undefined)?.breakdown ?? []
  const modelBreakdownByDate = new Map<string, Array<{ id: string; name: string; provider: string; total: number; color: string }>>()
  const providerBreakdownByDate = new Map<string, Array<{ id: string; name: string; provider: string; total: number; color: string }>>()

  for (const item of rawBreakdowns) {
    // 1. 按模型聚合
    const modelKey = `${item.providerId}::${item.modelId ?? ''}`
    const isTopModel = modelColorMap.has(modelKey)
    const mColor = isTopModel ? modelColorMap.get(modelKey)! : othersColor
    const mName = isTopModel ? (item.modelId ?? item.providerName) : 'Others'
    const mId = isTopModel ? modelKey : 'others'
    const mExisting = modelBreakdownByDate.get(item.date) ?? []
    const mFound = mExisting.find(s => s.id === mId)
    if (mFound) {
      mFound.total += item.total
    } else {
      mExisting.push({
        id: mId,
        name: mName,
        provider: item.providerName,
        total: item.total,
        color: mColor,
      })
    }
    modelBreakdownByDate.set(item.date, mExisting)

    // 2. 按提供商聚合
    const isTopProvider = providerColorMap.has(item.providerId)
    const pColor = isTopProvider ? providerColorMap.get(item.providerId)! : othersColor
    const pName = isTopProvider ? item.providerName : 'Others'
    const pId = isTopProvider ? item.providerId : 'others'
    const pExisting = providerBreakdownByDate.get(item.date) ?? []
    const pFound = pExisting.find(s => s.id === pId)
    if (pFound) {
      pFound.total += item.total
    } else {
      pExisting.push({
        id: pId,
        name: pName,
        provider: item.providerName,
        total: item.total,
        color: pColor,
      })
    }
    providerBreakdownByDate.set(item.date, pExisting)
  }

  const rawDaysMap = new Map((usage.data?.days ?? []).map(day => [day.date, day]))
  const targetDates: string[] = []
  const timeZone = range.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })

  if (period === '7' && range.from) {
    const start = new Date(range.from)
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      targetDates.push(formatter.format(d))
    }
  } else if (period === '30' && range.from) {
    const start = new Date(range.from)
    for (let i = 0; i < 30; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      targetDates.push(formatter.format(d))
    }
  } else if (period === 'all' && usage.data?.days.length) {
    const firstDate = usage.data.days[0]!.date
    const lastDate = usage.data.days.at(-1)!.date
    if (firstDate.length === 10 && lastDate.length === 10) {
      const [fy, fm, fd] = firstDate.split('-').map(Number)
      const [ly, lm, ld] = lastDate.split('-').map(Number)
      if (fy && fm && fd && ly && lm && ld) {
        const startUtc = Date.UTC(fy, fm - 1, fd)
        const endUtc = Date.UTC(ly, lm - 1, ld)
        const diffDays = Math.round((endUtc - startUtc) / 86400000)
        if (diffDays >= 0 && diffDays <= 366) {
          const utcFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
          for (let i = 0; i <= diffDays; i++) {
            targetDates.push(utcFormatter.format(new Date(startUtc + i * 86400000)))
          }
        }
      }
    }
  }

  const paddedDays: UsageDay[] = (targetDates.length ? targetDates : (usage.data?.days ?? []).map(d => d.date)).map(dateStr => {
    const day = rawDaysMap.get(dateStr)
    const modelSlices = modelBreakdownByDate.get(dateStr)
    const providerSlices = providerBreakdownByDate.get(dateStr)
    const dayTotal = day ? (day.total ?? (day.input + day.output)) : 0
    const fallbackSlice = [{
      id: 'default',
      name: '总用量',
      provider: '',
      total: dayTotal,
      color: slicePalette[0]!,
    }]
    return {
      date: dateStr,
      input: day?.input ?? 0,
      output: day?.output ?? 0,
      requests: day?.requests ?? 0,
      total: dayTotal,
      slices: modelSlices && modelSlices.length > 0 ? modelSlices : fallbackSlice,
      modelSlices: modelSlices && modelSlices.length > 0 ? modelSlices : fallbackSlice,
      providerSlices: providerSlices && providerSlices.length > 0 ? providerSlices : fallbackSlice,
    }
  })

  const data: DashboardSnapshot = {
    rangeLabel: period === '7' && range.from
      ? `${new Date(range.from).toLocaleDateString()} — ${new Date(new Date(range.from).getTime() + 6 * 86400000).toLocaleDateString()}`
      : `${range.from ? new Date(range.from).toLocaleDateString() : '采集开始'} — ${new Date(range.to).toLocaleDateString()}`,
    collectionStartedAt: usage.data?.collectionStartedAt,
    notices,
    ready: Boolean(usage.data && play.data && resources.data),
    usage: usage.data?.providers.map((row, index) => ({
      id: JSON.stringify([row.id, row.modelId, row.capabilityId]), providerProfileId: row.id, provider: row.name,
      model: row.modelId ?? row.capabilityId ?? '未报告模型', input: row.input, output: row.output, total: row.total,
      totalReported: row.totalReported, inputReported: row.inputReported, outputReported: row.outputReported,
      requests: row.requests, unreported: row.unreported, tone: tones[index % tones.length]!,
    })) ?? [],
    days: paddedDays,
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
  return {
    data,
    range,
    period,
    setPeriod,
    refresh,
    refreshing: queries.some(query => query.isFetching),
    createBackup: () => backup.mutateAsync(),
    creatingBackup: backup.isPending,
  }
}
