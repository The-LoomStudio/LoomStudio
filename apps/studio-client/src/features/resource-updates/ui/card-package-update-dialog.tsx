import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { JsonValue } from '@loom-studio/shared'
import type { PromptResourceArtifact } from '../../../entities/workspace.js'
import { ResourceUpdateReview, type Resolution, type ResourceCopyResult, type ReviewItem } from './resource-update-review.js'
import { formatPromptResourceForReview } from './prompt-resource-review-text.js'
import type { ResourceCopyInput } from './package-resource-review-dialog.js'
import styles from './package-resource-review-dialog.module.scss'

export type CardPackageUpdatePreview = {
  cardId: string
  expectedVersion: number
  artifactId: string
  fingerprint: string
  items: Array<{
    sourceId: string
    resourceId?: string
    localVersion?: number
    kind: string
    name: string
    action: 'add' | 'update' | 'remove' | 'unchanged'
    local?: PromptResourceArtifact
    incoming?: PromptResourceArtifact
  }>
  cardFields: Array<{ field: string; local: JsonValue; incoming: JsonValue }>
  attachmentChanges?: Array<{ kind: 'script' | 'payload' | 'extension'; id: string; name: string; action: 'add' | 'update' | 'remove'; addedCapabilities?: string[]; addedContributions?: string[]; addedRequirements?: string[]; requiresAdoption?: boolean }>
  blockingChanges: string[]
}
export type CardPackageUpdateApi = {
  previewCardUpdate(input: { id: string; cardId: string }): Promise<CardPackageUpdatePreview>
  applyCardUpdate(input: {
    id: string
    cardId: string
    expectedVersion: number
    expectedFingerprint: string
    keepPromptResourceIds?: string[]
    keepCardFields?: string[]
    keepMedia?: boolean
  }): Promise<{ warning?: string }>
}
const cardFieldNames: Record<string, string> = {
  name: '角色名称', userName: '玩家称呼', description: '角色描述', media: '媒体引用',
  opening: '开场', openings: '开场', tags: '标签', creatorNotes: '作者说明',
}
function fieldText(value: JsonValue): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }

