import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { PromptResourceArtifact } from '../../../entities/workspace.js'
import { ResourceUpdateReview, type Resolution, type ResourceCopyResult } from './resource-update-review.js'
import { formatPromptResourceForReview } from './prompt-resource-review-text.js'
import type { ResourceCopyInput } from './package-resource-review-dialog.js'
import styles from './package-resource-review-dialog.module.scss'

export type PresetPackageUpdatePreview = {
  resourceId: string
  expectedVersion: number
  fingerprint: string
  local: PromptResourceArtifact
  incoming: PromptResourceArtifact
  blockingChanges: string[]
}
export type PresetPackageUpdateApi = {
  previewPromptUpdate(input: { id: string; resourceId: string }): Promise<PresetPackageUpdatePreview>
  applyPromptUpdate(input: { id: string; resourceId: string; expectedVersion: number; fingerprint: string; keepLocal?: boolean }): Promise<{ warning?: string }>
}

export function PresetPackageUpdateDialog(props: {
  api: PresetPackageUpdateApi
  taskId: string
  resourceId: string
  onClose(): void
  onApplied(): void | Promise<unknown>
  onSaveCopy?(input: ResourceCopyInput): Promise<ResourceCopyResult>
  onOpenCopy?(copy: ResourceCopyResult): void
}) {
  const [preview, setPreview] = useState<PresetPackageUpdatePreview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [applied, setApplied] = useState(false)
  const [warning, setWarning] = useState('')
  const committing = useRef(false)
  useEffect(() => {
    let active = true
    setPreview(undefined); setError(''); setResolutions({}); setQuery(''); setApplied(false); setWarning('')
    void props.api.previewPromptUpdate({ id: props.taskId, resourceId: props.resourceId }).then(value => {
      if (active) setPreview(value)
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [props.api, props.taskId, props.resourceId, revision])
  const item = preview ? {
    id: preview.resourceId, kind: '预设', title: preview.local.rootNode.label,
    local: formatPromptResourceForReview(preview.local), incoming: formatPromptResourceForReview(preview.incoming),
    copyResourceId: preview.resourceId, copyResourceTitle: preview.local.rootNode.label,
  } : undefined
  const unresolved = !!item && item.local !== item.incoming && !resolutions[item.id]
  async function saveCopy(resourceId: string, name: string): Promise<ResourceCopyResult> {
    if (!props.onSaveCopy || !preview) throw new Error('请重新读取当前预设后再保存副本')
    setCopyBusy(true)
    try { return await props.onSaveCopy({ resourceId, name, expectedVersion: preview.expectedVersion }) }
    finally { setCopyBusy(false) }
  }
  async function refreshAfterApplied(close: boolean) {
    setBusy(true); setError('')
    try { await props.onApplied(); if (close) props.onClose() }
    catch (cause) { setError(`预设已更新，但列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`) }
    finally { setBusy(false) }
  }
  async function apply() {
    if (!preview || preview.blockingChanges.length || unresolved || copyBusy || committing.current) return
    committing.current = true; setBusy(true); setError('')
    try {
      const result = await props.api.applyPromptUpdate({ id: props.taskId, resourceId: props.resourceId, expectedVersion: preview.expectedVersion, fingerprint: preview.fingerprint, keepLocal: resolutions[props.resourceId]?.choice === 'local' })
      setApplied(true); setWarning(result.warning ?? '')
      await refreshAfterApplied(!result.warning)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { committing.current = false; setBusy(false) }
  }
  return <Dialog open title="更新已有个人预设" layout="workbench" className={styles.dialog} dismissible={!busy && !copyBusy} onClose={props.onClose} actions={<>
    <span className={styles.result}>{applied ? '本次预设更新已完成' : unresolved ? '选择要保留的内容' : '选择仅用于本次更新'}</span>
    <Button variant="ghost" disabled={busy || copyBusy} onClick={props.onClose}>{applied ? '关闭' : '取消更新'}</Button>
    {applied ? error ? <Button disabled={busy} onClick={() => void refreshAfterApplied(!warning)}>重新读取列表</Button> : null : <Button disabled={busy || copyBusy || !preview || unresolved || !!preview.blockingChanges.length} onClick={() => void apply()}>{busy ? '正在更新…' : '完成更新'}</Button>}
  </>}>
    <div className={styles.body}>
      <div className={styles.header}>比较整份预设，包括条目顺序、正文与宏。下次 Agent Run 使用新内容，当前生成不受影响。</div>
      {error && <div className={styles.error} role="alert"><span>{error}</span>{!applied && <Button disabled={busy || copyBusy} onClick={() => setRevision(value => value + 1)}>重新读取差异</Button>}</div>}
      {warning && <p className={styles.error} role="status">{warning}</p>}
      {!!preview?.blockingChanges.length && <div className={styles.error} role="alert"><div><strong>本次更新包含尚不支持的变化</strong><ul>{preview.blockingChanges.map((change, index) => <li key={index}>{change}</li>)}</ul><p>当前预设保持原样。可以取消后选择导入新副本。</p></div></div>}
      {!preview && !error && <p role="status">正在比较下载包与当前预设…</p>}
      {item && !applied && <div className={styles.review}><ResourceUpdateReview items={[item]} selected={item.id} onSelect={() => {}} resolutions={resolutions} onResolve={(id, value) => setResolutions(current => ({ ...current, [id]: value }))} query={query} onQuery={setQuery} busy={busy} onSaveCopy={props.onSaveCopy ? saveCopy : undefined} onOpenCopy={props.onOpenCopy} /></div>}
      {applied && <p role="status">本次选择已提交。已另存的个人副本继续保留，不会重复执行更新。</p>}
    </div>
  </Dialog>
}
