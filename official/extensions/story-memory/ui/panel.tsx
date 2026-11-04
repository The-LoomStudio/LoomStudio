import React, { useEffect, useRef, useState } from 'react'
import { Button, IconButton, SearchField, Field, TextInput, Textarea, Toggle, Tabs } from '@loom-studio/ui'
import { ArrowLeft, BookOpen, Check, ChevronRight, FileText, Layers, LayoutDashboard, Database, Settings, Sparkles, X } from 'lucide-react'

export type Batch = { id: string; version: number; level: number; fromFloor: number; throughFloor: number; text: string; tokenCount: number; budget: number; status: string; valid: boolean; resident: boolean; published: boolean; running: boolean; error?: string; inputs?: { id: string; version: number }[] }
export type Policy = { enabled: boolean; batchFloors: number; bufferFloors: number; lv2Count: number; lv2Tokens: number; lv1Budget: number; lv2Budget: number }
export type Snapshot = { batches: Batch[]; policy: Policy; policyVersion: number | null; headFloor: number }
export type Call = (method: string, params?: Record<string, unknown>) => Promise<any>
const labels: Record<string, string> = { pending: '准备中', running: '生成中', draft: '待确认', confirmed: '等待采用', failed: '生成失败', cancelled: '已取消', interrupted: '已中断', discarded: '已丢弃' }
const stateLabel = (b: Batch) => !b.valid ? '来源已变化' : b.resident ? '常驻注入' : b.published ? '等待探索' : labels[b.status] ?? b.status
const range = (b: Batch) => `${b.fromFloor}–${b.throughFloor} 楼`
const fields = [
  ['batchFloors', '每批正文楼数', '按固定范围准备 LV1 摘要。', 1, 500],
  ['bufferFloors', '原文缓冲楼数', '首次采用前保留最近的正文；0 表示不保留缓冲。', 0, 500],
  ['lv1Budget', 'LV1 输出上限', '单份原文摘要的 Token 上限。', 100, 32000],
  ['lv2Count', 'LV1 数量阈值', '达到此数量，或下方 Token 阈值，即可准备 LV2。', 2, 100],
  ['lv2Tokens', 'LV1 累计 Token 阈值', '只计算尚未被 LV2 覆盖的常驻 LV1，至少两份。', 100, 500000],
  ['lv2Budget', 'LV2 输出上限', '跨摘要压缩后的 Token 上限。', 100, 64000],
] as const

function PolicyForm({ snapshot, busy, save }: { snapshot: Snapshot; busy: boolean; save(value: Policy, version: number | null): void }) {
  const [draft, setDraft] = useState(snapshot.policy)
  const [version] = useState(snapshot.policyVersion)
  return <form className="settings" onSubmit={e => { e.preventDefault(); save(draft, version) }}>
    <header className="detailHeading"><div><h2>总结设置</h2><p>仅应用于当前故事</p></div></header>
    <div className="settingsBody"><div className="switchRow"><div><strong>自动准备摘要</strong><p>后台整理固定来源，不阻塞主剧情。生成后仍需整批确认。</p></div><Toggle label="自动准备摘要" checked={draft.enabled} disabled={busy} onChange={enabled => setDraft({ ...draft, enabled })} /></div>
      {['原文总结 · LV1', '分层压缩 · LV2'].map((heading, group) => <section className="settingsGroup" key={heading}><h3>{heading}</h3>{fields.slice(group * 3, group * 3 + 3).map(([key, label, hint, min, max]) => <Field key={key} id={`memory-${key}`} label={label} description={hint}>{control => <TextInput {...control} name={key} inputMode="numeric" pattern="[0-9]+" required disabled={busy} value={String(draft[key])} onChange={e => setDraft({ ...draft, [key]: Number(e.target.value) })} onBlur={e => e.target.setCustomValidity(Number(e.target.value) < min || Number(e.target.value) > max ? `请输入 ${min}–${max} 之间的整数` : '')} onInput={e => e.currentTarget.setCustomValidity('')} />}</Field>)}</section>)}
      <section className="presetHint"><BookOpen size={18} /><div><strong>提示词与模型</strong><p>在 Agent 预设中打开「剧情总结」配置模型和提示词。LV1 / LV2 共用一个预设，角色世界书通过锚点提供参考。</p></div></section>
    </div><footer className="footer"><span className="muted">设置不会重写已生成的摘要。</span><Button disabled={busy} type="submit"><Check size={16} />保存设置</Button></footer>
  </form>
}

