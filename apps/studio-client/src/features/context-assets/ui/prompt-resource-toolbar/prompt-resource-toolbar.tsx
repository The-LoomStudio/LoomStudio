import { Archive, Copy, Download, Link2, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ListExtensionInstallationsResult, PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { Dialog } from '@loom-studio/ui'
import { formatEntityReference } from '@loom-studio/shared'
import { buildStudioTargetLink } from '../../../../shared/studio-shell/studio-target.js'
import { tryWriteClipboardText } from '../../../../shared/browser/clipboard.js'
import styles from './prompt-resource-toolbar.module.scss'
import { ResourceBindings, type ResourceBindingsSource } from './resource-bindings.js'

type PromptResourceToolbarProps = {
  resourceBindings?: ResourceBindingsSource
  bindingResources?: PromptResource[]
  extensionInstallations?: ListExtensionInstallationsResult['installations']
  hideSelect?: boolean
  resourceKind: PromptResource['resourceKind']
  resources: PromptResource[]
  selectedResourceId?: string
  draftResourceIds: string[]
  onDiscardDraft(resourceId: string): void
  onRetryDraft(resourceId: string): Promise<void>
  t: Translator
  onCreate(resourceKind: PromptResource['resourceKind']): Promise<string | undefined>
  onDelete(resourceId: string): Promise<void>
  onDuplicate(resourceId: string): Promise<string | undefined>
  onExport(resourceId: string): Promise<void>
  onExportZip?: (resourceId: string) => Promise<void>
  onImport(file: File): Promise<string | undefined>
  onImportZip?: (file: File) => Promise<string | undefined>
  onSelect(resourceId: string): void
  onBindResources?(): void
}

export function PromptResourceToolbar(props: PromptResourceToolbarProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const [pendingDelete, setPendingDelete] = useState<PromptResource>()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string>()
  const [savingDraft, setSavingDraft] = useState(false)
  const [copiedResourceId, setCopiedResourceId] = useState<string>()
  const selected = props.resources.find(resource => resource.id === props.selectedResourceId)
  const origin = selected?.origin
  const installation = origin?.kind === 'extension-package'
    ? props.extensionInstallations?.find(item => item.id === origin.installationId && item.packageId === origin.packageId)
    : undefined

  const selectResult = async (action: Promise<string | undefined>) => {
    setError(undefined)
    try {
      const resourceId = await action
      if (resourceId && mountedRef.current) props.onSelect(resourceId)
    } catch (caught) {
      reportError(caught)
    }
  }
  const reportError = (caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught))

  return (
    <div className={styles.toolbar}>
      {origin?.kind === 'extension-package' ? (
        <span className={styles.origin} title={origin.contributionId}>
          {origin.packageId} · {origin.packageVersion} · {
            installation?.target.kind === 'card'
              ? props.t('promptResource.cardInstallation', { id: installation.target.cardId })
              : installation?.target.kind === 'global' || !origin.installationId
                ? props.t('promptResource.globalInstallation')
                : props.t('promptResource.unresolvedInstallation')
          }
        </span>
      ) : null}
      {selected && props.resourceBindings ? (
        <ResourceBindings
          key={JSON.stringify([props.resourceBindings.endpoint, selected.id])}
          {...props.resourceBindings}
          resourceId={selected.id}
          resources={props.bindingResources ?? props.resources}
          t={props.t}
        />
      ) : null}
      {error && !pendingDelete ? <p role="alert">{error}</p> : null}
      {!props.hideSelect ? (
        <select
          aria-label={props.t('promptResource.select')}
          className={styles.select}
          value={selected?.id ?? ''}
          onChange={event => props.onSelect(event.target.value)}
        >
          {props.resources.length === 0 ? <option value="">{props.t('promptResource.empty')}</option> : null}
          {props.resources.map(resource => (
            <option key={resource.id} value={resource.id}>
              {resource.rootNode.label}{resource.origin?.kind === 'builtin' ? ` · ${props.t('promptResource.official')}` : ''}
            </option>
          ))}
        </select>
      ) : null}
      <div className={styles.actions}>
        <button type="button" disabled={!selected}
          title={props.t('navigation.copyResourceLink')} aria-label={props.t('navigation.copyResourceLink')}
          onClick={() => {
            if (!selected) return
            const uri = formatEntityReference({ kind: 'entity', type: 'resource', id: selected.id })
            void tryWriteClipboardText(new URL(buildStudioTargetLink(uri), window.location.origin).href).then(copied => {
              if (!mountedRef.current) return
              if (copied) { setCopiedResourceId(selected.id); setError(undefined) }
              else setError(props.t('navigation.copyFailed'))
            })
          }}><Link2 aria-hidden="true" /></button>
        {selected && copiedResourceId === selected.id ? <span role="status">{props.t('navigation.linkCopied')}</span> : null}
        {selected && props.draftResourceIds.includes(selected.id) ? (
          <>
          <button
            aria-label={props.t('context.retryDraft')}
            title={props.t('context.retryDraft')}
            disabled={savingDraft}
            type="button"
            onClick={() => {
              setSavingDraft(true)
              setError(undefined)
              void props.onRetryDraft(selected.id).catch(reportError).finally(() => setSavingDraft(false))
            }}
          >
            <Save aria-hidden="true" />
          </button>
          <button
            aria-label={props.t('context.discardDraft')}
            title={props.t('context.discardDraft')}
            type="button"
            disabled={savingDraft}
            onClick={() => {
              if (window.confirm(props.t('context.discardDraftConfirm'))) props.onDiscardDraft(selected.id)
            }}
          >
            <RotateCcw aria-hidden="true" />
          </button>
          </>
        ) : null}
        <button
          aria-label={props.t('promptResource.create')}
          title={props.t('promptResource.create')}
          type="button"
          onClick={() => void selectResult(props.onCreate(props.resourceKind))}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('promptResource.duplicate')}
          disabled={!selected}
          title={props.t('promptResource.duplicate')}
          type="button"
          onClick={() => selected && void selectResult(props.onDuplicate(selected.id))}
        >
          <Copy aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('promptResource.import')}
          title={props.t('promptResource.import')}
          type="button"
          onClick={() => importInputRef.current?.click()}
        >
          <Upload aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('promptResource.export')}
          disabled={!selected}
          title={props.t('promptResource.export')}
          type="button"
          onClick={() => selected && void props.onExport(selected.id).then(() => setError(undefined)).catch(reportError)}
        >
          <Download aria-hidden="true" />
        </button>
        {props.onExportZip ? (
          <button
            aria-label={`${props.t('promptResource.export')} ZIP`}
            disabled={!selected}
            title={`${props.t('promptResource.export')} ZIP`}
            type="button"
            onClick={() => selected && void props.onExportZip?.(selected.id).then(() => setError(undefined)).catch(reportError)}
          >
            <Archive aria-hidden="true" />
          </button>
        ) : null}
        {props.onBindResources ? (
          <button
            aria-label={props.t('context.cardBindings.action')}
            title={props.t('context.cardBindings.action')}
            type="button"
            onClick={props.onBindResources}
          >
            <Link2 aria-hidden="true" />
          </button>
        ) : null}
        <button
          aria-label={props.t('promptResource.delete')}
          disabled={!selected || selected.origin?.kind === 'builtin'}
          title={props.t(selected?.origin?.kind === 'builtin' ? 'promptResource.builtinReadOnly' : 'promptResource.delete')}
          type="button"
          onClick={() => {
            setError(undefined)
            if (selected) setPendingDelete(selected)
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <input
        ref={importInputRef}
        accept="application/json,.json,application/zip,.zip"
        className={styles.fileInput}
        type="file"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void selectResult(file.name.toLowerCase().endsWith('.zip') && props.onImportZip ? props.onImportZip(file) : props.onImport(file))
        }}
      />
      <Dialog
        actions={(
          <>
            <button disabled={deleting} type="button" onClick={() => setPendingDelete(undefined)}>
              {props.t('promptResource.cancel')}
            </button>
            <button
              className={styles.deleteAction}
              disabled={deleting}
              type="button"
              onClick={() => {
                if (!pendingDelete) return
                setDeleting(true)
                setError(undefined)
                void props.onDelete(pendingDelete.id)
                  .then(() => setPendingDelete(undefined))
                  .catch(reportError)
                  .finally(() => setDeleting(false))
              }}
            >
              {props.t('promptResource.confirmDelete')}
            </button>
          </>
        )}
        closeOnBackdrop
        description={props.t('promptResource.deleteConfirmBody', { name: pendingDelete?.rootNode.label ?? '' })}
        dismissible={!deleting}
        open={Boolean(pendingDelete)}
        role="alertdialog"
        title={props.t('promptResource.deleteConfirmTitle')}
        onClose={() => setPendingDelete(undefined)}
      >
        {error ? <p role="alert">{error}</p> : null}
      </Dialog>
    </div>
  )
}
