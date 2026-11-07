import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { PromptResourceArtifact } from '../../../entities/workspace.js'
import { ResourceUpdateReview, type Resolution, type ResourceCopyResult, type ReviewItem } from './resource-update-review.js'
import { formatPromptResourceForReview } from './prompt-resource-review-text.js'
import styles from './package-resource-review-dialog.module.scss'

type PreviewInput = Parameters<StudioApi['extensions']['previewPackageResources']>[0]
type PreviewItem = {
  kind: string; contributionId: string; resourceId?: string; name?: string
  action: 'add' | 'update' | 'remove' | 'unchanged'
  content?: { localVersion?: number; local?: PromptResourceArtifact; incoming?: PromptResourceArtifact }
  references?: Array<{ kind: string; id: string; name?: string }>
}
export type PackageResourceReviewPreview = {
  packageId: string; packageVersion: string; expectedInstallationVersion: number; fingerprint: string
  items: PreviewItem[]; warnings: string[]
}
export type ResourceCopyInput = { resourceId: string; name: string; expectedVersion: number }
function reviewId(item: PreviewItem): string { return `${item.kind}/${item.resourceId ?? item.contributionId}` }
const actionLabels: Record<PreviewItem['action'], string> = { add: '新增', update: '更新', remove: '移除', unchanged: '不变' }

export function PackageResourceReviewDialog(props: {
  title: string
  fromVersion: string
  input: PreviewInput
  api: { previewPackageResources(input: PreviewInput): Promise<PackageResourceReviewPreview> }
  onApply(fingerprint: string, keepPromptResourceIds: string[]): Promise<unknown>
  onSaveCopy?(input: ResourceCopyInput): Promise<ResourceCopyResult>
  onOpenCopy?(result: ResourceCopyResult): void
  onClose(): void
}) {
  const [preview, setPreview] = useState<PackageResourceReviewPreview>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copyBusy, setCopyBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const committing = useRef(false)
  useEffect(() => {
    let active = true
    setPreview(undefined); setError(''); setResolutions({}); setQuery('')
    void props.api.previewPackageResources(props.input).then(value => {
      if (!active) return
      setPreview(value)
      const first = value.items.find(item => item.content)
      setSelected(first ? reviewId(first) : '')
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [props.api, props.input, revision])
  const contentItems = preview?.items.filter(item => item.content) ?? []
  const items: ReviewItem[] = contentItems.map(item => ({
    id: reviewId(item), kind: item.content?.local?.resourceKind === 'lore' || item.content?.incoming?.resourceKind === 'lore' ? 'Lore' : '预设',
    title: item.name ?? item.content?.incoming?.rootNode.label ?? item.content?.local?.rootNode.label ?? item.contributionId,
    local: formatPromptResourceForReview(item.content?.local), incoming: formatPromptResourceForReview(item.content?.incoming),
    ...(item.resourceId && item.content?.localVersion !== undefined ? { copyResourceId: item.resourceId, copyResourceTitle: item.content.local?.rootNode.label ?? item.name } : {}),
  }))
  const unresolved = items.filter(item => item.local !== null && item.local !== item.incoming && !resolutions[item.id]).length
  async function apply() {
    if (!preview || unresolved || committing.current || copyBusy) return
    committing.current = true; setBusy(true); setError('')
    const keep = contentItems.filter(item => item.resourceId && resolutions[reviewId(item)]?.choice === 'local').map(item => item.resourceId!)
    try { await props.onApply(preview.fingerprint, keep); props.onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { committing.current = false; setBusy(false) }
  }
  async function saveCopy(resourceId: string, name: string): Promise<ResourceCopyResult> {
    const source = contentItems.find(item => item.resourceId === resourceId)
    if (!props.onSaveCopy || source?.content?.localVersion === undefined) throw new Error('当前资源无法另存副本，请重新读取后再试')
    setCopyBusy(true)
    try { return await props.onSaveCopy({ resourceId, name, expectedVersion: source.content.localVersion }) }
    finally { setCopyBusy(false) }
  }
  const summaries = preview?.items.filter(item => !item.content && item.action !== 'unchanged') ?? []
  return <Dialog open title={`${props.title} · 内容更新`} layout="workbench" className={styles.dialog} dismissible={!busy && !copyBusy} onClose={props.onClose} actions={<>
    <span className={styles.result}>{unresolved ? `${unresolved} 份当前内容待选择` : '选择仅用于本次更新；新增内容默认采用'}</span>
    <Button variant="ghost" disabled={busy || copyBusy} onClick={props.onClose}>取消更新</Button>
    <Button disabled={busy || copyBusy || !preview || unresolved > 0} onClick={() => void apply()}>{busy ? '正在更新…' : '完成更新'}</Button>
  </>}>
    <div className={styles.body}>
      <div className={styles.header}><span>{props.fromVersion} → {props.input.packageVersion}</span><span>内容从下一次 Agent Run 使用，当前生成不会重新构建。</span></div>
      {error && <div className={styles.error} role="alert"><span>{error}</span><Button disabled={busy || copyBusy} onClick={() => setRevision(value => value + 1)}>重新读取差异</Button></div>}
      {!preview && !error && <p role="status">正在读取包内容与当前资源…</p>}
      {!!summaries.length && <details className={styles.summary}><summary>其他资源变化 · {summaries.length}</summary><ul>{summaries.map(item => <li key={reviewId(item)}>{item.name ?? item.contributionId} · {actionLabels[item.action]}</li>)}</ul></details>}
      {!!preview?.warnings.length && <details className={styles.summary}><summary>更新说明与限制</summary><ul>{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      {!!items.length && <div className={styles.review}><ResourceUpdateReview items={items} selected={selected || items[0]!.id} onSelect={setSelected} resolutions={resolutions} onResolve={(id, value) => setResolutions(current => ({ ...current, [id]: value }))} query={query} onQuery={setQuery} busy={busy} onSaveCopy={props.onSaveCopy ? saveCopy : undefined} onOpenCopy={props.onOpenCopy} /></div>}
      {preview && !items.length && <p>本次没有 Lore 或预设内容需要比较，可查看其他资源变化后完成更新。</p>}
    </div>
  </Dialog>
}
