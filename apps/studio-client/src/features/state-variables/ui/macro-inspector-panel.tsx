import { ChevronDown, ChevronRight, Folder, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react'
import { SearchField } from '@loom-studio/ui'
import { useEffect, useMemo, useState } from 'react'
import { canonicalMacroName, macroSelectionMatches, type MacroCandidate, type MacroInspection, type MacroSelection, type MacroSelectionMap } from '@loom-studio/shared'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { normalizeSearchText } from '../../../shared/lib/text.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { MacroEntryDetail } from './macro-entry-detail.js'
import styles from './state-variables-panel.module.scss'

export type MacroInspectorPanelProps = {
  inspection?: MacroInspection
  loading: boolean
  error?: string
  readOnly?: boolean
  selections: MacroSelectionMap
  onSelectSource(name: string, selection: MacroSelection | undefined): void
  onRefresh(): void
  t: Translator
}

function isMacroSource(candidate: MacroCandidate): boolean {
  return candidate.sourceKind === 'card' || candidate.sourceKind === 'preset'
    || candidate.sourceKind === 'provider' || candidate.sourceId === 'builtin.aliases'
}

export function MacroInspectorPanel(props: MacroInspectorPanelProps) {
  const [selectedName, setSelectedName] = useState<string>()
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [query, setQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Array<MacroInspection['entries'][number]['status']>>([])
  const displayEntries = useMemo(() => (props.inspection?.entries ?? []).filter(entry =>
    entry.candidates.some(isMacroSource)
  ), [props.inspection])
  const selectedEntry = displayEntries.find(entry => entry.name === selectedName)
  const groups = useMemo(() => {
    const normalized = normalizeSearchText(query)
    const entries = displayEntries.filter(entry => !normalized || [
      entry.name,
      entry.value,
      ...entry.candidates.filter(isMacroSource)
        .flatMap(candidate => [candidate.sourceLabel, candidate.sourceKind, candidate.value]),
    ].some(value => value?.toLocaleLowerCase().includes(normalized)))
    return (['resolved', 'conflict', 'error'] as const)
      .map(status => ({ status, entries: entries.filter(entry => entry.status === status) }))
      .filter(group => group.entries.length > 0)
  }, [displayEntries, query])
  const visibleEntries = useMemo(() => groups.flatMap(group => group.entries), [groups])

  useEffect(() => {
    if (!props.inspection || visibleEntries.length === 0) {
      setSelectedName(undefined)
      return
    }
    if (!selectedName || !visibleEntries.some(entry => entry.name === selectedName)) {
      setSelectedName(visibleEntries[0]?.name)
    }
  }, [props.inspection, selectedName, visibleEntries])

  return (
    <section className={styles.panel} data-loom-component="macro-inspector-panel">
      <header className={styles.intro}>
        <h2>{props.t('macroInspector.title')}</h2>
        {!props.readOnly ? <button className={styles.iconButton} type="button" onClick={props.onRefresh} disabled={props.loading}>
          <RefreshCw aria-hidden="true" size={14} />
          <span>{props.t('macroInspector.refresh')}</span>
        </button> : null}
      </header>
      {props.error ? <div className={styles.errorBanner} role="alert">{props.error}</div> : null}
      {props.loading && !props.inspection ? <div className={styles.emptyState}>{props.t('macroInspector.loading')}</div> : null}
      {!props.loading && !props.inspection ? <div className={styles.emptyState}>{props.t('macroInspector.empty')}</div> : null}
      {props.inspection && displayEntries.length === 0 ? <div className={styles.emptyState}>{props.t('macroInspector.empty')}</div> : null}
      {props.inspection && displayEntries.length > 0 ? (
        <div className={styles.macroInspectorBody}>
          <MasterDetailWorkbench
            dataComponent="macro-inspector-workbench"
            detailMinWidth={220}
            mobilePane={mobilePane}
            onBack={() => setMobilePane('master')}
            onMobilePaneChange={setMobilePane}
            master={(
              <nav className={styles.macroInspectorMaster} aria-label={props.t('macroInspector.title')}>
                <SearchField
                  containerClassName={styles.macroInspectorSearch}
                  aria-label={props.t('macroInspector.search')}
                  placeholder={props.t('macroInspector.searchPlaceholder')}
                  clearLabel={props.t('context.search.clear')}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  onClear={() => setQuery('')}
                />
                <div className={styles.macroInspectorResults}>
                  {groups.map(group => (
                    <section className={styles.macroInspectorGroup} key={group.status}>
                      <header>
                        <button
                          aria-expanded={query ? true : !collapsedGroups.includes(group.status)}
                          type="button"
                          onClick={() => setCollapsedGroups(current => current.includes(group.status)
                            ? current.filter(status => status !== group.status)
                            : [...current, group.status])}
                        >
                          {query || !collapsedGroups.includes(group.status) ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
                          {query || !collapsedGroups.includes(group.status) ? <FolderOpen aria-hidden="true" size={14} /> : <Folder aria-hidden="true" size={14} />}
                          <span>{statusLabel(group.status, props.t)}</span>
                          <small>{group.entries.length}</small>
                        </button>
                      </header>
                      {(query || !collapsedGroups.includes(group.status)) && group.entries.map(entry => (
                        <button
                          aria-current={entry.name === selectedName ? 'page' : undefined}
                          className={styles.macroInspectorListItem}
                          key={entry.name}
                          type="button"
                          onClick={() => { setSelectedName(entry.name); setMobilePane('detail') }}
                        >
                          <strong>{entry.name}</strong>
                          <span>{entry.candidates.find(candidate => candidate.sourceId === entry.selectedSourceId && candidate.optionId === entry.selectedOptionId && isMacroSource(candidate))?.sourceLabel ?? statusLabel(entry.status, props.t)}</span>
                        </button>
                      ))}
                    </section>
                  ))}
                  {visibleEntries.length === 0 ? <div className={styles.emptyState}>{props.t('macroInspector.searchEmpty')}</div> : null}
                </div>
              </nav>
            )}
          >
            {selectedEntry ? <MacroInspectionEntryDetail entry={selectedEntry} props={props} /> : <div className={styles.emptyState}>{props.t('macroInspector.empty')}</div>}
          </MasterDetailWorkbench>
        </div>
      ) : null}
    </section>
  )
}

function MacroInspectionEntryDetail(props: { entry: MacroInspection['entries'][number]; props: MacroInspectorPanelProps }) {
  const { entry, props: panel } = props
  const saved = Object.hasOwn(panel.selections, canonicalMacroName(entry.name)) ? panel.selections[canonicalMacroName(entry.name)] : undefined
  const selected = saved ?? (entry.selectedSourceId
    ? { sourceId: entry.selectedSourceId, ...(entry.selectedOptionId ? { optionId: entry.selectedOptionId } : {}) } : undefined)
  const canSelectSource = !panel.readOnly && (entry.candidates.some(candidate => candidate.sourceKind === 'card' || candidate.sourceKind === 'preset' || candidate.sourceKind === 'provider')
    || saved !== undefined)
  return <MacroEntryDetail
    badge={<span className={entry.status === 'resolved' ? styles.statusResolved : entry.status === 'conflict' ? styles.statusConflict : styles.statusError}>{statusLabel(entry.status, panel.t)}</span>}
    name={entry.name}
    t={panel.t}
    title={entry.name}
    value={entry.value}
  >
      {entry.candidates.some(isMacroSource) || selected !== undefined ? (
        <fieldset className={styles.macroSourceList}>
          <legend>{panel.t('macroInspector.source')}</legend>
          {entry.candidates.filter(isMacroSource).map(candidate => (
            <label key={JSON.stringify([candidate.sourceId, candidate.optionId])}>
              {canSelectSource ? <input
                aria-label={panel.t('macroInspector.selectSource', { name: entry.name })}
                checked={macroSelectionMatches(selected, candidate)}
                name={`macro-source-${entry.name}`}
                disabled={panel.loading}
                type="radio"
                onChange={() => panel.onSelectSource(entry.name, { sourceId: candidate.sourceId, ...(candidate.optionId ? { optionId: candidate.optionId } : {}) })}
              /> : <span aria-hidden="true" className={styles.sourceMarker}>{macroSelectionMatches(selected, candidate) ? '●' : '○'}</span>}
              <span>{candidate.optionLabel ?? candidate.sourceLabel}</span>
              <small>{candidate.sourceKind}</small>
              {candidate.value !== undefined ? <code>{candidate.value}</code> : null}
              {candidate.error ? <em>{candidate.error}</em> : null}
            </label>
          ))}
          {canSelectSource && selected ? <button className={styles.iconButton} type="button" title={panel.t('macroInspector.clearSelection')} aria-label={panel.t('macroInspector.clearSelection')} disabled={panel.loading} onClick={() => panel.onSelectSource(entry.name, undefined)}><RotateCcw aria-hidden="true" size={14} /></button> : null}
        </fieldset>
      ) : null}
  </MacroEntryDetail>
}

function statusLabel(status: MacroInspection['entries'][number]['status'], t: Translator): string {
  return status === 'resolved' ? t('macroInspector.resolved') : status === 'conflict' ? t('macroInspector.conflict') : t('macroInspector.error')
}
