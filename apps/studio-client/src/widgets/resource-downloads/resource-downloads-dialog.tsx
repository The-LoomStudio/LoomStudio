import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { Download, RefreshCw } from 'lucide-react'
import type { ResourceCandidate, ResourceDownloadTask, ResourceKind, ResourceUpdateRecord, ResourceDependency } from '../../../../studio-server/src/resource-downloads/types.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import styles from './resource-downloads-dialog.module.scss'

export type ResourceDownloadsApi = {
  resolve(input: { url: string; kind: ResourceKind; ref?: string; adapterId?: string }): Promise<{ candidates: ResourceCandidate[]; adapters?: { id: string }[] }>
  start(input: { candidateId: string }): Promise<ResourceDownloadTask>
  list(): Promise<ResourceDownloadTask[]>
  cancel(id: string): Promise<ResourceDownloadTask>
  retry(id: string): Promise<ResourceDownloadTask>
  prepareDependencies(id: string): Promise<{ dependencies: ResourceDependency[]; candidates: ResourceCandidate[]; unsupported?: string }>
  listUpdates(): Promise<ResourceUpdateRecord[]>
  checkUpdates(input?: { force?: boolean }): Promise<ResourceUpdateRecord[]>
  ignore(input: { id: string; candidateId?: string }): Promise<ResourceUpdateRecord>
  acknowledge(id: string): Promise<ResourceUpdateRecord>
  updatePolicy(input: { id: string; prerelease?: boolean; fixed?: boolean }): Promise<ResourceUpdateRecord>
}

const statusLabels: Record<ResourceDownloadTask['status'], string> = {
  queued: '等待下载', downloading: '正在下载', ready: '已暂存', failed: '下载失败', cancelled: '已取消', interrupted: '下载已中断',
}
const phaseLabels: Record<ResourceDownloadTask['phase'], string> = {
  waiting: '等待执行', fetching: '获取文件', validating: '校验资源', staged: '暂存完成', failed: '操作失败', cancelled: '已取消',
}
const updateLabels: Record<ResourceUpdateRecord['status'], string> = {
  unchecked: '尚未检查', available: '有新版本', current: '已是最新', unsupported: '来源不支持自动检查', failed: '检查失败', unavailable: '来源适配器不可用',
}
function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
function time(value: string): string { return new Date(value).toLocaleString() }

export function ResourceDownloadsDialog(props: {
  open: boolean
  onClose(): void
  api: ResourceDownloadsApi
  kind: ResourceKind
  onUseTask(task: ResourceDownloadTask): Promise<void>
  onOpenLogs?(taskId: string): void
}) {
  return <Dialog open={props.open} onClose={props.onClose} title="资源下载与更新" layout="workbench" className={styles.dialog}>
    {props.open && <ResourceDownloadsPanel api={props.api} kind={props.kind} onUseTask={props.onUseTask} onOpenLogs={props.onOpenLogs} />}
  </Dialog>
}

