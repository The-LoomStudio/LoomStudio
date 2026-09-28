import { Plus, Trash2 } from 'lucide-react'
import type { MacroOption, MacroOptions } from '@loom-studio/shared'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Translator } from '../../../shared/i18n/index.js'
import { MacroEntryDetail } from './macro-entry-detail.js'
import styles from './state-variables-panel.module.scss'

export type MacroAuthoringPanelProps = {
  ownerId: string
  ownerLabel: string
  version: number
  macros: Record<string, string>
  macroOptions?: MacroOptions
  onSave(input: { expectedVersion: number; macros: Record<string, string>; macroOptions?: MacroOptions }): Promise<{ version: number; macros: Record<string, string>; macroOptions?: MacroOptions }>
  t: Translator
}

type MacroRow = { id: string; name: string; value?: string; options: MacroOption[] }

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
  updateRow(id: string, update: Partial<Pick<MacroRow, 'name' | 'value' | 'options'>>): void
  removeRow(id: string): void
  save(): Promise<void>
}

export function useMacroAuthoring(input?: MacroAuthoringPanelProps): MacroAuthoringController {
  const [rows, setRows] = useState<MacroRow[]>(() => toRows(input?.macros ?? {}, input?.macroOptions))
  const [selectedRowId, setSelectedRowId] = useState<string>()
  const [draftVersion, setDraftVersion] = useState(input?.version ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ownerRef = useRef(input?.ownerId)
  const mountedRef = useRef(false)
  const baselineRef = useRef(draftKey(toRows(input?.macros ?? {}, input?.macroOptions)))
  const nextRowIdRef = useRef(0)
  const draftChanged = useMemo(() => draftKey(rows) !== baselineRef.current, [rows])
  const inputMacrosKey = JSON.stringify([input?.macros, input?.macroOptions])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (ownerRef.current !== input?.ownerId) {
      ownerRef.current = input?.ownerId
      const nextRows = toRows(input?.macros ?? {}, input?.macroOptions)
      baselineRef.current = draftKey(nextRows)
      setRows(nextRows)
      setSelectedRowId(undefined)
      setDraftVersion(input?.version ?? 0)
      setSaving(false)
      setError('')
      return
    }
    if (!draftChanged && input && input.version >= draftVersion) {
      baselineRef.current = draftKey(toRows(input.macros, input.macroOptions))
      setRows(toRows(input.macros, input.macroOptions))
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
    const row = { id: `new-${nextRowIdRef.current++}`, name: `macro_${index}`, value: '', options: [] }
    setRows([...rows, row])
    setSelectedRowId(row.id)
  }

  function updateRow(id: string, update: Partial<Pick<MacroRow, 'name' | 'value' | 'options'>>) {
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...update } : row))
  }

  function removeRow(id: string) {
    setRows(previous => previous.filter(row => row.id !== id))
  }

  async function save() {
    if (!input || saving) return
    const macros = toMacros(rows)
    if (new Set(rows.map(row => row.name.trim().toLowerCase())).size !== rows.length || rows.some(row => !row.name.trim())) {
      setError(input.t('macroAuthoring.invalid'))
      return
    }
    const ownerId = input.ownerId
    setSaving(true)
    try {
      const result = await input.onSave({ expectedVersion: draftVersion, macros, macroOptions: toMacroOptions(rows) })
      if (!mountedRef.current || ownerRef.current !== ownerId) return
      baselineRef.current = draftKey(toRows(result.macros, result.macroOptions))
      setRows(toRows(result.macros, result.macroOptions))
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
  return <MacroEntryDetail
    badge={<span className={styles.badge}>v{input.version}</span>}
    busy={controller.saving}
    dirty={controller.dirty}
    editable={Boolean(row)}
    emptyLabel={t('macroAuthoring.empty')}
    error={controller.error}
    name={row?.name ?? ''}
    t={t}
    title={input.ownerLabel}
    value={row?.value}
    onDelete={row ? () => controller.removeRow(row.id) : undefined}
    onNameChange={row ? value => controller.updateRow(row.id, { name: value }) : undefined}
    onSave={() => void controller.save()}
    onValueChange={row ? value => controller.updateRow(row.id, { value }) : undefined}
  >
    {row ? <section className={styles.macroAuthoringFields}>
      <header className={styles.stateAuthoringSectionHeader}>
        <span>{t('macroAuthoring.options')}</span>
        <button className={styles.iconButton} type="button" disabled={controller.saving} title={t('macroAuthoring.addOption')} aria-label={t('macroAuthoring.addOption')}
          onClick={() => controller.updateRow(row.id, { options: [...row.options, { id: crypto.randomUUID(), label: t('macroAuthoring.optionName'), value: '' }] })}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </header>
      {row.options.map(option => <fieldset key={option.id} className={`${styles.macroAuthoringFields} ${styles.macroOption}`} disabled={controller.saving}>
        <legend>{option.label}</legend>
        <label><span>{t('macroAuthoring.optionName')}</span><input value={option.label} onChange={event => controller.updateRow(row.id, { options: row.options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} /></label>
        <label><span>{t('macroAuthoring.value')}</span><textarea value={option.value} onChange={event => controller.updateRow(row.id, { options: row.options.map(item => item.id === option.id ? { ...item, value: event.target.value } : item) })} /></label>
        <button className={styles.iconButton} type="button" title={t('macroAuthoring.deleteOption')} aria-label={t('macroAuthoring.deleteOption')}
          onClick={() => controller.updateRow(row.id, { options: row.options.filter(item => item.id !== option.id) })}><Trash2 size={14} aria-hidden="true" /></button>
      </fieldset>)}
    </section> : null}
  </MacroEntryDetail>
}

function toRows(macros: Record<string, string>, options: MacroOptions = {}): MacroRow[] {
  const rows: MacroRow[] = Object.entries(macros).map(([name, value], index) => ({
    id: `loaded-${index}-${name}`, name, value, options: [],
  }))
  for (const [name, candidates] of Object.entries(options)) {
    const row = rows.find(item => item.name.toLowerCase() === name.toLowerCase())
    if (row) row.options = candidates
    else rows.push({ id: `loaded-${rows.length}-${name}`, name, options: candidates })
  }
  return rows
}

function toMacros(rows: MacroRow[]): Record<string, string> {
  return Object.fromEntries(rows.flatMap(row => {
    const name = row.name.trim()
    return name && row.value !== undefined ? [[name, row.value]] : []
  }))
}

function toMacroOptions(rows: MacroRow[]): MacroOptions {
  return Object.fromEntries(rows.filter(row => row.options.length > 0).map(row => [row.name.trim(), row.options]))
}

function draftKey(rows: MacroRow[]): string {
  return JSON.stringify([toMacros(rows), toMacroOptions(rows)])
}