export function StoryMemoryPanel({ call, timelineId }: { call: Call; timelineId?: string }) {
  const panelRef = useRef<HTMLElement>(null)
  const [data, setData] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [page, setPage] = useState<'dashboard' | 'list' | 'detail' | 'settings'>('dashboard')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [revisions, setRevisions] = useState<Record<string, string>>({})
  const [source, setSource] = useState<{ id: string; text: string }>()
  const [reading, setReading] = useState(false)
  const alive = useRef(true)
  const pending = useRef(false)
  const loading = useRef(false)
  async function refresh() {
    if (loading.current) return
    loading.current = true
    try { const result = await call('status'); if (alive.current) { setData(result); setLoadError('') } }
    catch (e) { if (alive.current) setLoadError(e instanceof Error ? e.message : String(e)) }
    finally { loading.current = false }
  }
  useEffect(() => {
    alive.current = true
    let timer: ReturnType<typeof setTimeout>
    async function poll() { await refresh(); if (alive.current) timer = setTimeout(poll, 3000) }
    void poll()
    return () => { alive.current = false; clearTimeout(timer) }
  }, [call])
  async function operate(method: string, params: Record<string, unknown> = {}) {
    if (pending.current && method !== 'cancel') return
    const ownsPending = method !== 'cancel'
    if (ownsPending) { pending.current = true; setBusy(true) }
    setError('')
    try {
      const result = await call(method, params)
      if (!alive.current) return
      if (result?.id) { setSelected(result.id); setPage('detail') }
      if (method === 'prepare' && !result) setError('当前没有可生成的新批次，请查看已有摘要的处理状态。')
      if (method === 'configure') { setPage('list') }
      await refresh()
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (ownsPending) { pending.current = false; if (alive.current) setBusy(false) } }
  }
  useEffect(() => {
    panelRef.current?.dispatchEvent(new CustomEvent('loom:memory-navigation', { bubbles: true, composed: true, detail: { page } }))
  }, [page])
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (detail?.timelineId === timelineId && ['dashboard','settings','list'].includes(detail.page)) setPage(detail.page)
    }
    window.addEventListener('loom:memory-page', navigate)
    return () => window.removeEventListener('loom:memory-page', navigate)
  }, [timelineId])
  const item = data?.batches.find(b => b.id === selected) ?? data?.batches.find(b => b.status === 'draft') ?? data?.batches[0]
  const filtered = data?.batches.filter(b => `${range(b)} ${b.text}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'draft' && !['confirmed', 'discarded'].includes(b.status) || filter === 'resident' && b.resident || filter === 'explore' && b.status === 'confirmed' && !b.resident && b.valid)) ?? []
  const running = data?.batches.some(b => b.running)
  return <section ref={panelRef} className="memory" aria-label="剧情记忆工作台" data-page={page}>


    {error && <div className="notice" role="alert"><span>{error}</span><IconButton aria-label="关闭提示" onClick={() => setError('')}><X size={14} /></IconButton></div>}

    {!data ? <div className="empty"><BookOpen size={28} /><p>{loadError ? '剧情记忆暂时无法读取' : '正在读取剧情记忆…'}</p>{loadError && <><p role="alert">{loadError}</p><Button onClick={() => void refresh()}>重试</Button></>}</div> : page === 'dashboard' ? <main className="dashboard"><section className="dashboardCard"><h2>剧情记忆</h2><p className="muted">原文分批整理为 LV1，积累后压缩为 LV2，确认后纳入剧情上下文。</p><div className="metrics"><div><strong>{data.headFloor}</strong><span>当前楼层</span></div><div><strong>{data.batches.filter(b => b.resident).length}</strong><span>常驻摘要</span></div><div><strong>{data.batches.filter(b => b.status === 'draft').length}</strong><span>待确认</span></div></div><div className="dashboardActions"><Button disabled={busy || running} onClick={() => void operate('prepare', { level: 1 })}>总结 LV1</Button><Button disabled={busy || running} onClick={() => void operate('prepare', { level: 2 })}>压缩 LV2</Button><Button onClick={() => setPage('list')}>查看数据</Button></div></section>{loadError && <div role="alert">{loadError}<Button onClick={() => void refresh()}>重试读取</Button></div>}</main> : page === 'settings' ? <PolicyForm snapshot={data} busy={busy} save={(value, expectedVersion) => void operate('configure', { value, expectedVersion })} /> : <div className="workbench">
      <aside className="sidebar" aria-label="摘要列表">{loadError && <div className="notice" role="alert"><span>{loadError}</span><Button onClick={() => void refresh()}>重试读取</Button></div>}<div className="filters"><SearchField aria-label="搜索摘要" placeholder="搜索楼层或正文" clearLabel="清空搜索" value={query} onChange={e => setQuery(e.target.value)} onClear={() => setQuery('')} /><Tabs ariaLabel="筛选摘要" size="compact" activeId={filter} onChange={setFilter} items={[{ id: 'all', label: '全部' }, { id: 'draft', label: '待处理' }, { id: 'resident', label: '常驻' }, { id: 'explore', label: '探索' }]} /></div>
        <nav className="list" aria-label="摘要批次">{filtered.map(b => <Button className="batch" key={b.id} aria-current={b.id === item?.id ? 'true' : undefined} onClick={() => { setSelected(b.id); setPage('detail') }}><span className="level">L{b.level}</span><span className="batchIdentity"><strong>第 {range(b)}</strong><small>{stateLabel(b)} · {b.tokenCount} Token</small></span><ChevronRight size={14} /></Button>)}{!filtered.length && <p className="listEmpty">{data.batches.length ? '没有匹配的摘要' : '还没有剧情摘要'}</p>}</nav>
        <div className="sidebarFoot">每 {data.policy.batchFloors} 楼一批 · 缓冲 {data.policy.bufferFloors} 楼<Button size="small" onClick={() => setPage('settings')}>调整</Button></div></aside>
      <main className="detail">{!item ? <div className="empty"><BookOpen size={32} /><h2>为故事留下一份记忆</h2><p>原文分批整理为 LV1，积累后压缩为 LV2。<br />确认采用后，仍能回查原文与下层摘要。</p><Button onClick={() => setPage('settings')}><Settings size={16} />配置总结</Button><small>首次使用请在「剧情总结」预设中选择模型。</small></div> : <>
        <header className="detailHeading"><IconButton className="back" aria-label="返回摘要列表" onClick={() => setPage('list')}><ArrowLeft size={16} /></IconButton><FileText size={20} /><div><h2>LV{item.level} · 第 {range(item)}</h2><p>{item.tokenCount} / {item.budget} Token · 版本 {item.version}</p></div><span className="badge" data-invalid={!item.valid}>{stateLabel(item)}</span></header>
        <div className="body">{!item.valid && <p className="warning">来源已不属于当前剧情，这份摘要不会注入，也不能确认。</p>}{item.error && <p className="warning">{item.error}</p>}<article className="text">{item.text || (item.running ? '正在整理固定来源，你可以继续主剧情写作。' : '尚无摘要正文，可在下方重试生成。')}</article>
          <details className="sources" key={item.id}><summary>来源与覆盖范围</summary><p className="muted">{item.level === 1 ? `原文第 ${range(item)}` : `${item.inputs?.length ?? 0} 份 LV1 摘要 · 第 ${range(item)}`}</p><Button disabled={!item.valid || reading} onClick={async () => { setReading(true); try { const result = await call('source', { id: item.id }); if (alive.current) setSource({ id: item.id, text: result.text }) } catch(e) { if(alive.current) setError(e instanceof Error ? e.message : String(e)) } finally { if(alive.current) setReading(false) } }}>{reading ? '正在读取…' : '读取固定来源'}</Button>{source?.id === item.id && <pre className="source">{source.text}</pre>}</details>
        </div>
        <footer className="review">{item.status === 'confirmed' ? <p className="muted">{!item.valid ? '来源失效，已停止注入。' : item.resident ? '这份摘要已纳入当前剧情上下文。' : item.published ? '已由高层摘要覆盖，保留供探索。' : '已确认，达到原文缓冲边界后自动采用。'}</p> : item.running ? <div className="actions"><span className="muted" role="status">正在生成摘要…</span><Button onClick={() => void operate('cancel', { id: item.id })}>取消生成</Button></div> : item.status !== 'discarded' && item.valid ? <><Field id="memory-revision" label="修订要求">{control => <Textarea {...control} value={revisions[item.id] ?? ''} placeholder="补充遗漏的事件、人物承诺或因果关系…" onChange={e => setRevisions({ ...revisions, [item.id]: e.target.value })} rows={3} />}</Field><div className="reviewActions"><Button variant="danger" disabled={busy} onClick={() => void operate('discard', { id: item.id, version: item.version })}>丢弃草稿</Button><span /><Button disabled={busy} onClick={() => void operate('revise', { id: item.id, version: item.version, input: revisions[item.id]?.trim() || '请重新整理完整摘要，保留必要事实与因果，并遵守输出上限。' })}>{['failed', 'cancelled', 'interrupted'].includes(item.status) ? '重试生成' : '提交修订'}</Button><Button disabled={busy || item.status !== 'draft' || item.tokenCount > item.budget || !item.text.trim()} onClick={() => void operate('confirm', { id: item.id, version: item.version })}><Check size={16} />确认整批摘要</Button></div></> : null}</footer>
      </>}</main>
    </div>}
  </section>
}
