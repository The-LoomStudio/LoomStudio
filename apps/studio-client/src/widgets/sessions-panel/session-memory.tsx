import { InfoDialog } from '../../shared/ui/info-dialog/info-dialog.js'
import { useCallback, useEffect, useRef, useState, useId, type ReactNode, type FormEvent } from 'react'
import { Button, Checkbox, Dialog } from '@loom-studio/ui'
import { BookOpen, RefreshCw, Settings2, Sparkles, X } from 'lucide-react'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { LongTextEditor } from '../../shared/ui/long-text-editor/long-text-editor.js'
import { useSessionSummaryStatus } from '../../features/sessions/model/use-session-summary-status.js'
import styles from './session-memory.module.scss'
import { useTokenCounts } from '../../shared/tokenizer/use-token-counts.js'

type Props = { navigation?: ReactNode; api: StudioApi; sessionId: string; branchId?: string; onSaved?(sessionId: string): Promise<void> }
type Memory = Awaited<ReturnType<StudioApi['agentSessions']['memory']>>
type Policy = Memory['policy']
const statusLabels = { idle: '空闲', preparing: '正在总结', ready: '等待采用', adopted: '已采用', failed: '总结失败' }
const fields = [
  { key: 'maxTokens', label: '摘要 Token 上限', min: 1 },
  { key: 'bufferFloors', label: '正文缓冲楼层', min: 0 },
  { key: 'triggerFloors', label: '正文触发楼层数', min: 1 },
  { key: 'triggerTokens', label: 'Session Token 兜底阈值', min: 1 },
] as const

export function SessionMemory(props: Props) {
  return <SessionMemoryContent key={`${props.sessionId}:${props.branchId ?? ''}`} {...props} />
}

