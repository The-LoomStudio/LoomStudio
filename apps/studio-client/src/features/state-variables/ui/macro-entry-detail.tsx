import { Copy, Save, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { tryWriteClipboardText } from '../../../shared/browser/clipboard.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './state-variables-panel.module.scss'

export function MacroEntryDetail(props: {
  title: string
  name: string
  value?: string
  t: Translator
  badge?: ReactNode
  children?: ReactNode
  error?: string
  editable?: boolean
  busy?: boolean
  dirty?: boolean
  emptyLabel?: string
  onNameChange?(value: string): void
  onValueChange?(value: string): void
  onDelete?(): void
  onSave?(): void
}) {
  async function copyMacro() {
    if (!props.name.trim()) return
    const copied = await tryWriteClipboardText(`{{${props.name.trim()}}}`)
    if (copied) toast.success(props.t('stateVariables.copiedMacro'))
    else toast.error(props.t('longTextEditor.copyFailed'))
  }

  return <section className={styles.macroAuthoringDetail} data-loom-component="macro-entry-detail">
    <header className={styles.detailHeader}>
      <div className={styles.headerTitle}><h3>{props.title}</h3>{props.badge}</div>
      <div className={styles.headerActions}>
        <button aria-label={props.t('stateVariables.copyMacro')} className={styles.iconButton} title={props.t('stateVariables.copyMacro')} type="button" disabled={!props.name.trim()} onClick={() => void copyMacro()}><Copy aria-hidden="true" size={14} /></button>
        {props.onDelete ? <button className={styles.dangerActionBtn} type="button" disabled={props.busy} onClick={props.onDelete}><Trash2 aria-hidden="true" size={14} /><span>{props.t('macroAuthoring.delete')}</span></button> : null}
        {props.onSave ? <button className={styles.primaryActionBtn} type="button" disabled={props.busy || !props.dirty} onClick={props.onSave}><Save aria-hidden="true" size={14} /><span>{props.t('macroAuthoring.save')}</span></button> : null}
      </div>
    </header>
    {props.error ? <div className={styles.errorBanner} role="alert">{props.error}</div> : null}
    {props.name || props.editable ? <div className={styles.macroAuthoringFields}>
      <label><span>{props.t('macroAuthoring.name')}</span>{props.editable ? <input aria-label={props.t('macroAuthoring.name')} disabled={props.busy} value={props.name} onChange={event => props.onNameChange?.(event.target.value)} /> : <code>{props.name}</code>}</label>
      <label><span>{props.t('macroAuthoring.value')}</span>{props.editable ? <textarea aria-label={props.t('macroAuthoring.value')} disabled={props.busy} value={props.value ?? ''} onChange={event => props.onValueChange?.(event.target.value)} /> : <pre className={styles.macroReadOnlyValue}>{props.value ?? '—'}</pre>}</label>
    </div> : <div className={styles.emptyState}>{props.emptyLabel}</div>}
    {props.children}
  </section>
}
