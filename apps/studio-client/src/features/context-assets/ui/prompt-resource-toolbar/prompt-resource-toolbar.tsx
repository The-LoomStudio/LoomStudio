import { Copy, Download, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import type { PromptResource } from '../../../../entities/index.js'
import type { Translator } from '../../../../shared/i18n/index.js'
import { Dialog } from '../../../../shared/ui/dialog/dialog.js'
import styles from './prompt-resource-toolbar.module.scss'

type PromptResourceToolbarProps = {
  hideSelect?: boolean
  resourceKind: PromptResource['resourceKind']
  resources: PromptResource[]
  selectedResourceId?: string
  t: Translator
  onCreate(resourceKind: PromptResource['resourceKind']): Promise<string | undefined>
  onDelete(resourceId: string): Promise<void>
  onDuplicate(resourceId: string): Promise<string | undefined>
  onExport(resourceId: string): Promise<void>
  onImport(file: File): Promise<string | undefined>
  onSelect(resourceId: string): void
}

export function PromptResourceToolbar(props: PromptResourceToolbarProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [pendingDelete, setPendingDelete] = useState<PromptResource>()
  const [deleting, setDeleting] = useState(false)
  const selected = props.resources.find(resource => resource.id === props.selectedResourceId)

  const selectResult = async (action: Promise<string | undefined>) => {
    const resourceId = await action
    if (resourceId) props.onSelect(resourceId)
  }

  return (
    <div className={styles.toolbar}>
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
          onClick={() => selected && void props.onExport(selected.id)}
        >
          <Download aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('promptResource.delete')}
          disabled={!selected || selected.origin?.kind === 'builtin'}
          title={props.t(selected?.origin?.kind === 'builtin' ? 'promptResource.builtinReadOnly' : 'promptResource.delete')}
          type="button"
          onClick={() => selected && setPendingDelete(selected)}
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>
      <input
        ref={importInputRef}
        accept="application/json,.json"
        className={styles.fileInput}
        type="file"
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void selectResult(props.onImport(file))
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
                void props.onDelete(pendingDelete.id)
                  .then(() => setPendingDelete(undefined))
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
      />
    </div>
  )
}
