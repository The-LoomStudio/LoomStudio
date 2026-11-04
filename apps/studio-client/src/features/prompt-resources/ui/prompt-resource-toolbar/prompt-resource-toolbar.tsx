import { Copy, Link2, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { Dialog } from '@loom-studio/ui'
import { notify } from '../../../../shared/notifications/index.js'
import styles from './prompt-resource-toolbar.module.scss'
import { TokenSnapshotControl, TokenSnapshotSummary } from '../resource-token-summary.js'
import type { ResourceTokenSnapshot } from '../../model/use-resource-token-snapshot.js'

type PromptResourceToolbarProps = {
  trailingActions?: ReactNode
  tokenSnapshot?: ResourceTokenSnapshot
  tokenSnapshotIncomplete?: boolean
  resourceKind: PromptResource['resourceKind']
  resources: readonly PromptResource[]
  selectedResourceId?: string
  draftResourceIds: string[]
  onDiscardDraft(resourceId: string): void
  onRetryDraft(resourceId: string): Promise<void>
  t: Translator
  onCreate(resourceKind: PromptResource['resourceKind']): Promise<string | undefined>
  onDelete(resourceId: string): Promise<void>
  onDuplicate(resourceId: string): Promise<string | undefined>
  onImport(file: File): Promise<string | undefined>
  onImportZip?: (file: File) => Promise<string | undefined>
  onSelect(resourceId: string): void
  onBindResources?(): void
  bindResourcesLabel?: string
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
  const selected = props.resources.find(resource => resource.id === props.selectedResourceId)

  const selectResult = async (action: Promise<string | undefined>, successMessage?: string) => {
    setError(undefined)
    try {
      const resourceId = await action
      if (resourceId && mountedRef.current) {
        props.onSelect(resourceId)
        if (successMessage) notify.success(successMessage)
      }
    } catch (caught) {
      reportError(caught)
    }
  }
  const reportError = (caught: unknown) => {
    const message = caught instanceof Error ? caught.message : String(caught)
    setError(message)
    notify.failure('资源操作未完成', message)
  }

  return (
    <div className={styles.toolbar}>
      {error && !pendingDelete ? <p role="alert">{error}</p> : null}
      <div className={styles.actions}>
        {props.tokenSnapshot ? <TokenSnapshotControl snapshot={props.tokenSnapshot} t={props.t}
          incomplete={props.tokenSnapshotIncomplete} disabled={!selected} /> : null}
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
              void props.onRetryDraft(selected.id)
                .then(() => notify.success(props.t('notify.success.saved')))
                .catch(reportError)
                .finally(() => setSavingDraft(false))
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
          onClick={() => void selectResult(props.onCreate(props.resourceKind), props.t('notify.success.created'))}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('promptResource.duplicate')}
          disabled={!selected}
          title={props.t('promptResource.duplicate')}
          type="button"
          onClick={() => selected && void selectResult(props.onDuplicate(selected.id), props.t('notify.success.created'))}
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
        {props.onBindResources ? (
          <button
            aria-label={props.bindResourcesLabel ?? props.t('context.cardBindings.action')}
            title={props.bindResourcesLabel ?? props.t('context.cardBindings.action')}
            type="button"
            onClick={props.onBindResources}
          >
            <Link2 aria-hidden="true" />
          </button>
        ) : null}
        <button
          aria-label={props.t('promptResource.delete')}
          disabled={!selected}
          title={props.t('promptResource.delete')}
          type="button"
          onClick={() => {
            setError(undefined)
            if (selected) setPendingDelete(selected)
          }}
        >
          <Trash2 aria-hidden="true" />
        </button>
        {props.trailingActions}
      </div>
      {props.tokenSnapshot && (props.tokenSnapshot.summary || props.tokenSnapshot.pending || props.tokenSnapshot.error)
        ? <div className={styles.tokenResults}>
          <TokenSnapshotSummary snapshot={props.tokenSnapshot} t={props.t} incomplete={props.tokenSnapshotIncomplete} />
        </div> : null}
      <input
        ref={importInputRef}
        accept="application/json,.json,application/zip,.zip"
        className={styles.fileInput}
        type="file"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void selectResult(file.name.toLowerCase().endsWith('.zip') && props.onImportZip ? props.onImportZip(file) : props.onImport(file), props.t('notify.success.imported'))
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
                  .then(() => {
                    setPendingDelete(undefined)
                    notify.success(props.t('notify.success.deleted'))
                  })
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