export function CardPackageUpdateDialog(props: {
  api: CardPackageUpdateApi
  taskId: string
  cardId: string
  onClose(): void
  onApplied(): void | Promise<unknown>
  onSaveCopy?(input: ResourceCopyInput): Promise<ResourceCopyResult>
  onOpenCopy?(copy: ResourceCopyResult): void
}) {
  const [preview, setPreview] = useState<CardPackageUpdatePreview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [keepMedia, setKeepMedia] = useState(false)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [applied, setApplied] = useState(false)
  const [warning, setWarning] = useState('')
  const committing = useRef(false)
  useEffect(() => {
    let active = true
    setPreview(undefined); setError(''); setResolutions({}); setQuery(''); setApplied(false); setWarning(''); setKeepMedia(false)
    void props.api.previewCardUpdate({ id: props.taskId, cardId: props.cardId }).then(value => {
      if (!active) return
      setPreview(value)
      const first = value.items[0]
      setSelected(first ? `resource:${first.sourceId}` : value.cardFields[0] ? `field:${value.cardFields[0].field}` : '')
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [props.api, props.taskId, props.cardId, revision])
  const items: ReviewItem[] = [
    ...(preview?.items ?? []).map(item => ({
      id: `resource:${item.sourceId}`, kind: item.kind === 'lore' ? 'Lore' : '预设', title: item.name,
      local: formatPromptResourceForReview(item.local), incoming: formatPromptResourceForReview(item.incoming),
      ...(item.resourceId && item.local && item.localVersion !== undefined ? { copyResourceId: item.resourceId, copyResourceTitle: item.local.rootNode.label } : {}),
    })),
    ...(preview?.cardFields ?? []).map(item => ({ id: `field:${item.field}`, kind: '角色信息', title: cardFieldNames[item.field] ?? item.field, local: fieldText(item.local), incoming: fieldText(item.incoming) })),
  ]
  const unresolved = items.filter(item => item.local !== null && item.local !== item.incoming && !resolutions[item.id]).length
  async function saveCopy(resourceId: string, name: string): Promise<ResourceCopyResult> {
    const source = preview?.items.find(item => item.resourceId === resourceId)
    if (!props.onSaveCopy || source?.localVersion === undefined) throw new Error('当前资源无法另存副本，请重新读取差异')
    setCopyBusy(true)
    try { return await props.onSaveCopy({ resourceId, name, expectedVersion: source.localVersion }) }
    finally { setCopyBusy(false) }
  }
  async function refreshAfterApplied(close = true) {
    setBusy(true); setError('')
    try { await props.onApplied(); if (close) props.onClose() }
    catch (cause) { setError(`角色已更新，但列表刷新失败：${cause instanceof Error ? cause.message : String(cause)}`) }
    finally { setBusy(false) }
  }
  async function apply() {
    if (!preview || preview.blockingChanges.length || unresolved || copyBusy || committing.current) return
    committing.current = true; setBusy(true); setError('')
    try {
      const result = await props.api.applyCardUpdate({
        id: props.taskId, cardId: props.cardId, expectedVersion: preview.expectedVersion, expectedFingerprint: preview.fingerprint,
        keepPromptResourceIds: preview.items.filter(item => item.resourceId && resolutions[`resource:${item.sourceId}`]?.choice === 'local').map(item => item.resourceId!),
        keepCardFields: preview.cardFields.filter(item => resolutions[`field:${item.field}`]?.choice === 'local').map(item => item.field),
        keepMedia,
      })
      setApplied(true); setWarning(result.warning ?? '')
      await refreshAfterApplied(!result.warning)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { committing.current = false; setBusy(false) }
  }
  return <Dialog open title="更新当前角色包" layout="workbench" className={styles.dialog} dismissible={!busy && !copyBusy} onClose={props.onClose} actions={<>
    <span className={styles.result}>{applied ? '角色文字与资源内容已保存' : unresolved ? `${unresolved} 项内容待选择` : '选择只用于本次更新'}</span>
    <Button variant="ghost" disabled={busy || copyBusy} onClick={props.onClose}>{applied ? '关闭' : '取消更新'}</Button>
    {!applied && !!unresolved && <Button variant="secondary" disabled={busy || copyBusy} onClick={() => setResolutions(Object.fromEntries(items.map(item => [item.id, { choice: 'incoming' as const }])))}>全部采用新版</Button>}
    {applied ? error ? <Button disabled={busy} onClick={() => void refreshAfterApplied(!warning)}>重新读取列表</Button> : null : <Button disabled={busy || copyBusy || !preview || unresolved > 0 || !!preview.blockingChanges.length} onClick={() => void apply()}>{busy ? '正在更新…' : '完成更新'}</Button>}
  </>}>
    <div className={styles.body}>
      <div className={styles.header}>角色文字、Lore、预设与宏从下一次 Agent Run 生效，不改写现有故事、分支与 State。脚本声明变化需要单独采用或授权。</div>
      {error && <div className={styles.error} role="alert"><span>{error}</span>{!applied && <Button disabled={busy || copyBusy} onClick={() => setRevision(value => value + 1)}>重新读取差异</Button>}</div>}
      {warning && <p className={styles.error} role="status">{warning}</p>}
      {!!preview?.blockingChanges.length && <div className={styles.error} role="alert"><div><strong>本次更新包含尚不支持的变化</strong><ul>{preview.blockingChanges.map((change, index) => <li key={index}>{change}</li>)}</ul><p>现有角色不会被修改，可以取消后另行导入副本。</p></div></div>}
      {!preview && !error && <p role="status">正在比较下载包与当前角色…</p>}
      {preview && !applied && <div className={styles.summary}><label><input type="checkbox" checked={keepMedia} disabled={busy || copyBusy} onChange={event => setKeepMedia(event.currentTarget.checked)} />保留当前头像和背景</label><p>未勾选时采用包内提供的媒体，不进行图片或音频对比。</p></div>}
      {!!preview?.attachmentChanges?.length && <details className={styles.summary}>
        <summary>脚本、扩展与载荷变化 · {preview.attachmentChanges.length}</summary>
        <ul>{preview.attachmentChanges.map(change => <li key={`${change.kind}/${change.id}`}>
          <strong>{change.name}</strong> · {change.kind === 'extension' ? '内嵌扩展归档' : change.kind === 'script' ? '脚本' : '扩展载荷'} · {change.action === 'add' ? '新增' : change.action === 'remove' ? '移除' : '更新'}
          {!!change.addedCapabilities?.length && <p>新增能力：{change.addedCapabilities.join('、')}</p>}
          {!!change.addedRequirements?.length && <p>新增依赖：{change.addedRequirements.join('、')}</p>}
          {!!change.addedContributions?.length && <p>新增声明：{change.addedContributions.join('、')}</p>}
          {change.requiresAdoption && <p>{change.kind === 'extension' ? '归档更新后，请前往角色扩展面板继续安装或更新；当前运行版本不变。' : change.kind === 'script' ? '更新后前往脚本面板显式采用，未自动授予新增权限。' : '更新后前往扩展面板处理采用和授权，未自动启用。'}</p>}
        </li>)}</ul>
      </details>}
      {preview && !applied && !!items.length && <div className={styles.review}><ResourceUpdateReview items={items} selected={selected || items[0]!.id} onSelect={setSelected} resolutions={resolutions} onResolve={(id, value) => setResolutions(current => ({ ...current, [id]: value }))} query={query} onQuery={setQuery} busy={busy} onSaveCopy={props.onSaveCopy ? saveCopy : undefined} onOpenCopy={props.onOpenCopy} /></div>}
      {preview && !items.length && !applied && <p>没有需要比较的内容，可确认这次更新。</p>}
      {applied && <p role="status">角色文字与资源内容已保存。已另存的个人副本继续保留，不会重复执行更新。</p>}
    </div>
  </Dialog>
}
