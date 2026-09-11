import { RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { MacroInspection } from '@loom-studio/shared'
import { MasterDetailWorkbench } from '../../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { MacroEntryDetail } from './macro-entry-detail.js'
import styles from './state-variables-panel.module.scss'

export type MacroInspectorPanelProps = {
  inspection?: MacroInspection
  loading: boolean
  error?: string
  readOnly?: boolean
  selections: Record<string, string>
  onSelectSource(name: string, sourceId: string | undefined): void
  onRefresh(): void
  t: Translator
}

export function MacroInspectorPanel(props: MacroInspectorPanelProps) {
  const [selectedName, setSelectedName] = useState<string>()
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [query, setQuery] = useState('')
  const selectedEntry = props.inspection?.entries.find(entry => entry.name === selectedName)
  const groups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const entries = (props.inspection?.entries ?? []).filter(entry => !normalized || [
      entry.name,
      entry.value,
      ...entry.candidates.flatMap(candidate => [candidate.sourceLabel, candidate.sourceKind, candidate.value]),
    ].some(value => value?.toLocaleLowerCase().includes(normalized)))
    return (['resolved', 'conflict', 'error'] as const)
      .map(status => ({ status, entries: entries.filter(entry => entry.status === status) }))
      .filter(group => group.entries.length > 0)
  }, [props.inspection, query])
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
      {props.loading ? <div className={styles.emptyState}>{props.t('macroInspector.loading')}</div> : null}
      {!props.loading && !props.inspection ? <div className={styles.emptyState}>{props.t('macroInspector.empty')}</div> : null}
      {props.inspection && props.inspection.entries.length > 0 ? (
        <div className={styles.macroInspectorBody}>
          <MasterDetailWorkbench
            dataComponent="macro-inspector-workbench"
            detailMinWidth={220}
            mobilePane={mobilePane}
            onBack={() => setMobilePane('master')}
            onMobilePaneChange={setMobilePane}
            master={(
              <nav className={styles.macroInspectorMaster} aria-label={props.t('macroInspector.title')}>
                <label className={styles.macroInspectorSearch}>
                  <Search aria-hidden="true" size={14} />
                  <input
                    aria-label={props.t('macroInspector.search')}
                    placeholder={props.t('macroInspector.searchPlaceholder')}
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                </label>
                {groups.map(group => (
                  <section className={styles.macroInspectorGroup} key={group.status}>
                    <header>
                      <span>{statusLabel(group.status, props.t)}</span>
                      <small>{group.entries.length}</small>
                    </header>
                    {group.entries.map(entry => (
                      <button
                        aria-current={entry.name === selectedName ? 'page' : undefined}
                        className={styles.macroInspectorListItem}
                        key={entry.name}
                        type="button"
                        onClick={() => { setSelectedName(entry.name); setMobilePane('detail') }}
                      >
                        <strong>{entry.name}</strong>
                        <span>{entry.candidates.find(candidate => candidate.sourceId === entry.selectedSourceId)?.sourceLabel ?? entry.candidates[0]?.sourceLabel ?? statusLabel(entry.status, props.t)}</span>
                      </button>
                    ))}
                  </section>
                ))}
                {visibleEntries.length === 0 ? <div className={styles.emptyState}>{props.t('macroInspector.searchEmpty')}</div> : null}
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
  const selected = panel.selections[entry.name] ?? entry.selectedSourceId
  const canSelectSource = !panel.readOnly && entry.candidates.length > 1
  return <MacroEntryDetail
    badge={<span className={entry.status === 'resolved' ? styles.statusResolved : entry.status === 'conflict' ? styles.statusConflict : styles.statusError}>{statusLabel(entry.status, panel.t)}</span>}
    name={entry.name}
    t={panel.t}
    title={entry.name}
    value={entry.value}
  >
      {entry.candidates.length > 0 ? (
        <fieldset className={styles.macroSourceList}>
          <legend>{panel.t('macroInspector.source')}</legend>
          {entry.candidates.map(candidate => (
            <label key={candidate.sourceId}>
              {canSelectSource ? <input
                aria-label={panel.t('macroInspector.selectSource', { name: entry.name })}
                checked={selected === candidate.sourceId}
                name={`macro-source-${entry.name}`}
                disabled={panel.loading}
                type="radio"
                onChange={() => panel.onSelectSource(entry.name, candidate.sourceId)}
              /> : <span aria-hidden="true" className={styles.sourceMarker}>{selected === candidate.sourceId ? '●' : '○'}</span>}
              <span>{candidate.sourceLabel}</span>
              <small>{candidate.sourceKind}</small>
              {candidate.value !== undefined ? <code>{candidate.value}</code> : null}
              {candidate.error ? <em>{candidate.error}</em> : null}
            </label>
          ))}
          {canSelectSource && selected ? <button className={styles.iconButton} type="button" disabled={panel.loading} onClick={() => panel.onSelectSource(entry.name, undefined)}>{panel.t('macroInspector.clearSelection')}</button> : null}
        </fieldset>
      ) : null}
  </MacroEntryDetail>
}

function statusLabel(status: MacroInspection['entries'][number]['status'], t: Translator): string {
  return status === 'resolved' ? t('macroInspector.resolved') : status === 'conflict' ? t('macroInspector.conflict') : t('macroInspector.error')
}