export function ResourceDownloadsPanel(props: {
  api: ResourceDownloadsApi
  kind: ResourceKind
  onUseTask(task: ResourceDownloadTask): Promise<void>
  onOpenLogs?(taskId: string): void
}) {
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [candidates, setCandidates] = useState<ResourceCandidate[]>([])
  const [adapters, setAdapters] = useState<Array<{ id: string }>>([])
  const [candidateId, setCandidateId] = useState('')
  const [tasks, setTasks] = useState<ResourceDownloadTask[]>([])
  const [updates, setUpdates] = useState<ResourceUpdateRecord[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pane, setPane] = useState<'master' | 'detail'>('master')
  const [tab, setTab] = useState<'tasks' | 'updates'>('tasks')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [updateLoadError, setUpdateLoadError] = useState('')
  const [message, setMessage] = useState('')
  const [dependencies, setDependencies] = useState<ResourceCandidate[]>([])
  const mounted = useRef(true)
  const operation = useRef(false)
  const resolveGeneration = useRef(0)
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const task = tasks.find(item => item.id === selectedId)
  const candidate = candidates.find(item => item.id === candidateId)

  const refreshTasks = useCallback(async () => {
    try {
      const nextTasks = await props.api.list()
      if (!mounted.current) return
      setTasks(nextTasks)
      setLoadError('')
    } catch (cause) { if (mounted.current) setLoadError(cause instanceof Error ? cause.message : String(cause)) }
  }, [props.api])
  const refreshUpdates = useCallback(async () => {
    try {
      const nextUpdates = await props.api.listUpdates()
      if (!mounted.current) return
      setUpdates(nextUpdates)
      setUpdateLoadError('')
    } catch (cause) { if (mounted.current) setUpdateLoadError(cause instanceof Error ? cause.message : String(cause)) }
  }, [props.api])
  const refresh = useCallback(async () => {
    await Promise.all([refreshTasks(), refreshUpdates()])
  }, [refreshTasks, refreshUpdates])
  useEffect(() => {
    mounted.current = true
    void refresh()
    let timer: ReturnType<typeof setTimeout>
    let stopped = false
    async function tick() {
      if (stopped) return
      if (document.visibilityState === 'visible' && tasksRef.current.some(item => item.status === 'queued' || item.status === 'downloading')) await refreshTasks()
      if (!stopped) timer = setTimeout(() => void tick(), 1200)
    }
    timer = setTimeout(() => void tick(), 1200)
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => { mounted.current = false; stopped = true; clearTimeout(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus) }
  }, [refresh, refreshTasks])
  async function run(work: () => Promise<void>) {
    if (operation.current) return
    operation.current = true; setBusy(true); setError(''); setMessage('')
    try { await work() }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { operation.current = false; if (mounted.current) setBusy(false) }
  }
  function selectTask(id: string) { setSelectedId(id); setDependencies([]); setPane('detail'); setError(''); setMessage('') }
  async function resolve(adapterId?: string) {
    const generation = ++resolveGeneration.current
    const result = await props.api.resolve({ url: url.trim(), kind: props.kind, ...(ref.trim() ? { ref: ref.trim() } : {}), ...(adapterId ? { adapterId } : {}) })
    if (!mounted.current || resolveGeneration.current !== generation) return
    setCandidates(result.candidates); setCandidateId((result.candidates.find(candidate => candidate.recommended) ?? result.candidates[0])?.id ?? ''); setAdapters(result.adapters ?? [])
    if (!result.candidates.length && !result.adapters?.length) setMessage('没有找到可下载的资源。请提供发行文件地址。')
  }
  async function start(id: string) {
    const next = await props.api.start({ candidateId: id })
    if (!mounted.current) return
    setTasks(current => [next, ...current.filter(item => item.id !== next.id)])
    selectTask(next.id); setTab('tasks')
  }
  async function taskAction(action: (id: string) => Promise<ResourceDownloadTask>, id: string) {
    const next = await action(id)
    if (mounted.current) setTasks(current => [next, ...current.filter(item => item.id !== next.id)])
  }
  async function updatePolicy(id: string, policy: { prerelease?: boolean; fixed?: boolean }) {
    const record = await props.api.updatePolicy({ id, ...policy })
    if (!mounted.current) return
    setUpdates(current => current.map(item => item.id === id ? record : item))
    setMessage('更新选项已保存；可以手动检查更新')
  }
  const available = updates.filter(item => item.kind === props.kind && item.status === 'available' && item.candidate?.id !== item.ignoredCandidate)
  return <div className={styles.panel}>
    <MasterDetailWorkbench navigationScope="local" defaultMasterWidth={300} hasSelection={tab === 'updates' || !!task} mobilePane={pane} onMobilePaneChange={setPane} backLabel="下载列表" master={<div className={styles.master}>
      <div className={styles.tabs}><Button variant={tab === 'tasks' ? 'default' : 'ghost'} onClick={() => setTab('tasks')}>下载任务</Button><Button variant={tab === 'updates' ? 'default' : 'ghost'} onClick={() => { setTab('updates'); setPane('detail') }}>更新 {available.length || ''}</Button></div>
      <form className={styles.source} onSubmit={event => { event.preventDefault(); void run(() => resolve()) }}>
        <label>资源链接<input type="url" required value={url} disabled={busy} placeholder="HTTPS 文件或仓库链接" onChange={event => { resolveGeneration.current++; setUrl(event.target.value); setCandidates([]); setAdapters([]) }} /></label>
        <details><summary>指定 Git 版本（可选）</summary><input aria-label="Git 分支、Tag 或 commit" value={ref} disabled={busy} placeholder="分支、Tag 或 commit" onChange={event => { resolveGeneration.current++; setRef(event.target.value); setCandidates([]) }} /></details>
        <Button type="submit" disabled={busy || !url.trim()}>{busy ? '正在处理…' : '识别链接'}</Button>
        {!!adapters.length && <div><p>选择处理此链接的来源</p>{adapters.map(adapter => <Button key={adapter.id} disabled={busy} onClick={() => void run(() => resolve(adapter.id))}>{adapter.id}</Button>)}</div>}
        {!!candidates.length && <><label>下载版本<select value={candidateId} disabled={busy} onChange={event => setCandidateId(event.target.value)}>{candidates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.version ?? item.revision?.slice(0, 12) ?? '文件'}{item.prerelease ? ' · 预发布' : ''}{item.recommended ? ' · 推荐' : ''}{item.dependencyTarget === 'card' ? ' · 角色私有依赖' : item.dependencyTarget === 'global' ? ' · 全局依赖' : ''}</option>)}</select></label>{candidate?.description && <p>{candidate.description}</p>}<Button disabled={busy || !candidate} onClick={() => void run(() => start(candidateId))}><Download size={14} />下载到暂存区</Button></>}
      </form>
      {loadError && <div role="alert"><p>{loadError}</p><Button disabled={busy} onClick={() => void refresh()}>重新读取</Button></div>}
      {updateLoadError && <div role="alert"><p>{updateLoadError}</p><Button disabled={busy} onClick={() => void refreshUpdates()}>重新读取更新列表</Button></div>}
      <div className={styles.taskList}>{tasks.filter(item => (item.kind === props.kind || (props.kind === 'card' && item.dependencyTarget === 'card'))).map(item => <button key={item.id} className={styles.taskRow} aria-pressed={selectedId === item.id} onClick={() => { setTab('tasks'); selectTask(item.id) }}><strong>{item.name}</strong><span>{item.version ?? '未声明版本'} · {statusLabels[item.status]}{item.dependencyTarget === 'card' ? ' · 角色私有依赖' : item.dependencyTarget === 'global' ? ' · 全局依赖' : ''}</span></button>)}{!tasks.some(item => item.kind === props.kind || (props.kind === 'card' && item.dependencyTarget === 'card')) && <p>暂无下载任务</p>}</div>
    </div>}>
      <div className={styles.detail}>
        {error && <p role="alert" className={styles.feedback}>{error}</p>}{message && <p role="status" className={styles.feedback}>{message}</p>}
        {tab === 'updates' ? <>
          <div className={styles.title}><h2>来源更新</h2><Button disabled={busy} onClick={() => void run(async () => { const result = await props.api.checkUpdates({ force: true }); if (mounted.current) setUpdates(result) })}><RefreshCw size={14} />检查更新</Button></div>
          <p>检查不会下载、覆盖或启用资源。固定版本不会自动切换。</p>
          {updates.filter(item => item.kind === props.kind).map(item => {
            const next = item.candidate
            const existing = next && tasks.find(download => download.dependencyTarget === next.dependencyTarget && (download.candidateId === next.id || (download.source.adapterId === next.source.adapterId && download.source.resourceId === next.source.resourceId && download.source.url === next.source.url && !!(next.version || next.revision) && download.version === next.version && download.revision === next.revision)) && ['ready', 'queued', 'downloading'].includes(download.status))
            return <section className={styles.update} key={item.id}>
              <h3>{item.name}</h3><p>当前 {item.installedVersion} · {item.fixed ? '固定版本' : updateLabels[item.status]}</p>
              {item.checkedAt && <small>上次检查：{time(item.checkedAt)}</small>}
              {item.error && <p role="alert">{item.error}</p>}
              <details className={styles.policy}>
                <summary>更新选项</summary>
                <label><input type="checkbox" checked={item.prerelease} disabled={busy} onChange={event => { const prerelease = event.currentTarget.checked; void run(() => updatePolicy(item.id, { prerelease })) }} />接收预发布版本</label>
                <label><input type="checkbox" checked={item.fixed} disabled={busy || item.sourcePinned} onChange={event => { const fixed = event.currentTarget.checked; void run(() => updatePolicy(item.id, { fixed })) }} />固定当前版本，暂停升级提醒</label>
                <small>{item.sourcePinned ? '此来源指定了固定 Tag 或 commit。若需其他版本，请重新选择下载来源。' : '解除固定后继续检查原来源，不会自动切换 Tag、commit 或分支。'}</small>
              </details>
              {next && item.status === 'available' && <>
                <p>可用版本 {next.version ?? '未声明'}{next.prerelease ? ' · 预发布' : ''}{existing?.status === 'ready' ? ' · 已下载，等待采用' : ''}</p>
                <div className={styles.actions}>
                  <Button disabled={busy} onClick={() => { if (existing) { setTab('tasks'); selectTask(existing.id) } else void run(() => start(next.id)) }}>{existing ? '查看下载任务' : '下载新版'}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await props.api.acknowledge(item.id); if (mounted.current) setMessage('已稍后处理，更新仍保留在列表中'); await refresh() })}>稍后</Button>
                  <Button variant="ghost" disabled={busy || item.ignoredCandidate === next.id} onClick={() => void run(async () => { await props.api.ignore({ id: item.id, candidateId: next.id }); await refresh() })}>{item.ignoredCandidate === next.id ? '已忽略此版本' : '忽略此版本'}</Button>
                </div>
              </>}
            </section>
          })}
          {!updates.some(item => item.kind === props.kind) && <p>资源成功导入或安装后，可在这里查看来源检查结果。</p>}
        </> : task ? <>
          <small>{task.kind === 'extension' ? '扩展包' : task.kind === 'card' ? '角色包' : '预设资源'}</small><h2>{task.name}</h2>{task.dependencyTarget && <p>{task.dependencyTarget === 'card' ? '角色私有依赖：需要在目标角色面板附加' : '全局扩展依赖'}</p>}<p role="status">{statusLabels[task.status]} · {phaseLabels[task.phase]}</p>
          {(task.status === 'queued' || task.status === 'downloading') && <progress aria-label="下载进度" max={task.totalBytes || undefined} value={task.totalBytes ? task.receivedBytes : undefined} />}
          <p>{bytes(task.receivedBytes)}{task.totalBytes ? ` / ${bytes(task.totalBytes)}` : ''}</p>
          <dl className={styles.metadata}><dt>来源</dt><dd>{task.source.url}</dd>{task.version && <><dt>包版本</dt><dd>{task.version}</dd></>}<dt>开始时间</dt><dd>{time(task.createdAt)}</dd><dt>最近状态</dt><dd>{time(task.updatedAt)}</dd></dl>
          {task.error && <p role="alert">{task.error}</p>}
          <div className={styles.actions}>{(task.status === 'queued' || task.status === 'downloading') && <Button disabled={busy} onClick={() => void run(() => taskAction(id => props.api.cancel(id), task.id))}>取消下载</Button>}{['failed', 'cancelled', 'interrupted'].includes(task.status) && <Button disabled={busy} onClick={() => void run(() => taskAction(id => props.api.retry(id), task.id))}>重新下载</Button>}{task.status === 'ready' && <Button disabled={busy} onClick={() => void run(async () => { await props.onUseTask(task); await refresh() })}>{task.kind === 'extension' ? '查看安装确认' : '继续导入'}</Button>}{props.onOpenLogs && <Button variant="ghost" onClick={() => props.onOpenLogs?.(task.id)}>查看任务日志</Button>}</div>
          {task.status === 'ready' && <p>产物保存在暂存区。关闭窗口不删除产物，也不会自动安装或启用。</p>}
          {task.status === 'ready' && <section className={styles.dependencies}><h3>配套依赖</h3><ul>{task.dependencies.map((item, index) => <li key={`${item.id}:${item.target ?? ''}:${item.requestedBy ?? ''}:${index}`}>{item.id} · {item.version ?? '版本未声明'}{item.target ? ` · ${item.target === 'card' ? '当前角色' : '全局'}` : ''}{item.requestedBy ? ` · 来自 ${item.requestedBy}` : ''}{item.embedded ? ' · 包内提供，未表示已安装' : !item.source ? ' · 未声明下载来源' : ''}</li>)}</ul><Button disabled={busy} onClick={() => void run(async () => { const result = await props.api.prepareDependencies(task.id); if (mounted.current) { setDependencies(result.candidates); setTasks(current => current.map(item => item.id === task.id ? { ...item, dependencies: result.dependencies } : item)); if (result.unsupported) setMessage(result.unsupported); else if (!result.candidates.length) setMessage('没有返回新的下载候选，请核对依赖声明；这不表示依赖已经安装或启用') } })}>查看 / 准备依赖</Button>{dependencies.map(item => <div key={item.id} className={styles.dependency}><span>{item.name} · {item.version ?? '指定版本'}{item.dependencyTarget === 'card' ? ' · 角色私有依赖' : item.dependencyTarget === 'global' ? ' · 全局依赖' : ''}</span><Button disabled={busy} onClick={() => void run(() => start(item.id))}>下载</Button></div>)}</section>}
        </> : <div className={styles.empty}><Download size={26} /><h2>获取资源</h2><p>粘贴文件、仓库或发行页面链接，先选择下载内容。下载由后端执行，完成后再导入或安装。</p></div>}
      </div>
    </MasterDetailWorkbench>
  </div>
}
