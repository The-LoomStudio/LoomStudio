import { Copy, Plus, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { tryWriteClipboardText } from '../../../shared/browser/clipboard.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './state-variables-panel.module.scss'

export type MacroAuthoringPanelProps = {
  ownerId: string
  ownerLabel: string
  version: number
  macros: Record<string, string>
  onSave(input: { expectedVersion: number; macros: Record<string, string> }): Promise<{ version: number; macros: Record<string, string> }>
  t: Translator
}

type MacroRow = { id: string; name: string; value: string }

export type MacroAuthoringController = {
  input?: MacroAuthoringPanelProps
  rows: MacroRow[]
  selectedRow?: MacroRow
  selectedRowId?: string
  dirty: boolean
  saving: boolean
  error: string
  selectRow(id?: string): void
  addRow(): void
  updateRow(id: string, update: Partial<Pick<MacroRow, 'name' | 'value'>>): void
  removeRow(id: string): void
  save(): Promise<void>
}

export function useMacroAuthoring(input?: MacroAuthoringPanelProps): MacroAuthoringController {
  const [rows, setRows] = useState<MacroRow[]>(() => toRows(input?.macros ?? {}))
  const [selectedRowId, setSelectedRowId] = useState<string>()
  const [draftVersion, setDraftVersion] = useState(input?.version ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ownerRef = useRef(input?.ownerId)
  const mountedRef = useRef(false)
  const baselineRef = useRef(JSON.stringify(input?.macros ?? {}))
  const nextRowIdRef = useRef(0)
  const draftChanged = useMemo(() => JSON.stringify(toMacros(rows)) !== baselineRef.current, [rows])
  const inputMacrosKey = JSON.stringify(input?.macros ?? {})

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (ownerRef.current !== input?.ownerId) {
      ownerRef.current = input?.ownerId
      const nextRows = toRows(input?.macros ?? {})
      baselineRef.current = JSON.stringify(input?.macros ?? {})
      setRows(nextRows)
      setSelectedRowId(undefined)
      setDraftVersion(input?.version ?? 0)
      setSaving(false)
      setError('')
      return
    }
    if (!draftChanged && input && input.version >= draftVersion) {
      baselineRef.current = JSON.stringify(input.macros)
      setRows(toRows(input.macros))
      setDraftVersion(input.version)
    }
  }, [draftChanged, draftVersion, input?.ownerId, input?.version, inputMacrosKey])

  useEffect(() => {
    if (!selectedRowId || !rows.some(row => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]?.id)
    }
  }, [rows, selectedRowId])

  function selectRow(id?: string) {
    setSelectedRowId(id)
  }

  function addRow() {
    const names = new Set(rows.map(row => row.name))
    let index = rows.length + 1
    while (names.has(`macro_${index}`)) index += 1
    const row = { id: `new-${nextRowIdRef.current++}`, name: `macro_${index}`, value: '' }
    setRows([...rows, row])
    setSelectedRowId(row.id)
  }

  function updateRow(id: string, update: Partial<Pick<MacroRow, 'name' | 'value'>>) {
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...update } : row))
  }

  function removeRow(id: string) {
    setRows(previous => previous.filter(row => row.id !== id))
  }

  async function save() {
    if (!input || saving) return
    const macros = toMacros(rows)
    if (Object.keys(macros).length !== rows.length || rows.some(row => !row.name.trim())) {
      setError(input.t('macroAuthoring.invalid'))
      return
    }
    const ownerId = input.ownerId
    setSaving(true)
    try {
      const result = await input.onSave({ expectedVersion: draftVersion, macros })
      if (!mountedRef.current || ownerRef.current !== ownerId) return
      baselineRef.current = JSON.stringify(result.macros)
      setRows(toRows(result.macros))
      setDraftVersion(result.version)
      setError('')
      toast.success(input.t('macroAuthoring.saved'))
    } catch (cause) {
      if (mountedRef.current && ownerRef.current === ownerId) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedRef.current && ownerRef.current === ownerId) setSaving(false)
    }
  }

  return {
    input,
    rows,
    selectedRow: rows.find(row => row.id === selectedRowId),
    selectedRowId,
    dirty: draftChanged,
    saving,
    error,
    selectRow,
    addRow,
    updateRow,
    removeRow,
    save,
  }
}

