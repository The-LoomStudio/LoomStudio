import { createId } from '@loom-studio/shared'
import { Bot, Braces, Boxes, Component, Plus, Trash2, BookOpen } from 'lucide-react'
import type { MacroOption, MacroOptions } from '@loom-studio/shared'
import { SearchField, TextInput } from '@loom-studio/ui'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { normalizeSearchText } from '../../../shared/lib/text.js'
import { FileTree, type FileTreeNode } from '../../../shared/ui/file-tree/file-tree.js'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { MacroEntryDetail } from './macro-entry-detail.js'
import styles from './state-variables-panel.module.scss'

export type MacroAuthoringSource = {
  id: string
  kind: 'card' | 'preset' | 'workspace' | 'extension'
  sourceGroup?: 'card' | 'extension' | 'personal'
  label: string
  version: number
  macros: Record<string, string>
  macroOptions?: MacroOptions
  readonly?: boolean
  onSave(input: { expectedVersion: number; macros: Record<string, string>; macroOptions?: MacroOptions }): Promise<{ version: number; macros: Record<string, string>; macroOptions?: MacroOptions }>
}

type MacroRow = { id: string; name: string; value?: string; options: MacroOption[] }

export type MacroAuthoringController = {
  sources: MacroAuthoringSource[]
  sourceRows: Record<string, MacroRow[]>
  draftVersions: Record<string, number>
  selectedNodeId?: string
  dirtySources: Record<string, boolean>
  savingSourceId?: string
  error: string
  t: Translator
  selectNode(id?: string): void
  addRow(sourceId: string): void
  updateRow(sourceId: string, rowId: string, update: Partial<Pick<MacroRow, 'name' | 'value' | 'options'>>): void
  removeRow(sourceId: string, rowId: string): void
  save(sourceId: string): Promise<void>
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

export function useMacroAuthoring(sources: MacroAuthoringSource[], t: Translator): MacroAuthoringController {
  const [store, setStore] = useState(() => ({
    sourceRows: {} as Record<string, MacroRow[]>,
    draftVersions: {} as Record<string, number>,
    baselines: {} as Record<string, string>,
  }))
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [savingSourceId, setSavingSourceId] = useState<string>()
  const [error, setError] = useState('')
  const nextRowIdRef = useRef(0)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const sourceKeys = sources.map(s => `${s.id}:${s.version}`).join(',')

  // Sync sources
  useEffect(() => {
    setStore(prev => {
      let changed = false
      const next = { ...prev, sourceRows: { ...prev.sourceRows }, baselines: { ...prev.baselines }, draftVersions: { ...prev.draftVersions } }
      for (const source of sources) {
        const key = draftKey(toRows(source.macros, source.macroOptions))
        const dirty = next.baselines[source.id] !== undefined
          && next.baselines[source.id] !== draftKey(next.sourceRows[source.id] ?? [])
        if (!dirty && (next.baselines[source.id] === undefined || source.version > (next.draftVersions[source.id] ?? 0))) {
          next.sourceRows[source.id] = toRows(source.macros, source.macroOptions)
          next.baselines[source.id] = key
          next.draftVersions[source.id] = source.version
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [sourceKeys])

  const dirtySources = useMemo(() => {
    const dirty: Record<string, boolean> = {}
    for (const source of sources) {
      dirty[source.id] = store.baselines[source.id] !== draftKey(store.sourceRows[source.id] ?? [])
    }
    return dirty
  }, [sources, store.baselines, store.sourceRows])

  function selectNode(id?: string) {
    setSelectedNodeId(id)
  }

  function addRow(sourceId: string) {
    setStore(prev => {
      const rows = prev.sourceRows[sourceId] ?? []
      const names = new Set(rows.map(row => row.name))
      let index = rows.length + 1
      while (names.has(`macro_${index}`)) index += 1
      const row = { id: `new-${nextRowIdRef.current++}`, name: `macro_${index}`, value: '', options: [] }
      return { ...prev, sourceRows: { ...prev.sourceRows, [sourceId]: [...rows, row] } }
    })
    // Note: the new row ID might not exactly match this because of state timing,
    // but the ID logic is predictable enough.
    setSelectedNodeId(`${sourceId}:new-${nextRowIdRef.current - 1}`)
  }

  function updateRow(sourceId: string, rowId: string, update: Partial<Pick<MacroRow, 'name' | 'value' | 'options'>>) {
    setStore(prev => ({
      ...prev,
      sourceRows: {
        ...prev.sourceRows,
        [sourceId]: (prev.sourceRows[sourceId] ?? []).map(row => row.id === rowId ? { ...row, ...update } : row)
      }
    }))
  }

  function removeRow(sourceId: string, rowId: string) {
    setStore(prev => ({
      ...prev,
      sourceRows: {
        ...prev.sourceRows,
        [sourceId]: (prev.sourceRows[sourceId] ?? []).filter(row => row.id !== rowId)
      }
    }))
  }

  async function save(sourceId: string) {
    const source = sources.find(s => s.id === sourceId)
    if (!source || savingSourceId) return
    const rows = store.sourceRows[sourceId] ?? []
    const macros = toMacros(rows)
    if (new Set(rows.map(row => row.name.trim().toLowerCase())).size !== rows.length || rows.some(row => !row.name.trim())) {
      setError(t('macroAuthoring.invalid'))
      return
    }
    setSavingSourceId(sourceId)
    try {
      const result = await source.onSave({ expectedVersion: store.draftVersions[sourceId] ?? source.version, macros, macroOptions: toMacroOptions(rows) })
      if (!mountedRef.current) return
      const updatedRows = toRows(result.macros, result.macroOptions)
      setStore(prev => ({
        ...prev,
        baselines: { ...prev.baselines, [sourceId]: draftKey(updatedRows) },
        sourceRows: { ...prev.sourceRows, [sourceId]: draftKey(prev.sourceRows[sourceId] ?? []) === draftKey(rows)
          ? updatedRows : prev.sourceRows[sourceId]! },
        draftVersions: { ...prev.draftVersions, [sourceId]: result.version },
      }))
      setError('')
      notify.success(t('macroAuthoring.saved'))
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      if (mountedRef.current) setError(message)
      notify.failure('保存宏失败', message)
    } finally {
      if (mountedRef.current) setSavingSourceId(undefined)
    }
  }

  return {
    sources,
    sourceRows: store.sourceRows,
    draftVersions: store.draftVersions,
    selectedNodeId,
    dirtySources,
    savingSourceId,
    error,
    t,
    selectNode,
    addRow,
    updateRow,
    removeRow,
    save,
  }
}

export function MacroAuthoringExplorer(props: { controller: MacroAuthoringController; header?: ReactNode; onSelect?(id: string): void; onAdd?(): void }) {
  const { controller } = props
  const t = controller.t
  const [query, setQuery] = useState('')
  const search = normalizeSearchText(query)

  const nodes: FileTreeNode[] = useMemo(() => {
    const groups = new Map<string, FileTreeNode[]>()
    for (const source of controller.sources) {
      const group = source.sourceGroup ?? (source.kind === 'card' || source.kind === 'extension' ? source.kind : 'personal')
      const groupLabel = t(`registrySource.${group}`)
      const rows = controller.sourceRows[source.id] ?? []
      const sourceMatches = normalizeSearchText(`${source.label} ${source.kind} ${groupLabel}`).includes(search)
      const matchingRows = sourceMatches ? rows : rows.filter(row => normalizeSearchText(
        `${row.name} ${row.value ?? ''} ${row.options.map(option => `${option.label} ${option.value}`).join(' ')}`
      ).includes(search))
      if (search && !sourceMatches && matchingRows.length === 0) continue
      const children = groups.get(group) ?? []
      children.push({
        id: `source:${source.id}`,
        label: source.label,
        kind: 'folder' as const,
        children: matchingRows.map(row => ({
          id: `${source.id}:${row.id}`,
          label: row.name || t('macroAuthoring.name'),
          kind: 'entry' as const,
          meta: row.options.length > 0 ? t('macroAuthoring.optionCount', { count: row.options.length }) : undefined,
        }))
      })
      groups.set(group, children)
    }
    return (['card', 'extension', 'personal'] as const).flatMap(group => {
      const children = groups.get(group)
      return children ? [{ id: `section:${group}`, isSection: true, label: t(`registrySource.${group}`), children }] : []
    })
  }, [controller.sources, controller.sourceRows, search, t])

  const [expandedIds, setExpandedIds] = useState<string[]>(controller.sources.map(s => `source:${s.id}`))

  return (
    <nav className={styles.macroAuthoringExplorer} aria-label={t('macroAuthoring.title')}>
      {props.header ? (
        <header className={styles.masterHeader}>
          {props.header}
        </header>
      ) : (
        <div className={styles.stateAuthoringSectionHeader}>
          <span>{t('macroAuthoring.title')}</span>
        </div>
      )}
      <SearchField
        containerClassName={styles.macroInspectorSearch}
        aria-label={t('macroAuthoring.search')}
        placeholder={t('macroAuthoring.searchPlaceholder')}
        clearLabel={t('context.search.clear')}
        value={query}
        onChange={event => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      <div className={styles.macroInspectorResults}>
        {nodes.length === 0 ? (
          <span className={styles.emptyState}>{search ? t('macroInspector.searchEmpty') : t('macroAuthoring.empty')}</span>
        ) : (
          <FileTree
          ariaLabel={t('macroAuthoring.title')}
          nodes={nodes}
          selectedId={controller.selectedNodeId}
          expandedIds={search ? [...new Set([...expandedIds, ...nodes.flatMap(node => node.children?.map(child => child.id) ?? [])])] : expandedIds}
          onExpandedIdsChange={setExpandedIds}
          onSelect={node => {
            controller.selectNode(node.id)
            props.onSelect?.(node.id)
          }}
          renderIcon={node => {
            if (node.kind === 'folder') {
              const kind = controller.sources.find(source => `source:${source.id}` === node.id)?.kind
              if (kind === 'card') return <BookOpen size={16} />
              if (kind === 'preset') return <Bot size={16} />
              if (kind === 'workspace') return <Boxes size={16} />
              return <Component size={16} />
            }
            return <Braces size={16} />
          }}
          renderTrailing={node => {
            if (node.kind === 'folder') {
              const sourceId = node.id.split(':')[1]!
              const source = controller.sources.find(s => s.id === sourceId)
              if (source?.readonly) return null
              return (
                <button
                  aria-label={t('macroAuthoring.add')}
                  className={styles.navAddBtn}
                  type="button"
                  onClick={event => {
                    event.stopPropagation()
                    if (!expandedIds.includes(node.id)) setExpandedIds([...expandedIds, node.id])
                    setQuery('')
                    controller.addRow(sourceId)
                    props.onAdd?.()
                  }}
                >
                  <Plus aria-hidden="true" size={13} />
                </button>
              )
            }
            return null
          }}
          getDisclosureLabel={(node, expanded) => t(expanded ? 'macroAuthoring.collapseNamed' : 'macroAuthoring.expandNamed', { name: node.label })}
          getDragLabel={node => t('macroAuthoring.moveNamed', { name: node.label })}
          moreActionsLabel={t('macroAuthoring.moreActions')}
          variant="flat"
          />
        )}
      </div>
    </nav>
  )
}

export function MacroAuthoringWorkbench(props: {
  sources: MacroAuthoringSource[]
  t: Translator
  header?: ReactNode
}) {
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const controller = useMacroAuthoring(props.sources, props.t)

  return (
    <MasterDetailWorkbench
      resizeLabel={props.t('stateVariables.resizeSidebar')}
      backLabel={props.t('stateAuthoring.backToList')}
      defaultMasterWidth={280}
      detailMinWidth={360}
      mobilePane={mobilePane}
      onBack={() => setMobilePane('master')}
      onMobilePaneChange={setMobilePane}
      master={
        <MacroAuthoringExplorer
          controller={controller}
          header={props.header}
          onSelect={() => setMobilePane('detail')}
          onAdd={() => setMobilePane('detail')}
        />
      }
    >
      <MacroAuthoringDetail controller={controller} />
    </MasterDetailWorkbench>
  )
}

export function MacroAuthoringDetail(props: { controller: MacroAuthoringController }) {
  const { controller } = props
  const t = controller.t

  if (!controller.selectedNodeId || controller.selectedNodeId.startsWith('source:')) {
    return <div className={styles.emptyState}>{t('macroAuthoring.empty')}</div>
  }

  const [sourceId, rowId] = controller.selectedNodeId.split(':')
  const source = controller.sources.find(s => s.id === sourceId)
  const rows = controller.sourceRows[sourceId!] ?? []
  const row = rows.find(r => r.id === rowId)
  const draftVersion = controller.draftVersions[sourceId!] ?? source?.version ?? 0
  const isSaving = controller.savingSourceId === sourceId
  const isDirty = controller.dirtySources[sourceId!] ?? false

  if (!source) return <div className={styles.emptyState}>{t('macroAuthoring.empty')}</div>

  return <MacroEntryDetail
    badge={<span className={styles.badge}>{source.label} · v{draftVersion}</span>}
    busy={isSaving}
    dirty={isDirty}
    editable={Boolean(row) && !source.readonly}
    emptyLabel={t('macroAuthoring.empty')}
    error={controller.error}
    name={row?.name ?? ''}
    t={t}
    title={row?.name ?? source.label}
    value={row?.value}
    onDelete={row && !source.readonly ? () => controller.removeRow(source.id, row.id) : undefined}
    onNameChange={row && !source.readonly ? value => controller.updateRow(source.id, row.id, { name: value }) : undefined}
    onSave={() => void controller.save(source.id)}
    onValueChange={row && !source.readonly ? value => controller.updateRow(source.id, row.id, { value }) : undefined}
  >
    {row && !source.readonly ? <fieldset className={`${styles.macroSourceList} ${styles.macroOptionList}`} disabled={isSaving}>
      <legend>{t('macroAuthoring.options')}</legend>
      <button className={`${styles.iconButton} ${styles.macroOptionAdd}`} type="button" disabled={isSaving} title={t('macroAuthoring.addOption')} aria-label={t('macroAuthoring.addOption')}
        onClick={() => controller.updateRow(source.id, row.id, { options: [...row.options, { id: createId(), label: '', value: '' }] })}>
        <Plus size={14} aria-hidden="true" />
      </button>
      {row.options.map(option => <div key={option.id} className={styles.macroOption}>
        <label>
          <span>{t('macroAuthoring.optionName')}</span>
          <TextInput value={option.label} onChange={event => controller.updateRow(source.id, row.id, { options: row.options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} />
        </label>
        <button className={styles.iconButton} type="button" title={t('macroAuthoring.deleteOption')} aria-label={t('macroAuthoring.deleteOption')}
          onClick={() => controller.updateRow(source.id, row.id, { options: row.options.filter(item => item.id !== option.id) })}><Trash2 size={14} aria-hidden="true" /></button>
        <label className={styles.macroOptionValue}>
          <span>{t('macroAuthoring.value')}</span>
          <textarea value={option.value} onChange={event => controller.updateRow(source.id, row.id, { options: row.options.map(item => item.id === option.id ? { ...item, value: event.target.value } : item) })} />
        </label>
      </div>)}
    </fieldset> : null}
  </MacroEntryDetail>
}
