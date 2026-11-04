import { lazy, Suspense, createContext, useContext, useMemo, useState, type ReactNode, type RefObject } from 'react'
import { ChevronRight, FileText } from 'lucide-react'
import { Button, Dialog, SearchField, Tabs } from '@loom-studio/ui'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ObservationSource } from '../model/observation-view.js'
import { buildSourceTree, filterSourceTree, sortSourceTreeByTokens, sourceDisplayTitle, type SourceTreeNode } from '../model/observation-source-tree.js'
import { ObservationDialogButton } from './observation-dialog.js'
import { ObservationSourceTokens } from './observation-source-tokens.js'
import { useTokenCounts } from '../../../shared/tokenizer/use-token-counts.js'
import { sourceTokenParts, sumTokenParts } from '../model/observation-token-view.js'
import { ObservationRoleBadge, ToolExchangeStatus } from './observation-messages.js'
import { ReadableText } from './observation-content.js'
import styles from './observability-workbench.module.scss'

const SourceFilterActive = createContext(false)
const SourceTokenCounts = createContext(new Map<string, number | undefined>())

const ReadOnlyDiff = lazy(async () => ({ default: (await import('../../../shared/ui/read-only-diff/read-only-diff.js')).ReadOnlyDiff }))

export function ObservationSources({ sources, selectedId, onSelect, t, renderSourceIcon }: {
  renderSourceIcon: SourceIconRenderer; sources: ObservationSource[]; selectedId?: string; onSelect(id?: string): void; scroller: RefObject<HTMLElement | null>; t: Translator
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('order')
  const [dimension, setDimension] = useState<'activation' | 'anchors'>('anchors')
  const [filter, setFilter] = useState<string>()
  const tree = useMemo(() => buildSourceTree(sources, t('observation.otherSources')), [sources, t])
  const sourceTitles = new Map(sources.map(source => [source.id, sourceDisplayTitle(source)]))
  const selected = sources.find(source => source.id === selectedId)
  const parts = sourceTokenParts({ sources })
  const texts = [...new Set(parts.map(part => part.text))]
  const counted = useTokenCounts(texts, 'observation-source-tokens')
  const counts = new Map(texts.map((text, index) => [text, counted.currentCounts[index]]))
  const sourceCounts = new Map(sources.map(source => [source.id, source.injections?.length ? sumTokenParts(parts.filter(part => part.sourceId === source.id), counts) : undefined]))
  const sourceIds = filter === undefined ? undefined : new Set(parts.filter(part => (dimension === 'anchors' ? part.anchor ?? 'unassigned' : ['keyword', 'condition', 'all'].includes(part.activation ?? '') ? 'conditional' : part.activation ?? 'unassigned') === filter).map(part => part.sourceId!))
  const visibleTree = query.trim() || filter !== undefined ? filterSourceTree(tree, query, sourceIds, dimension === 'anchors' ? filter : undefined) : tree
  const sortedTree = sort === 'tokens' ? sortSourceTreeByTokens(visibleTree, sourceCounts) : visibleTree
  return <SourceTokenCounts.Provider value={sourceCounts}><SourceFilterActive.Provider value={!!query.trim() || filter !== undefined}>
    <div className={styles.sourceTree}>
      <ObservationSourceTokens sources={sources} counts={counts} pending={counted.pending} error={counted.error} dimension={dimension} filter={filter} onDimensionChange={value => { setDimension(value); setFilter(undefined) }} onFilterChange={setFilter} t={t} />
      <div className={styles.sectionHeading}><h3>{t('observation.sources')}</h3><small>{t('observation.injectedCount', { count: sources.filter(source => source.included ?? source.active).length })}</small></div>
      <p className={styles.hint}>{t('observation.sourceTreeHint')}</p>
      <div className={styles.messageControls}><SearchField aria-label={t('observation.searchSources')} placeholder={t('observation.searchSources')} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel={t('observation.clearSearch')} /><Tabs size="compact" ariaLabel={t('observation.messageSort')} activeId={sort} onChange={setSort} items={[{ id: 'order', label: t('observation.sourceOrder') }, { id: 'tokens', label: t('observation.tokenOrder') }]} />{filter !== undefined && <Button size="small" onClick={() => setFilter(undefined)}>{t('observation.clearTokenFilter')}</Button>}</div>
      <div className={styles.sourceTreeViewport}>
      {!visibleTree.length && <p className={styles.hint} role="status">{t('observation.noMatches')}</p>}
      <SourceBranches key={`${dimension}:${filter ?? ''}:${query}`} renderSourceIcon={renderSourceIcon} nodes={sortedTree} onSelect={onSelect} t={t} />
      </div>
    </div>
    <Dialog open={!!selected} onClose={() => onSelect(undefined)} title={selected ? sourceDisplayTitle(selected) : t('observation.sources')} closeLabel={t('observation.close')} className={styles.inspectorDialog} closeOnBackdrop>
    {selected && <div className={styles.sourceDetail}>
      <SourceRoles source={selected} t={t} />
      <p className={styles.hint}>{selected.path}</p>
      {!(selected.included ?? selected.active) && <p className={styles.hint}>{t('observation.notIncluded')} · {selected.reason}</p>}
      {(selected.injections?.length ? selected.injections : (selected.included ?? selected.active) ? [{ id: selected.id, rendered: selected.rendered }] : []).map(injection => <section className={styles.injection} key={injection.id}>
        <div className={styles.sectionHeading}><h4>{t('observation.rendered')}</h4><small>{[injection.targetAnchorId && (sourceTitles.get(injection.targetAnchorId) ?? (injection.targetAnchorId.startsWith('@') ? injection.targetAnchorId : t('observation.missing'))), injection.role, injection.messageIndex !== undefined && t('observation.messageNumber', { count: injection.messageIndex + 1 })].filter(Boolean).join(' · ')}</small></div>
        <ReadableText text={injection.rendered} t={t} defaultExpanded />
      </section>)}
      <SourceOriginal key={selected.id} source={selected} t={t} />
    </div>}
    </Dialog>
  </SourceFilterActive.Provider></SourceTokenCounts.Provider>
}

function SourceOriginal({ source, t }: { source: ObservationSource; t: Translator }) {
  return <ObservationDialogButton title={t('observation.originalAndChanges')} description={sourceDisplayTitle(source)} t={t}>{() => <Suspense fallback={<p>{t('observation.loading')}</p>}>
    {(source.included ?? source.active) ? (source.injections?.length ? source.injections : [{ id: source.id, original: source.originalRecorded === false ? undefined : source.original, rendered: source.rendered }]).map(item => item.original === undefined && source.originalRecorded === false ? <p className={styles.hint} key={item.id}>{t('observation.originalMissing')}</p> : <ReadOnlyDiff key={item.id} before={item.original ?? source.original} after={item.rendered} t={t} flow defaultExpanded />) : <ReadableText text={source.original} t={t} defaultExpanded />}
  </Suspense>}</ObservationDialogButton>
}

function SourceBranches({ nodes, onSelect, t, renderSourceIcon }: { renderSourceIcon: SourceIconRenderer; nodes: SourceTreeNode[]; onSelect(id: string): void; t: Translator }) {
  const filterActive = useContext(SourceFilterActive)
  const included = nodes.filter(node => node.included)
  const unused = nodes.filter(node => !node.included)
  return <>
    {included.map(node => <SourceBranch renderSourceIcon={renderSourceIcon} key={node.id} node={node} onSelect={onSelect} t={t} />)}
    {!!unused.length && <details className={styles.unusedSources} open={filterActive || undefined}><summary>{t('observation.unusedCount', { count: unused.length })}</summary>
      {unused.map(node => <SourceBranch renderSourceIcon={renderSourceIcon} key={node.id} node={node} onSelect={onSelect} t={t} />)}
    </details>}
  </>
}

function SourceBranch({ node, onSelect, t, renderSourceIcon }: { renderSourceIcon: SourceIconRenderer; node: SourceTreeNode; onSelect(id: string): void; t: Translator }) {
  const [open, setOpen] = useState(true)
  if (node.children.length) return <details className={styles.sourceGroup} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={13} />{renderSourceIcon({ source: node.source, expanded: open, t })}<span>{node.title}</span><small>{t('observation.injectedCount', { count: node.count })}</small></summary>
    <div className={styles.sourceChildren}>
      {node.source?.included && <button className={styles.sourceLeaf} type="button" onClick={() => onSelect(node.source!.id)}><FileText size={14} />{t('observation.ownContent')}<SourceTokens source={node.source} t={t} /><ChevronRight size={12} /></button>}
      <SourceBranches renderSourceIcon={renderSourceIcon} nodes={node.children} onSelect={onSelect} t={t} />
    </div>
  </details>
  return <button className={styles.sourceLeaf} type="button" onClick={() => node.source && onSelect(node.source.id)}>
    {renderSourceIcon({ source: node.source, expanded: false, t })}<span>{node.title}<SourceRoles source={node.source} t={t} />{!node.included && <small>{node.source?.reason}</small>}</span><SourceTokens source={node.source} t={t} /><ChevronRight size={12} />
  </button>
}


type SourceIconRenderer = (input: { source?: ObservationSource; expanded: boolean; t: Translator }) => ReactNode

function SourceRoles({ source, t }: { source?: ObservationSource; t: Translator }) {
  const roles = [...new Set(source?.injections?.flatMap(item => item.role ? [item.role] : []) ?? [])]
  return roles.length ? <span className={styles.sourceRoles}>{roles.map(role => <ObservationRoleBadge key={role} role={role} t={t} />)}{[...new Set(source?.exchanges?.map(exchange => exchange.status) ?? [])].map(status => <ToolExchangeStatus key={status} status={status} t={t} />)}</span> : null
}

function SourceTokens({ source, t }: { source?: ObservationSource; t: Translator }) {
  const counts = useContext(SourceTokenCounts)
  if (!source?.injections?.length) return null
  const count = counts.get(source.id)
  return <small className={styles.sourceTokenCount}>{count === undefined ? t('observation.tokenUnknown') : `≈ ${count.toLocaleString()} tokens`}</small>
}