export function MacroAuthoringExplorer(props: { controller: MacroAuthoringController; onSelect?(id: string): void; onAdd?(): void }) {
  const { controller } = props
  const t = controller.input?.t
  return (
    <nav className={styles.macroAuthoringExplorer} aria-label={t?.('macroAuthoring.title')}>
      <div className={styles.stateAuthoringSectionHeader}>
        <span>{t?.('macroAuthoring.title')}</span>
        <button className={styles.iconButton} type="button" aria-label={t?.('macroAuthoring.add')} disabled={!controller.input || controller.saving} onClick={() => { controller.addRow(); props.onAdd?.() }}>
          <Plus aria-hidden="true" size={14} />
        </button>
      </div>
      {controller.rows.length === 0 ? <span className={styles.emptyState}>{t?.('macroAuthoring.empty')}</span> : controller.rows.map(row => (
        <button
          aria-current={row.id === controller.selectedRowId ? 'page' : undefined}
          className={styles.macroAuthoringListItem}
          key={row.id}
          type="button"
          onClick={() => { controller.selectRow(row.id); props.onSelect?.(row.id) }}
        >
          <span>{row.name || t?.('macroAuthoring.name')}</span>
        </button>
      ))}
    </nav>
  )
}

export function MacroAuthoringDetail(props: { controller: MacroAuthoringController }) {
  const { controller } = props
  const input = controller.input
  const row = controller.selectedRow
  const t = input?.t
  if (!input || !t) return <div className={styles.emptyState}>{t?.('macroAuthoring.empty')}</div>
  const translate = input.t
  async function copyMacro() {
    if (!row?.name.trim()) return
    const copied = await tryWriteClipboardText(`{{${row.name.trim()}}}`)
    if (copied) toast.success(translate('stateVariables.copiedMacro'))
    else toast.error(translate('longTextEditor.copyFailed'))
  }
  return (
    <section className={styles.macroAuthoringDetail} data-loom-component="macro-authoring-detail">
      <header className={styles.detailHeader}>
        <div className={styles.headerTitle}><h3>{input.ownerLabel}</h3><span className={styles.badge}>v{input.version}</span></div>
        <div className={styles.headerActions}>
          {row ? <button aria-label={t('stateVariables.copyMacro')} className={styles.iconButton} title={t('stateVariables.copyMacro')} type="button" disabled={!row.name.trim()} onClick={() => void copyMacro()}>
            <Copy aria-hidden="true" size={14} />
          </button> : null}
          {row ? <button className={styles.dangerActionBtn} type="button" disabled={controller.saving} onClick={() => controller.removeRow(row.id)}>
            <Trash2 aria-hidden="true" size={14} /><span>{t('macroAuthoring.delete')}</span>
          </button> : null}
          <button className={styles.primaryActionBtn} type="button" disabled={controller.saving || !controller.dirty} onClick={() => void controller.save()}>
            <Save aria-hidden="true" size={14} /><span>{t('macroAuthoring.save')}</span>
          </button>
        </div>
      </header>
      {controller.error ? <div className={styles.errorBanner} role="alert">{controller.error}</div> : null}
      {row ? <div className={styles.macroAuthoringFields}>
        <label><span>{t('macroAuthoring.name')}</span><input aria-label={t('macroAuthoring.name')} disabled={controller.saving} value={row.name} onChange={event => controller.updateRow(row.id, { name: event.target.value })} /></label>
        <label><span>{t('macroAuthoring.value')}</span><textarea aria-label={t('macroAuthoring.value')} disabled={controller.saving} value={row.value} onChange={event => controller.updateRow(row.id, { value: event.target.value })} /></label>
      </div> : <div className={styles.emptyState}>{t('macroAuthoring.empty')}</div>}
    </section>
  )
}

function toRows(macros: Record<string, string>): MacroRow[] {
  return Object.entries(macros).map(([name, value], index) => ({ id: `loaded-${index}-${name}`, name, value }))
}

function toMacros(rows: MacroRow[]): Record<string, string> {
  return Object.fromEntries(rows.flatMap(row => {
    const name = row.name.trim()
    return name ? [[name, row.value]] : []
  }))
}
