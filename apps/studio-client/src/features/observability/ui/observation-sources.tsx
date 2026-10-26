import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ArrowLeft, ChevronRight, FileText } from 'lucide-react'
import { Button } from '@loom-studio/ui'
import type { Translator } from '../../../shared/i18n/index.js'
import type { ObservationSource } from '../model/observation-view.js'
import { buildSourceTree, sourceDisplayTitle, type SourceTreeNode } from '../model/observation-source-tree.js'
import { ObservationDialogButton } from './observation-dialog.js'
import { ReadableText } from './observation-content.js'
import styles from './observability-workbench.module.scss'

const ReadOnlyDiff = lazy(async () => ({ default: (await import('../../../shared/ui/read-only-diff/read-only-diff.js')).ReadOnlyDiff }))

export function ObservationSources({ sources, selectedId, onSelect, scroller, t, renderSourceIcon }: {
  renderSourceIcon: SourceIconRenderer; sources: ObservationSource[]; selectedId?: string; onSelect(id?: string): void; scroller: RefObject<HTMLElement | null>; t: Translator
}) {
  const tree = useMemo(() => buildSourceTree(sources, t('observation.otherSources')), [sources, t])
  const sourceTitles = new Map(sources.map(source => [source.id, sourceDisplayTitle(source)]))
  const selected = sources.find(source => source.id === selectedId)
  const treeRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const scrollPosition = useRef<number | undefined>(undefined)
  const lastButton = useRef<HTMLElement | null>(null)
  function selectSource(id: string) {
    // Capture before hiding the tree can clamp the scroll position to the shorter detail.
    scrollPosition.current = scroller.current?.scrollTop
    lastButton.current = treeRef.current?.contains(document.activeElement) ? document.activeElement as HTMLElement : null
    onSelect(id)
  }
  useLayoutEffect(() => {
    if (selected) {
      detailRef.current?.focus({ preventScroll: true })
      detailRef.current?.scrollIntoView({ block: 'start' })
    } else if (scrollPosition.current !== undefined) {
      if (scroller.current) scroller.current.scrollTop = scrollPosition.current
      lastButton.current?.focus({ preventScroll: true })
      scrollPosition.current = undefined
    }
  }, [selected?.id, scroller])
  return <>
    <div ref={treeRef} hidden={!!selected} className={styles.sourceTree}>
      <div className={styles.sectionHeading}><h3>{t('observation.sources')}</h3><small>{t('observation.injectedCount', { count: sources.filter(source => source.included ?? source.active).length })}</small></div>
      <p className={styles.hint}>{t('observation.sourceTreeHint')}</p>
      <SourceBranches renderSourceIcon={renderSourceIcon} nodes={tree} onSelect={selectSource} t={t} />
    </div>
    {selected && <div ref={detailRef} tabIndex={-1} className={styles.sourceDetail}>
      <div className={styles.sourceBreadcrumb}><Button size="small" onClick={() => onSelect(undefined)}><ArrowLeft size={14} />{t('observation.returnSources')}</Button><ChevronRight size={12} /><span>{sourceDisplayTitle(selected)}</span></div>
      <h3>{sourceDisplayTitle(selected)}</h3>
      <p className={styles.hint}>{selected.path}</p>
      {!(selected.included ?? selected.active) && <p className={styles.hint}>{t('observation.notIncluded')} · {selected.reason}</p>}
      {(selected.injections?.length ? selected.injections : (selected.included ?? selected.active) ? [{ id: selected.id, rendered: selected.rendered }] : []).map(injection => <section className={styles.injection} key={injection.id}>
        <div className={styles.sectionHeading}><h4>{t('observation.rendered')}</h4><small>{[injection.targetAnchorId && (sourceTitles.get(injection.targetAnchorId) ?? (injection.targetAnchorId.startsWith('@') ? injection.targetAnchorId : t('observation.missing'))), injection.role, injection.messageIndex !== undefined && t('observation.messageNumber', { count: injection.messageIndex + 1 })].filter(Boolean).join(' · ')}</small></div>
        <ReadableText text={injection.rendered} t={t} defaultExpanded />
      </section>)}
      <SourceOriginal key={selected.id} source={selected} t={t} />
    </div>}
  </>
}

function SourceOriginal({ source, t }: { source: ObservationSource; t: Translator }) {
  return <ObservationDialogButton title={t('observation.originalAndChanges')} description={sourceDisplayTitle(source)} t={t}>{() => <Suspense fallback={<p>{t('observation.loading')}</p>}>
    {(source.included ?? source.active) ? (source.injections?.length ? source.injections : [{ id: source.id, original: source.originalRecorded === false ? undefined : source.original, rendered: source.rendered }]).map(item => item.original === undefined && source.originalRecorded === false ? <p className={styles.hint} key={item.id}>{t('observation.originalMissing')}</p> : <ReadOnlyDiff key={item.id} before={item.original ?? source.original} after={item.rendered} t={t} flow defaultExpanded />) : <ReadableText text={source.original} t={t} defaultExpanded />}
  </Suspense>}</ObservationDialogButton>
}

function SourceBranches({ nodes, onSelect, t, renderSourceIcon }: { renderSourceIcon: SourceIconRenderer; nodes: SourceTreeNode[]; onSelect(id: string): void; t: Translator }) {
  const included = nodes.filter(node => node.included)
  const unused = nodes.filter(node => !node.included)
  return <>
    {included.map(node => <SourceBranch renderSourceIcon={renderSourceIcon} key={node.id} node={node} onSelect={onSelect} t={t} />)}
    {!!unused.length && <details className={styles.unusedSources}><summary>{t('observation.unusedCount', { count: unused.length })}</summary>
      {unused.map(node => <SourceBranch renderSourceIcon={renderSourceIcon} key={node.id} node={node} onSelect={onSelect} t={t} />)}
    </details>}
  </>
}

function SourceBranch({ node, onSelect, t, renderSourceIcon }: { renderSourceIcon: SourceIconRenderer; node: SourceTreeNode; onSelect(id: string): void; t: Translator }) {
  const [open, setOpen] = useState(true)
  if (node.children.length) return <details className={styles.sourceGroup} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><ChevronRight size={13} />{renderSourceIcon({ source: node.source, expanded: open, t })}<span>{node.title}</span><small>{t('observation.injectedCount', { count: node.count })}</small></summary>
    <div className={styles.sourceChildren}>
      {node.source?.included && <button className={styles.sourceLeaf} type="button" onClick={() => onSelect(node.source!.id)}><FileText size={14} />{t('observation.ownContent')}<ChevronRight size={12} /></button>}
      <SourceBranches renderSourceIcon={renderSourceIcon} nodes={node.children} onSelect={onSelect} t={t} />
    </div>
  </details>
  return <button className={styles.sourceLeaf} type="button" onClick={() => node.source && onSelect(node.source.id)}>
    {renderSourceIcon({ source: node.source, expanded: false, t })}<span>{node.title}{!node.included && <small>{node.source?.reason}</small>}</span><ChevronRight size={12} />
  </button>
}


type SourceIconRenderer = (input: { source?: ObservationSource; expanded: boolean; t: Translator }) => ReactNode