function SessionMemoryContent({ api, sessionId, branchId, onSaved, navigation }: Props) {
  const formId = useId()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [memory, setMemory] = useState<Memory>()
  const [draft, setDraft] = useState<Policy>()
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState<'save' | 'summarize' | 'cancel'>()
  const [edit, setEdit] = useState<{ id: string; entryCount: number; original: string; content: string }>()
  const [savingSummary, setSavingSummary] = useState(false)
  const [editError, setEditError] = useState<string>()
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (busy !== 'summarize' || typeof PerformanceObserver === 'undefined'
      || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return
    let count = 0
    let longestMs = 0
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) { count++; longestMs = Math.max(longestMs, entry.duration) }
    })
    observer.observe({ type: 'longtask' })
    return () => {
      for (const entry of observer.takeRecords()) { count++; longestMs = Math.max(longestMs, entry.duration) }
      observer.disconnect()
      if (count) console.warn('[Loom Session summary] Main-thread stalls', { count, longestMs: Math.round(longestMs) })
    }
  }, [busy])
  const mounted = useRef(true)
  const request = useRef(0)
  const dirtyRef = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current++ }
  }, [])
  const refresh = useCallback(async () => {
    const current = ++request.current
    try {
      const next = await api.agentSessions.memory({ agentSessionId: sessionId, branchId })
      if (!mounted.current || current !== request.current) return
      setMemory(next)
      if (!dirtyRef.current) setDraft(next.policy)
      setLoadError(undefined)
    } catch (cause) {
      if (mounted.current && current === request.current) setLoadError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, sessionId, branchId])
  const { status, error: statusError } = useSessionSummaryStatus(api, sessionId)
  const active = status.state === 'preparing' || status.state === 'ready'
  useEffect(() => { void refresh() }, [refresh, status.taskId, status.state, status.summaryEntryId])

  async function saveSummary() {
    if (!edit) return
    setSavingSummary(true)
    setEditError(undefined)
    try {
      await api.agentSessions.updateSummary({ agentSessionId: sessionId, branchId, expectedSummaryId: edit.id,
        expectedEntryCount: edit.entryCount, content: edit.content })
      if (!mounted.current) return
      setEdit(undefined)
      await refresh()
      await onSaved?.(sessionId)
    } catch (cause) { if (mounted.current) setEditError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) setSavingSummary(false) }
  }
  function changePolicy(next: Policy) {
    dirtyRef.current = true
    setDirty(true)
    setSaved(false)
    setDraft(next)
  }
  async function act(action: 'save' | 'summarize' | 'cancel') {
    setBusy(action)
    setError(undefined)
    try {
      if (action === 'save' && draft) {
        await api.agentSessions.update({ agentSessionId: sessionId, summaryPolicy: draft })
        if (!mounted.current) return
        dirtyRef.current = false
        setDirty(false)
        setSaved(true)
      } else if (action === 'summarize') {
        await api.agentSessions.summarize({ agentSessionId: sessionId, branchId })
      } else if (action === 'cancel') {
        await api.agentSessions.cancelSummary(sessionId)
      }
      if (mounted.current) await refresh()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mounted.current) setBusy(undefined)
    }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    void act('save')
  }
  const summary = memory?.summary?.entry.kind === 'work-summary' ? memory.summary.entry : undefined
  return <section className={styles.panel} aria-label="会话摘要">
    <header className={styles.header}>
      {navigation ?? <h3>会话摘要</h3>}
      <div className={styles.actions}>
        <Button size="small" variant="ghost" disabled={!!busy} onClick={() => void refresh()} title="刷新摘要" aria-label="刷新摘要"><RefreshCw size={15} /></Button>
        <Button size="small" variant="ghost" disabled={!memory} onClick={() => setSettingsOpen(true)} title="总结设置" aria-label="总结设置"><Settings2 size={16} /></Button>
        {active || busy === 'summarize'
          ? <Button size="small" disabled={busy === 'cancel' || busy === 'save'} onClick={() => void act('cancel')}><X size={14} />取消总结</Button>
          : <Button size="small" disabled={!memory || !!busy} onClick={() => void act('summarize')}><Sparkles size={14} />立即总结</Button>}
      </div>
    </header>
    <div className={styles.body}>
      <div className={styles.bodyContent}>
      {(error || loadError || statusError || status.error) && <p className={styles.error} role="alert">{error || loadError || statusError || status.error}</p>}
      {!memory && !loadError && <div className={styles.empty} role="status"><p>正在加载摘要…</p></div>}
      {memory && (summary ? <article className={styles.summary}>
        <div className={styles.coverageDetails}>
            <span>已总结至 #{memory.coverage.messages.retired}{memory.coverage.messages.total > memory.coverage.messages.retired ? ` · 原文保留 #${memory.coverage.messages.retired + 1}–#${memory.coverage.messages.total}` : ''} · 更新于 {new Date(memory.summary!.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <InfoDialog title="覆盖详情">
        <div className={styles.coverage} aria-label="上下文覆盖范围">
          <p role="status">{active || status.state === 'failed' ? statusLabels[status.state] : memory.policy.enabled ? '自动总结已开启' : '手动总结'}</p>
          <p><strong>摘要替代区</strong> · {memory.coverage.messages.retired ? `本会话消息 #1–#${memory.coverage.messages.retired} 的原文已不再注入` : '尚未替代会话消息'}。历史仍可查看。</p>
          <p><strong>原文缓冲区</strong> · {memory.coverage.messages.source > memory.coverage.messages.retired
            ? `消息 #${memory.coverage.messages.retired + 1}–#${memory.coverage.messages.source} 仍保留原文`
            : '此次交接没有保留缓冲消息'}。</p>
          {memory.coverage.messages.total > memory.coverage.messages.source && <p><strong>交接后新增</strong> · 消息 #{memory.coverage.messages.source + 1}–#{memory.coverage.messages.total}，继续保留原文。</p>}
          <p>以上为当前会话的消息编号，不是剧情 Timeline 楼层；工具记录随所属工作段一起处理。</p>
        </div>
          </InfoDialog>
        </div>
        <LongTextEditor key={memory.summary!.id} label="会话摘要" hideLabel headerExtra={<SummaryTokenCount text={summary.content} sessionId={sessionId} maxTokens={memory.policy.maxTokens} />} value={summary.content} disabled={active || !!busy}
          mode="preview" onModeChange={() => {
            if (active || busy) return
            setEditError(undefined)
            setEdit({ id: memory.summary!.id, entryCount: memory.session.entryCount, original: summary.content, content: summary.content })
          }} onChange={() => {}} onCommit={() => {}}
          previewModeLabel="预览" sourceModeLabel="编辑摘要" previewEmptyLabel="摘要为空" disableCodeWrapLabel="关闭换行" enableCodeWrapLabel="自动换行"
          clearLabel="清空" clearedLabel="已清空" copiedLabel="已复制" copyFailedLabel="复制失败" copyLabel="复制全文"
          restoreInitialLabel="恢复初始内容" undoEditLabel="撤销编辑" undoLabel="撤销" minHeight={360} />
        {summary.boundary && <footer className={styles.boundary}>记录 {summary.boundary.retiredThroughSequence} 之后的工作保留完整上下文；交接状态更新至记录 {summary.boundary.sourceThroughSequence}。原始记录仍可追溯。</footer>}
      </article> : <div className={styles.empty}>
        <BookOpen size={32} strokeWidth={1.4} />
        <h3>{active ? '正在整理会话记忆' : '当前还没有运行摘要'}</h3>
        <p>{active ? '完成后会在安全的交接时机采用，原始记录继续保留。' : '摘要帮助这个会话延续自己的工作。达到条件后自动整理，也可以随时手动开始。'}</p>
        <span>共同安排与长期线索保存在共享工作区。</span>
      </div>)}
      </div>
    </div>
    <Dialog open={!!edit} title="编辑会话摘要" description="修改仅保存在草稿中，点击保存后才用于后续请求。保存会改变上下文，可能降低提示词缓存命中率，建议集中修改后保存。"
      onClose={() => { if (!savingSummary && edit?.content === edit?.original) setEdit(undefined) }}
      dismissible={!savingSummary && edit?.content === edit?.original}
      actions={<><Button variant="secondary" disabled={savingSummary} onClick={() => setEdit(undefined)}>{edit?.content !== edit?.original ? '放弃修改' : '取消'}</Button>
        <Button disabled={savingSummary || active || !edit?.content.trim() || edit.content === edit.original} onClick={() => void saveSummary()}>{savingSummary ? '正在保存…' : '保存摘要'}</Button></>}>
      {edit && <LongTextEditor key={edit.id} sourceOnly mode="source" label="摘要内容" headerExtra={<SummaryTokenCount text={edit.content} sessionId={sessionId} maxTokens={memory?.policy.maxTokens} />} value={edit.content} disabled={savingSummary}
        onChange={content => setEdit(value => value && { ...value, content })} onCommit={content => setEdit(value => value && { ...value, content })}
        clearLabel="清空" clearedLabel="已清空" copiedLabel="已复制" copyFailedLabel="复制失败" copyLabel="复制全文"
        restoreInitialLabel="恢复初始内容" undoEditLabel="撤销编辑" undoLabel="撤销" minHeight={360} />}
      <p className={styles.hint}>摘要上限：{memory?.policy.maxTokens} Token。修订保留原有总结范围，不会压缩新的会话记录。</p>
      {editError && <p className={styles.error} role="alert">{editError}</p>}
    </Dialog>
    <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} dismissible={busy !== 'save'} closeOnBackdrop title="总结设置"
      description="仅应用于当前会话。关闭自动总结不会清除已有摘要。"
      actions={<><Button variant="secondary" disabled={busy === 'save'} onClick={() => setSettingsOpen(false)}>关闭</Button><Button type="submit" form={formId} disabled={!dirty || !!busy}>{busy === 'save' ? '正在保存…' : dirty ? '保存设置' : '已保存'}</Button></>}>
      {draft && <form id={formId} onSubmit={save} className={styles.settings}>
        <fieldset disabled={busy === 'save'}>
          <div className={styles.option}><Checkbox label="自动总结" checked={draft.enabled} onChange={event => changePolicy({ ...draft, enabled: event.target.checked })} /><p>在下一次输入时检查已完成的工作；正式剧情输入按 Narrative 正文楼层触发；Session 上下文达到 Token 阈值也会触发，不要求正文达到指定楼层。</p></div>
          <div className={styles.fields}>{fields.map(field => <label key={field.key}>
            <span>{field.label}</span>
            <input data-loom-ui-text-input="" type="number" min={field.key === 'triggerTokens' ? draft.maxTokens + 1 : field.min} max={field.key === 'bufferFloors' ? draft.triggerFloors - 1 : undefined} step={1} required value={Number.isNaN(draft[field.key]) ? '' : draft[field.key]}
              disabled={!memory?.session.timelineId && (field.key === 'bufferFloors' || field.key === 'triggerFloors')}
              onChange={event => changePolicy({ ...draft, [field.key]: event.target.valueAsNumber })} />
          </label>)}</div>
          <p className={styles.hint}>{memory?.session.timelineId ? '楼层仅指 Narrative 正文。缓冲 8 楼会从这 8 楼对应的最早 Session Run 开始，完整保留此后的消息与工具记录。缓冲为 0 时不保留额外工作段；缓冲须少于触发楼层。' : '独立会话使用 Token 阈值，楼层选项不参与触发。'} 触发 Token 数须大于摘要上限。</p>
          <div className={styles.option}><Checkbox label="异步整理，不阻塞下一次写作" checked={draft.asynchronous} onChange={event => changePolicy({ ...draft, asynchronous: event.target.checked })} /><p>后台整理完毕后，在安全时机采用；期间新增的工作保留完整上下文。手动“立即总结”直接整理并尝试采用。</p></div>
        </fieldset>
        {(error || saved) && <p role={error ? 'alert' : 'status'} className={error ? styles.error : styles.hint}>{error || '设置已保存。'}</p>}
      </form>}
    </Dialog>
  </section>
}

function SummaryTokenCount(props: { text: string; sessionId: string; maxTokens?: number }) {
  const result = useTokenCounts([props.text], `session-summary:${props.sessionId}`)
  const count = result.currentCounts[0]
  const exceeded = count !== undefined && props.maxTokens !== undefined && count > props.maxTokens
  return <span className={styles.tokenCount} data-exceeded={exceeded} role="status"
    title="o200k_base · 与摘要保存上限使用相同计数口径，不应用显示倍率">
    {result.error ? 'Token 计数失败' : `${count?.toLocaleString() ?? '…'} / ${props.maxTokens?.toLocaleString() ?? '…'} Tokens${result.pending ? ' · 计算中' : ''}${exceeded ? ' · 超出上限' : ''}`}
  </span>
}
