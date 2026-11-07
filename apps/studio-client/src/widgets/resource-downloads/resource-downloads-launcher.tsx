import { PresetPackageUpdateDialog } from '../../features/resource-updates/ui/preset-package-update-dialog.js'
import { CardPackageUpdateDialog } from '../../features/resource-updates/ui/card-package-update-dialog.js'
import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import { Download } from 'lucide-react'
import type { StudioApi } from '../../shared/api/studio-api.js'
import type { ResourceKind, ResourceDownloadTask } from '../../../../studio-server/src/resource-downloads/types.js'
import { ResourceDownloadsDialog } from './resource-downloads-dialog.js'

type UsePreview = Awaited<ReturnType<StudioApi['resourceDownloads']['previewUse']>>

export function ResourceDownloadsLauncher(props: {
  api: StudioApi['resourceDownloads']
  kind: ResourceKind
  onChanged?(): void | Promise<unknown>
  onOpenLogs?(taskId: string): void
  initiallyOpen?: boolean
  compact?: boolean
  cardId?: string
  promptResourceApi?: StudioApi['promptResources']
}) {
  const [presetUpdate, setPresetUpdate] = useState<{ taskId: string; resourceId: string }>()
  const [presetTargets, setPresetTargets] = useState<Array<{ id: string; label: string }>>()
  const [presetTarget, setPresetTarget] = useState('')
  const [cardUpdate, setCardUpdate] = useState<string>()
  const [open, setOpen] = useState(props.initiallyOpen ?? false)
  const [prepared, setPrepared] = useState<{ task: ResourceDownloadTask; preview: UsePreview }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const committing = useRef(false)
  const visible = useRef(open)
  visible.current = open
  useEffect(() => () => { visible.current = false }, [])
  useEffect(() => { if (props.initiallyOpen) setOpen(true) }, [props.initiallyOpen])
  async function previewUse(task: ResourceDownloadTask) {
    if (task.dependencyTarget === 'card' && !props.cardId) throw new Error('这是角色私有依赖，请到目标角色的资源下载面板继续附加。')
    const preview = await props.api.previewUse(task.id, task.dependencyTarget === 'card' ? props.cardId : undefined)
    if (visible.current) { setError(''); setPresetTargets(undefined); setPresetTarget(''); setPrepared({ task, preview }) }
  }
  async function choosePresetTarget() {
    if (!props.promptResourceApi || busy) return
    setBusy(true); setError('')
    try {
      const result = await props.promptResourceApi.list('preset')
      if (!visible.current) return
      const targets = result.resources.filter(resource => !resource.origin && !resource.sourceArtifactRef).map(resource => ({ id: resource.id, label: resource.rootNode.label }))
      setPresetTargets(targets); setPresetTarget(targets[0]?.id ?? '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function reprepare() {
    if (!prepared || busy) return
    setBusy(true)
    try { await previewUse(prepared.task) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  async function commitUse() {
    if (!prepared || committing.current) return
    committing.current = true; setBusy(true); setError('')
    try {
      const result = await props.api.commitUse(prepared.task.id, prepared.preview.token)
      setPrepared(undefined); setMessage(result.message); setRevision(value => value + 1)
      try { await props.onChanged?.() }
      catch (cause) { setMessage(`${result.message}；列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { committing.current = false; setBusy(false) }
  }
  return <>
    <Button variant="ghost" size="small" title="资源下载与更新" aria-label="资源下载与更新" onClick={() => setOpen(true)}><Download size={15} />{!props.compact && '下载与更新'}</Button>
    <ResourceDownloadsDialog key={revision} open={open} onClose={() => setOpen(false)} api={props.api} kind={props.kind} onUseTask={previewUse} onOpenLogs={props.onOpenLogs} />
    {prepared && <Dialog open title={prepared.task.dependencyTarget === 'card' ? '确认附加角色依赖' : prepared.preview.kind === 'extension' ? '确认安装扩展文件' : '确认导入资源'} dismissible={!busy} onClose={() => setPrepared(undefined)} actions={<>
      <Button variant="ghost" disabled={busy} onClick={() => setPrepared(undefined)}>取消</Button>
      {error && <Button disabled={busy} onClick={() => void reprepare()}>重新准备</Button>}
      <Button disabled={busy || !!error} onClick={() => void commitUse()}>{busy ? '正在处理…' : prepared.task.dependencyTarget === 'card' ? '附加到当前角色' : prepared.task.kind === 'extension' ? '确认安装' : '导入新副本'}</Button>
    </>}>
      <p><strong>{prepared.preview.name}</strong>{prepared.preview.version ? ` · ${prepared.preview.version}` : ''}</p>
      <p>{prepared.preview.action}</p>
      {prepared.task.kind === 'card' && props.cardId && <Button disabled={busy} onClick={() => { setCardUpdate(prepared.task.id); setPrepared(undefined) }}>改为更新当前角色</Button>}
      {prepared.task.kind === 'preset' && props.promptResourceApi && <>
        {presetTargets === undefined ? <Button disabled={busy} onClick={() => void choosePresetTarget()}>选择已有个人预设更新</Button> : presetTargets.length ? <div>
          <label>目标预设 <select aria-label="要更新的个人预设" disabled={busy} value={presetTarget} onChange={event => setPresetTarget(event.target.value)}>{presetTargets.map(target => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
          <Button disabled={busy || !presetTarget} onClick={() => { setPresetUpdate({ taskId: prepared.task.id, resourceId: presetTarget }); setPrepared(undefined) }}>比较并更新此预设</Button>
          <p>仅能更新来自同一作品包的个人预设。下一步会核对来源并比较内容。</p>
        </div> : <p>没有可选择的个人预设，可以导入为新副本。</p>}
      </>}
      {prepared.preview.packages.length > 0 && <ul>{prepared.preview.packages.map(item => <li key={item.packageId}>{item.displayName} · {item.version}{item.replacing ? ' · 替换已安装代码' : ''}</li>)}</ul>}
      <p>此次操作不会自动授予新增权限。扩展的启用与已有资源内容更新仍需分别处理。</p>
      {error && <p role="alert">{error}</p>}
    </Dialog>}
    {cardUpdate && props.cardId && <CardPackageUpdateDialog api={props.api} taskId={cardUpdate} cardId={props.cardId} onClose={() => setCardUpdate(undefined)} onApplied={async () => { await props.onChanged?.(); setRevision(value => value + 1) }}
      onSaveCopy={props.promptResourceApi ? async input => { const result = await props.promptResourceApi!.duplicate(input); return { id: result.resource.id, label: result.resource.rootNode.label } } : undefined} />}
    {presetUpdate && <PresetPackageUpdateDialog api={props.api} taskId={presetUpdate.taskId} resourceId={presetUpdate.resourceId}
      onClose={() => setPresetUpdate(undefined)} onApplied={async () => { await props.onChanged?.(); setRevision(value => value + 1) }}
      onSaveCopy={props.promptResourceApi ? async input => { const result = await props.promptResourceApi!.duplicate(input); return { id: result.resource.id, label: result.resource.rootNode.label } } : undefined} />}
    {!!message && <Dialog open title="操作结果" onClose={() => setMessage('')} actions={<Button onClick={() => setMessage('')}>知道了</Button>}><p role="status">{message}</p></Dialog>}
  </>
}
