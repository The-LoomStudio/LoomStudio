import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@loom-studio/ui'
import type { JsonValue } from '@loom-studio/shared'
import type { PromptResourceArtifact } from '../../../entities/workspace.js'
import { ResourceUpdateReview, type Resolution, type ResourceCopyResult, type ReviewItem } from './resource-update-review.js'
import { formatPromptResourceForReview } from './prompt-resource-review-text.js'
import type { ResourceCopyInput } from './package-resource-review-dialog.js'
import { t as defaultT, type Translator } from '../../../shared/i18n/index.js'
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
function getCardFieldName(field: string, t: Translator): string {
  const map: Record<string, string> = {
    name: t('character.update.fieldName'),
    userName: t('character.update.fieldUserName'),
    description: t('character.update.fieldDescription'),
    media: t('character.update.fieldMedia'),
    opening: t('character.update.fieldOpening'),
    openings: t('character.update.fieldOpening'),
    tags: t('character.update.fieldTags'),
    creatorNotes: t('character.update.fieldCreatorNotes'),
  }
  return map[field] ?? field
}
function fieldText(value: JsonValue): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) }

export function CardPackageUpdateDialog(props: {
  api: CardPackageUpdateApi
  taskId: string
  cardId: string
  t?: Translator
  onClose(): void
  onApplied(): void | Promise<unknown>
  onSaveCopy?(input: ResourceCopyInput): Promise<ResourceCopyResult>
  onOpenCopy?(copy: ResourceCopyResult): void
}) {
  const t = props.t ?? defaultT
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
      id: `resource:${item.sourceId}`, kind: item.kind === 'lore' ? t('character.update.itemLore') : t('character.update.itemPreset'), title: item.name,
      local: formatPromptResourceForReview(item.local), incoming: formatPromptResourceForReview(item.incoming),
      ...(item.resourceId && item.local && item.localVersion !== undefined ? { copyResourceId: item.resourceId, copyResourceTitle: item.local.rootNode.label } : {}),
    })),
    ...(preview?.cardFields ?? []).map(item => ({ id: `field:${item.field}`, kind: t('character.update.itemInfo'), title: getCardFieldName(item.field, t), local: fieldText(item.local), incoming: fieldText(item.incoming) })),
  ]
  const unresolved = items.filter(item => item.local !== null && item.local !== item.incoming && !resolutions[item.id]).length
  async function saveCopy(resourceId: string, name: string): Promise<ResourceCopyResult> {
    const source = preview?.items.find(item => item.resourceId === resourceId)
    if (!props.onSaveCopy || source?.localVersion === undefined) throw new Error(t('character.update.saveCopyFailed'))
    setCopyBusy(true)
    try { return await props.onSaveCopy({ resourceId, name, expectedVersion: source.localVersion }) }
    finally { setCopyBusy(false) }
  }
  async function refreshAfterApplied(close = true) {
    setBusy(true); setError('')
    try { await props.onApplied(); if (close) props.onClose() }
    catch (cause) { setError(t('character.update.refreshFailed', { message: cause instanceof Error ? cause.message : String(cause) })) }
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
  return <Dialog open title={t('character.update.dialogTitle')} layout="workbench" className={styles.dialog} dismissible={!busy && !copyBusy} onClose={props.onClose} actions={<>
    <span className={styles.result}>{applied ? t('character.update.statusSaved') : unresolved ? t('character.update.statusPending', { count: unresolved }) : t('character.update.statusOneTime')}</span>
    <Button variant="ghost" disabled={busy || copyBusy} onClick={props.onClose}>{applied ? t('character.update.close') : t('character.update.cancelUpdate')}</Button>
    {!applied && !!unresolved && <Button variant="secondary" disabled={busy || copyBusy} onClick={() => setResolutions(Object.fromEntries(items.map(item => [item.id, { choice: 'incoming' as const }])))}>{t('character.update.useAllIncoming')}</Button>}
    {applied ? error ? <Button disabled={busy} onClick={() => void refreshAfterApplied(!warning)}>{t('character.update.reloadList')}</Button> : null : <Button disabled={busy || copyBusy || !preview || unresolved > 0 || !!preview.blockingChanges.length} onClick={() => void apply()}>{busy ? t('character.update.updating') : t('character.update.applyUpdate')}</Button>}
  </>}>
    <div className={styles.body}>
      <div className={styles.header}>{t('character.update.dialogHeader')}</div>
      {error && <div className={styles.error} role="alert"><span>{error}</span>{!applied && <Button disabled={busy || copyBusy} onClick={() => setRevision(value => value + 1)}>{t('character.update.rereadDiff')}</Button>}</div>}
      {warning && <p className={styles.error} role="status">{warning}</p>}
      {!!preview?.blockingChanges.length && <div className={styles.error} role="alert"><div><strong>{t('character.update.blockingTitle')}</strong><ul>{preview.blockingChanges.map((change, index) => <li key={index}>{change}</li>)}</ul><p>{t('character.update.blockingDesc')}</p></div></div>}
      {!preview && !error && <p role="status">{t('character.update.comparing')}</p>}
      {preview && !applied && <div className={styles.summary}><label><input type="checkbox" checked={keepMedia} disabled={busy || copyBusy} onChange={event => setKeepMedia(event.currentTarget.checked)} />{t('character.update.keepMedia')}</label><p>{t('character.update.keepMediaHint')}</p></div>}
      {!!preview?.attachmentChanges?.length && <details className={styles.summary}>
        <summary>{t('character.update.attachmentSummary', { count: preview.attachmentChanges.length })}</summary>
        <ul>{preview.attachmentChanges.map(change => <li key={`${change.kind}/${change.id}`}>
          <strong>{change.name}</strong> · {change.kind === 'extension' ? t('character.update.kindExtension') : change.kind === 'script' ? t('character.update.kindScript') : t('character.update.kindPayload')} · {change.action === 'add' ? t('character.update.actionAdd') : change.action === 'remove' ? t('character.update.actionRemove') : t('character.update.actionUpdate')}
          {!!change.addedCapabilities?.length && <p>{t('character.update.addedCapabilities', { list: change.addedCapabilities.join('、') })}</p>}
          {!!change.addedRequirements?.length && <p>{t('character.update.addedRequirements', { list: change.addedRequirements.join('、') })}</p>}
          {!!change.addedContributions?.length && <p>{t('character.update.addedContributions', { list: change.addedContributions.join('、') })}</p>}
          {change.requiresAdoption && <p>{change.kind === 'extension' ? t('character.update.adoptExtension') : change.kind === 'script' ? t('character.update.adoptScript') : t('character.update.adoptPayload')}</p>}
        </li>)}</ul>
      </details>}
      {preview && !applied && !!items.length && <div className={styles.review}><ResourceUpdateReview items={items} selected={selected || items[0]!.id} onSelect={setSelected} resolutions={resolutions} onResolve={(id, value) => setResolutions(current => ({ ...current, [id]: value }))} query={query} onQuery={setQuery} busy={busy} onSaveCopy={props.onSaveCopy ? saveCopy : undefined} onOpenCopy={props.onOpenCopy} /></div>}
      {preview && !items.length && !applied && <p>{t('character.update.noChanges')}</p>}
      {applied && <p role="status">{t('character.update.savedNotice')}</p>}
    </div>
  </Dialog>
}
