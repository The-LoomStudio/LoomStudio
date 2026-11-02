import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button, Dialog, SearchField, Tabs } from '@loom-studio/ui'
import { ArrowLeft, ArrowUpRight, ChartNoAxesCombined, ChevronRight, Database, HardDrive, Layers3, MessageSquare, Sparkles } from 'lucide-react'
import type { DashboardAction, DashboardPeriod, DashboardSnapshot, DashboardTone, DashboardView, PlayRow, StorageGroup, UsageDay, UsageRow } from './dashboard-view.js'
import styles from './dashboard-panel.module.scss'

type Props = {
  data: DashboardSnapshot
  period: DashboardPeriod
  onPeriodChange(period: DashboardPeriod): void
  onAction(action: DashboardAction): void
  onViewChange?(view: DashboardView): void
}
type Detail = { kind: 'provider' | 'card' | 'storage'; id: string }
const number = (value: number) => value.toLocaleString('zh-CN')
const tokens = (value: number) => value >= 1000000 ? `${(value / 1000000).toFixed(2)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : number(value)
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${(value / 1024 ** 2).toFixed(value ? 1 : 0)} MiB`
const totalTokens = (row: UsageRow) => row.total ?? row.input + row.output
const toneStyle = (tone: DashboardTone) => ({ '--category-color': `var(--dashboard-${tone})` }) as CSSProperties
const views = [
  { id: 'overview', label: '概览' }, { id: 'usage', label: '模型用量' },
  { id: 'play', label: '游玩统计' }, { id: 'resources', label: '资源' }, { id: 'storage', label: '数据与存储' },
] as const

const resourceGroups = [
  { title: '创作素材', ids: ['character', 'resource', 'preset', 'media'] },
  { title: '扩展与处理', ids: ['extensions', 'scripts', 'text-transform', 'extractors'] },
  { title: '故事与会话', ids: ['timelines', 'sessions'] },
]

export function DashboardDialog(props: Props & { open: boolean; onClose(): void; headerActions?: ReactNode; detailContent?: ReactNode }) {
  const [view, setView] = useWorkbenchView<DashboardView>('dashboard.tab', 'overview', views.map(view => view.id))
  const snapshot = view === 'resources' || view === 'storage'
  const rangeHelp = props.data.collectionStartedAt ? `用量与发送记录始于 ${new Date(props.data.collectionStartedAt).toLocaleDateString()}，此前的数据未补录。` : undefined
  const changeView = (next: DashboardView) => { setView(next); props.onViewChange?.(next) }
  return <Dialog open={props.open} onClose={props.onClose} title={<span className={styles.dialogTitle}><span>数据总览</span><span className={styles.headerMeta} title={snapshot ? undefined : rangeHelp}>{snapshot ? '当前快照' : props.data.rangeLabel}</span></span>} titleIcon={<ChartNoAxesCombined size={19} />} layout="workbench" className={styles.dialog} headerActions={props.headerActions}>
    {props.data.ready === false && <div className={styles.empty} role="status">{props.data.notices?.map(notice => <p key={notice}>{notice}</p>)}</div>}
    {props.detailContent}
    <div style={props.data.ready === false || props.detailContent ? { display: 'none' } : { height: '100%', minHeight: 0 }}><DashboardPanel view={view} data={props.data} period={props.period} onPeriodChange={props.onPeriodChange} onAction={props.onAction} onViewChange={changeView} /></div>
  </Dialog>
}

export function DashboardPanel({ data, period, onPeriodChange, onAction, onViewChange, view }: Props & { view: DashboardView }) {
  const [detail, setDetail] = useState<Detail>()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'sends' | 'activeDays'>('sends')
  const [providerFilter, setProviderFilter] = useState('all')
  const heading = useRef<HTMLHeadingElement>(null)
  const origin = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (detail) heading.current?.focus()
    else if (origin.current?.isConnected) origin.current.focus()
  }, [detail])

  const input = data.usage.reduce((sum, row) => sum + row.input, 0)
  const inputKnown = !data.usage.length || data.usage.some(row => row.inputReported !== 0)
  const outputKnown = !data.usage.length || data.usage.some(row => row.outputReported !== 0)
  const totalKnown = !data.usage.length || data.usage.some(row => row.totalReported !== 0)
  const output = data.usage.reduce((sum, row) => sum + row.output, 0)
  const requests = data.usage.reduce((sum, row) => sum + row.requests, 0)
  const unreported = data.usage.reduce((sum, row) => sum + row.unreported, 0)
  const sends = data.play.reduce((sum, row) => sum + row.sends, 0)
  const storageBytes = data.storage.reduce((sum, row) => sum + row.bytes, 0)
  const characters = data.play.filter(row => `${row.name} ${row.subtitle}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b[sort] - a[sort])
  const selectedProvider = detail?.kind === 'provider' ? data.usage.find(row => row.id === detail.id) : undefined
  const selectedCard = detail?.kind === 'card' ? data.play.find(row => row.id === detail.id) : undefined
  const selectedStorage = detail?.kind === 'storage' ? data.storage.find(row => row.id === detail.id) : undefined
  const detailTitle = selectedProvider?.provider ?? selectedCard?.name ?? selectedStorage?.name

  function open(next: Detail, button: HTMLButtonElement) { origin.current = button; setDetail(next) }
  function navigate(next: DashboardView) { setDetail(undefined); onViewChange?.(next) }

  const providerList = (compact: boolean) => <div className={styles.providers}>{data.usage.map(row => <button type="button" key={row.id} className={styles.providerRow} onClick={event => open({ kind: 'provider', id: row.id }, event.currentTarget)} style={toneStyle(row.tone)}>
    <span className={styles.dot} /><span className={styles.rowCopy}><strong>{row.provider}</strong><small>{row.model}</small><span className={styles.meter}><i style={{ width: `${data.usage.some(item => totalTokens(item) > 0) ? totalTokens(row) / (data.usage.reduce((sum, item) => sum + totalTokens(item), 0) || 1) * 100 : 0}%` }} /></span></span>
    <span className={styles.rowValue}><strong>{row.totalReported === 0 ? '—' : tokens(totalTokens(row))}</strong><small>{compact ? `${Math.round(totalTokens(row) / (data.usage.reduce((sum, item) => sum + totalTokens(item), 0) || 1) * 100)}%` : `${number(row.requests)} 次请求`}</small></span><ChevronRight size={14} />
  </button>)}</div>

  const playList = (rows: PlayRow[]) => rows.length ? <div>{rows.map((row, index) => <button type="button" key={row.id} className={styles.playRow} onClick={event => open({ kind: 'card', id: row.id }, event.currentTarget)}>
    <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><span className={styles.avatar} style={toneStyle(row.tone)}>{row.name.slice(0, 1)}</span>
    <span className={styles.rowCopy}><strong>{row.name}</strong><small>{row.stories.length} 个故事 · {number(row.sends)} 次发送</small></span><span className={styles.rowValue}><strong>{number(row.sends)} 次发送</strong><small>发送 {row.activeDays} 天</small></span><ChevronRight size={14} />
  </button>)}</div> : <Empty title={search ? '没有找到匹配的角色' : '还没有游玩记录'} description={search ? '试试角色名称或故事关键词。' : '开始一段故事后，在这里回看你的足迹。'} />

  return <section className={styles.panel} aria-label="数据总览">
    <div className={styles.navigation}><Tabs items={views} activeId={view} onChange={navigate} ariaLabel="Dashboard 视图" /><div className={styles.period}>{view === 'usage' && data.collectionStartedAt && <InfoDialog title="统计口径"><p>从 {new Date(data.collectionStartedAt).toLocaleDateString()} 开始记录，不补录此前用量。只统计提供商报告的 Token，包含重试和未采用的生成。</p></InfoDialog>}
      {view === 'storage' || view === 'resources' ? null : <><span className={styles.periodLabel}>统计范围</span><select aria-label="统计时间范围" value={period} onChange={event => onPeriodChange(event.target.value as DashboardPeriod)}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="all">全部记录</option></select></>}
    </div></div>
    <div className={styles.scroll}>
      {detailTitle ? <div className={styles.detail}>
        <Button size="small" variant="ghost" onClick={() => setDetail(undefined)}><ArrowLeft size={15} />返回{views.find(item => item.id === view)?.label}</Button>
        <div className={styles.detailHeading}><div><span className={styles.eyebrow}>{selectedStorage ? 'STORAGE' : selectedCard ? 'PLAY ACTIVITY' : 'MODEL USAGE'}</span><h2 tabIndex={-1} ref={heading}>{detailTitle}</h2><p>{selectedStorage?.description ?? selectedCard?.subtitle ?? selectedProvider?.model}</p></div>
          {(!selectedStorage || selectedStorage.action) && selectedCard?.canOpen !== false && <Button onClick={() => onAction({ kind: detail!.kind, id: selectedProvider?.providerProfileId ?? detail!.id, label: selectedStorage?.action ?? (selectedCard ? '打开角色' : '配置提供商') })}><ArrowUpRight size={16} />{selectedStorage?.action ?? (selectedCard ? '打开角色' : '配置提供商')}</Button>}
        </div>
        {selectedProvider && <>
          <div className={styles.metrics}><Metric label="输入 Token" value={selectedProvider.inputReported === 0 ? '—' : tokens(selectedProvider.input)} note="提供商已报告" icon={<Layers3 />} /><Metric label="输出 Token" value={selectedProvider.outputReported === 0 ? '—' : tokens(selectedProvider.output)} note="提供商已报告" icon={<Sparkles />} /><Metric label="请求次数" value={number(selectedProvider.requests)} note="包含重新生成与重试" icon={<MessageSquare />} /><Metric label="未报告用量" value={number(selectedProvider.unreported)} note="未作为零用量计入" icon={<ChartNoAxesCombined />} /></div>
          <Section title="用量构成" subtitle={data.rangeLabel}><div className={styles.tokenSplit} role="img" aria-label={`输入 ${number(selectedProvider.input)}，输出 ${number(selectedProvider.output)} Token`}><span style={{ flex: selectedProvider.input }} /><span style={{ flex: selectedProvider.output }} /></div><div className={styles.chartCaption}><span className={styles.inputLegend}>输入 {tokens(selectedProvider.input)}</span><span className={styles.outputLegend}>输出 {tokens(selectedProvider.output)}</span></div><p className={styles.note}>这里展示请求时的提供商与模型归属。请求估算不计入已报告用量。</p><Button size="small" onClick={() => onAction({ kind: 'calls', id: selectedProvider.providerProfileId ?? selectedProvider.id, label: '查看调用记录' })}>查看调用记录<ArrowUpRight size={14} /></Button></Section>
        </>}
        {selectedCard && <>
          <div className={styles.metrics}><Metric label="用户发送" value={number(selectedCard.sends)} note="所选时间范围内" icon={<MessageSquare />} /><Metric label="发送天数" value={number(selectedCard.activeDays)} note="有接受用户发送的日期" icon={<ChartNoAxesCombined />} /><Metric label="相关故事" value={number(selectedCard.stories.length)} note="当前保留的故事" icon={<Layers3 />} /></div>
          <Section title="继续你的故事" subtitle={data.rangeLabel}>{selectedCard.stories.map(story => <div className={styles.storyRow} key={story.id}><span className={styles.rowCopy}><strong>{story.name}</strong><small>{number(story.sends)} 次发送 · 最近更新 {story.updated}</small></span><Button size="small" onClick={() => onAction({ kind: 'story', id: story.id, label: `继续游玩 · ${story.name}` })}>继续游玩<ArrowUpRight size={14} /></Button></div>)}</Section>
        </>}
        {selectedStorage && <>
          <div className={styles.storageHero}><HardDrive size={26} /><strong>{bytes(selectedStorage.bytes)}</strong><span>占应用文件总量 {(selectedStorage.bytes / (storageBytes || 1) * 100).toFixed(1)}%</span></div>
          <Section title={selectedStorage.id === 'database' ? '数据库里存了什么' : '占用明细'} subtitle={selectedStorage.id === 'database' ? '按 SQL 表及所属索引统计逻辑页占用' : '当前快照'}>
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>内容</th>{selectedStorage.items.some(item => item.count !== undefined) && <th>记录 / 文件</th>}<th>{selectedStorage.id === 'database' ? '逻辑页占用' : '文件大小'}</th></tr></thead><tbody>{selectedStorage.items.map(item => <tr key={item.name}><td><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</td>{selectedStorage.items.some(item => item.count !== undefined) && <td>{item.count === undefined ? '—' : number(item.count)}</td>}<td>{bytes(item.bytes)}</td></tr>)}</tbody></table></div>
            <p className={styles.note}>{selectedStorage.id === 'database' ? '空闲页已包含在数据库文件中，WAL / SHM 计入文件快照。删除记录后，文件大小不一定立即缩小。' : selectedStorage.id === 'blobs' ? '共享素材只计算一次。删除角色或素材引用，不等于回收底层文件。' : '管理操作需要先查看具体内容与影响范围。'}</p>
          </Section>
        </>}
      </div> : <>
        {view === 'overview' && <>
          <div className={styles.metrics}><Metric label="已报告 Token" value={totalKnown ? tokens(data.usage.reduce((sum, row) => sum + totalTokens(row), 0)) : '—'} note={`${inputKnown ? tokens(input) : '—'} 输入 / ${outputKnown ? tokens(output) : '—'} 输出`} icon={<Sparkles />} /><Metric label="用户发送" value={number(sends)} note={`${data.play.length} 个游玩角色`} icon={<MessageSquare />} /><Metric label="模型调用" value={number(requests)} note="所有已记录的宿主调用" icon={<ChartNoAxesCombined />} /><Metric label="应用文件大小" value={data.storage.length ? bytes(storageBytes) : '—'} note="当前快照 · 不随日期筛选" icon={<HardDrive />} /></div>
          <div className={styles.overviewGrid}>
            <Section title="用量趋势" subtitle="每天的模型消耗" action={<More onClick={() => navigate('usage')} />}><UsageChart days={data.days} /></Section>
            <Section title="用量来源" subtitle={`${number(requests)} 次请求`} action={<More onClick={() => navigate('usage')} />}>{data.usage.length ? providerList(true) : <Empty title="还没有模型用量" description="有调用记录后，这里会展示用量来源。" />}<p className={styles.note}>{unreported ? `${unreported} 次请求未报告用量，未计入 Token 合计。` : '按提供商配置区分，同名模型分别统计。'}</p></Section>
            <Section title="最近的故事足迹" subtitle="按用户发送次数排列" action={<More onClick={() => navigate('play')} />}>{playList(data.play.slice(0, 3))}</Section>
            <Section title="数据存储" subtitle="应用文件大小构成" action={<More onClick={() => navigate('storage')} />}><StorageBar groups={data.storage} onSelect={(group, button) => open({ kind: 'storage', id: group.id }, button)} /><p className={styles.note}>共享素材仅计一次 · 当前快照</p></Section>
          </div>
        </>}
        {view === 'usage' && <>
          <div className={styles.metrics}><Metric label="输入 Token" value={inputKnown ? tokens(input) : '—'} note="提供商已报告" icon={<Layers3 />} /><Metric label="输出 Token" value={outputKnown ? tokens(output) : '—'} note="提供商已报告" icon={<Sparkles />} /><Metric label="模型请求" value={number(requests)} note="包含重试与重新生成" icon={<MessageSquare />} /><Metric label="未报告用量" value={number(unreported)} note="不使用估算补齐" icon={<ChartNoAxesCombined />} /></div>
          <Section title="每日用量" subtitle="点击日期柱查看当天明细"><UsageChart key={period} days={data.days} /></Section>
          <Section title="提供商与模型" subtitle="按请求发生时的配置归属" action={<select aria-label="筛选提供商" value={providerFilter} onChange={event => setProviderFilter(event.target.value)}><option value="all">全部提供商</option>{data.usage.map(row => <option key={row.id} value={row.id}>{row.provider}</option>)}</select>}>
            {data.usage.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>提供商 / 模型</th><th>输入 Token</th><th>输出 Token</th><th>请求</th><th>未报告</th><th><span className={styles.srOnly}>操作</span></th></tr></thead><tbody>{data.usage.filter(row => providerFilter === 'all' || row.id === providerFilter).map(row => <tr key={row.id}><td><span className={styles.providerName} style={toneStyle(row.tone)}><span className={styles.dot} />{row.provider}</span><small>{row.model}</small></td><td>{row.inputReported === 0 ? '—' : tokens(row.input)}</td><td>{row.outputReported === 0 ? '—' : tokens(row.output)}</td><td>{number(row.requests)}</td><td>{row.unreported || '—'}</td><td><Button size="small" aria-label={`查看 ${row.provider} 明细`} onClick={event => open({ kind: 'provider', id: row.id }, event.currentTarget)}>明细<ChevronRight size={14} /></Button></td></tr>)}</tbody></table></div> : <Empty title="还没有模型用量" description="请求估算与提供商实际报告的用量会分开展示。" />}
          </Section>
        </>}
        {view === 'play' && <>
          <div className={styles.metrics}><Metric label="游玩角色" value={number(data.play.length)} note="所选时间范围内" icon={<Layers3 />} /><Metric label="用户发送" value={number(sends)} note="不含工具与内部记录" icon={<MessageSquare />} /><Metric label="相关故事" value={number(data.play.reduce((sum, row) => sum + row.stories.length, 0))} note="当前保留的故事" icon={<ChartNoAxesCombined />} /></div>
          <Section title="角色足迹" subtitle="每一次重逢，都有记录"><div className={styles.filters}><SearchField value={search} onChange={event => setSearch(event.target.value)} onClear={() => setSearch('')} clearLabel="清空角色搜索" aria-label="搜索角色" placeholder="搜索角色…" /><select aria-label="角色排序" value={sort} onChange={event => setSort(event.target.value as 'sends' | 'activeDays')}><option value="activeDays">按发送天数</option><option value="sends">按发送次数</option></select></div>{playList(characters)}</Section>
        </>}
        {view === 'resources' && <Section title="内部资源" subtitle="当前存活实体 · 引用和挂载不重复计数">
          {data.resources?.length ? <div className={styles.resourceGroups}>{resourceGroups.map(group => {
            const items = group.ids.flatMap(id => data.resources?.filter(item => item.id === id) ?? [])
            if (!items.length) return null
            return <section className={styles.resourceGroup} key={group.title}>
              <h3>{group.title}</h3>
              <table className={`${styles.table} ${styles.resourceTable}`} aria-label={group.title}>
                <thead><tr><th scope="col">类型</th><th scope="col">数量</th><th scope="col"><span className={styles.srOnly}>操作</span></th></tr></thead>
                <tbody>{items.map(item => <tr key={item.id}>
                  <td><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</td>
                  <td><strong>{number(item.count)}</strong><span className={styles.resourceUnit}>{item.unit}</span></td>
                  <td>{item.id !== 'media' && <Button size="small" variant="ghost" aria-label={`管理${item.label}`} onClick={() => onAction({ kind: 'resource', id: item.id, label: item.label })}>管理<ArrowUpRight size={14} /></Button>}</td>
                </tr>)}</tbody>
              </table>
            </section>
          })}</div> : <Empty title="暂无资源" description="创建或导入资源后，可在这里查看数量。" />}
        </Section>}
        {view === 'storage' && <>
          <Section title="应用存储" subtitle={`服务端文件快照 · ${data.storageUpdatedAt}`}><div className={styles.storageHero}><HardDrive size={26} /><strong>{data.storage.length ? bytes(storageBytes) : '—'}</strong><span>数据目录磁盘剩余 {data.diskFreeBytes === undefined ? '—' : bytes(data.diskFreeBytes)}</span></div><StorageBar groups={data.storage} onSelect={(group, button) => open({ kind: 'storage', id: group.id }, button)} /></Section>
          <Section title="分类管理" subtitle="选择分类，查看内容与占用明细">{data.storage.length ? data.storage.map(group => <button type="button" className={styles.storageRow} key={group.id} onClick={event => open({ kind: 'storage', id: group.id }, event.currentTarget)} style={toneStyle(group.tone)}><span className={styles.dot} /><span className={styles.rowCopy}><strong>{group.name}</strong><small>{group.description}</small></span><span className={styles.rowValue}><strong>{bytes(group.bytes)}</strong><small>{(group.bytes / (storageBytes || 1) * 100).toFixed(1)}%</small></span><ChevronRight size={15} /></button>) : <Empty title="暂无存储快照" description="获取快照后，可查看各类文件的大小与内容。" />}</Section>
          <p className={styles.note}>删除业务资源与回收物理空间是两项操作。这里不将仍被引用的素材或历史恢复数据标记为可清理。</p>
        </>}
      </>}
      {!!data.notices?.length && <aside className={styles.notices} aria-label="统计状态" role="status">{data.notices.map(notice => <p key={notice}>{notice}</p>)}</aside>}

    </div>
  </section>
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <div className={styles.metric}><span className={styles.metricLabel}>{icon}{label}</span><strong>{value}</strong><small>{note}</small></div>
}
function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return <section className={styles.section}><header className={styles.sectionHeader}><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>
}
function More({ onClick }: { onClick(): void }) { return <Button size="small" variant="ghost" onClick={onClick}>查看全部<ArrowUpRight size={14} /></Button> }
function Empty({ title, description }: { title: string; description: string }) { return <div className={styles.empty}><Database size={24} /><strong>{title}</strong><p>{description}</p></div> }

function UsageChart({ days }: { days: UsageDay[] }) {
  const [selection, setSelection] = useState<string>()
  const [series, setSeries] = useState<'all' | 'input' | 'output'>('all')
  const selected = days.find(day => day.date === selection)
  const value = (day: UsageDay) => series === 'all' ? day.total ?? day.input + day.output : day[series]
  const max = Math.max(...days.map(value), 1)
  if (!days.length) return <Empty title="还没有用量趋势" description="模型调用后的已报告用量会按日期汇总。" />
  return <div className={styles.chart}>
    <div className={styles.chartToolbar}><span className={styles.chartScale}>峰值 {tokens(max)}</span><div>{(['all', 'input', 'output'] as const).map(item => <Button key={item} size="small" variant="ghost" aria-pressed={series === item} onClick={() => setSeries(item)}>{{ all: '全部', input: '输入', output: '输出' }[item]}</Button>)}</div></div>
    <div className={styles.plot} style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>{days.map(day => <button type="button" key={day.date} className={styles.day} aria-pressed={selection === day.date} aria-label={`${day.date}，输入 ${number(day.input)}，输出 ${number(day.output)} Token，${day.requests} 次请求`} title={`${day.date} · ${number(value(day))} Tokens`} onClick={() => setSelection(day.date)}><span className={styles.bar} style={{ height: `${value(day) / max * 100}%` }}>{series === 'all' && day.total !== undefined && day.total > day.input + day.output && <i style={{ flex: day.total - day.input - day.output, background: 'var(--loom-color-text-subtle)' }} />}{series !== 'input' && <i className={styles.outputBar} style={{ flex: day.output }} />}{series !== 'output' && <i className={styles.inputBar} style={{ flex: day.input }} />}</span></button>)}</div>
    <div className={styles.axis}><span>{days[0]!.date.slice(5).replace('-', '/')}</span><span>{days[Math.floor(days.length / 2)]!.date.slice(5).replace('-', '/')}</span><span>{days.at(-1)!.date.slice(5).replace('-', '/')}</span></div>
    <div className={styles.chartCaption} aria-live="polite">{selected ? <><strong>{selected.date.slice(5).replace('-', '/')}</strong><span>输入 {tokens(selected.input)}</span><span>输出 {tokens(selected.output)}</span><span>{selected.requests} 次请求</span></> : <><span className={styles.inputLegend}>输入 Token</span><span className={styles.outputLegend}>输出 Token</span><span className={styles.muted}>点击日期查看明细</span></>}</div>
  </div>
}

function StorageBar({ groups, onSelect }: { groups: StorageGroup[]; onSelect(group: StorageGroup, button: HTMLButtonElement): void }) {
  const total = groups.reduce((sum, group) => sum + group.bytes, 0)
  if (!groups.length) return <Empty title="暂无存储快照" description="快照将展示应用文件的分类占用。" />
  return <div className={styles.storageChart}><div className={styles.storageBar} aria-label="应用存储分类占比">{groups.map(group => <button type="button" key={group.id} style={{ ...toneStyle(group.tone), flex: group.bytes / (total || 1) }} title={`${group.name} · ${bytes(group.bytes)}`} aria-label={`${group.name} ${bytes(group.bytes)}，查看明细`} onClick={event => onSelect(group, event.currentTarget)} />)}</div><div className={styles.legend}>{groups.map(group => <button type="button" key={group.id} style={toneStyle(group.tone)} onClick={event => onSelect(group, event.currentTarget)}><span className={styles.dot} /><span>{group.name}</span><strong>{bytes(group.bytes)}</strong></button>)}</div></div>
}
