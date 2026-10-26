import { isPromptMessageSequence } from '@loom-studio/shared'
import { findContextAssetPath, flattenContextAssetNodes } from '../model/context-asset-tree.js'
import { canMoveContextAssetNode } from '../model/tree-ops.js'
import { SearchHighlight } from '../../../shared/ui/search-highlight.js'
import type { SearchReveal } from '../../../shared/lib/search-match.js'
import { useEffect, useRef, useState } from 'react'
import { ToggleLeft, ToggleRight } from 'lucide-react'
import type { ContextAssetNode, PromptResource } from '../../../entities/index.js'
import { useRestorableScroll } from '../../../shared/hooks/use-restorable-scroll.js'
import { formatNumber, type Translator } from '../../../shared/i18n/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'
import { ContextAssetDetail, isReadOnlyDetailNode } from './context-asset-detail/context-asset-detail.js'
import { ContextAssetDetailHeader } from './context-asset-detail-header/context-asset-detail-header.js'
import { ContextAssetSearch } from './context-asset-search/context-asset-search.js'
import {
  canToggleContextAssetEnabled,
  isReadOnlyContextAssetTreeNode,
  readContextAssetTreeActions,
  renderContextAssetLifecycleIndicator,
  renderContextAssetTreeIcon,
  resolveVirtualDisplayName,
} from './context-asset-tree.js'
import styles from './context-asset-workbench.module.scss'
import { ResourceTokenSummary, TextTokenSummary } from './resource-token-summary.js'
import type { ResourceTokenSnapshot } from '../model/use-resource-token-snapshot.js'

type MovePosition = 'before' | 'inside' | 'after'

function readAnchorId(node: ContextAssetNode): string | undefined {
  if (node.kind !== 'virtual') return undefined
  return node.capabilities?.targetAnchorId || (node.label.startsWith('@') ? node.label : undefined)
}

function readTreeLabel(node: ContextAssetNode): string {
  return readAnchorId(node) ?? resolveVirtualDisplayName(node.label, node.kind)
}

export function ContextAssetExplorer(props: {
  tokenSnapshot?: ResourceTokenSnapshot
  active?: boolean
  highlightQuery?: string
  highlightMessages?: boolean
  formatMeta?: (node: ContextAssetNode) => string | undefined
  displayNodes: ContextAssetNode[]
  expandedIds?: string[]
  query: string
  selectedId?: string
  t: Translator
  variant?: 'tree' | 'flat'
  virtualized?: boolean
  scrollKey: string
  workspaceId: string
  onAddNode(parentId: string): Promise<string | undefined>
  onAddFolderNode?(parentId: string): Promise<string | undefined>
  onAddAnchorNode?(parentId: string): Promise<string | undefined>
  onAddMessageSequenceNode?(parentId: string): Promise<string | undefined>
  onAddMessageBlockNode?(parentId: string, role?: 'system' | 'user' | 'assistant'): Promise<string | undefined>
  onDeleteNode(id: string, selectedId?: string): Promise<string | undefined>
  onDuplicateNode(id: string): Promise<string | undefined>
  onExpandedIdsChange(ids: string[]): void
  onMoveNode(draggedId: string, targetId: string, position: MovePosition): void
  onQueryChange(query: string): void
  onRenameNode?(id: string, newLabel: string): Promise<void>
  onSelectId(id?: string): void
  onToggleEnabled(id: string, enabled: boolean): void
  onBatchToggleEnabled?(ids: string[], enabled: boolean): Promise<{ failedIds: string[]; error?: string }>
  onChangeRole?(id: string, role: 'system' | 'user' | 'assistant'): void
}) {
  const [editingId, setEditingId] = useState<string>()
  const [error, setError] = useState<string>()
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const scroll = useRestorableScroll<HTMLDivElement>(props.scrollKey)
  const selectNode = (node: ContextAssetNode) => props.onSelectId?.(node.id)
  const selectCreated = async (create: Promise<string | undefined>) => {
    setError(undefined)
    try {
      const id = await create
      if (id && mountedRef.current) {
        props.onSelectId(id)
        setEditingId(id)
      }
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    }
  }
  const deleteNode = async (id: string) => {
    setError(undefined)
    try {
      const selectedId = await props.onDeleteNode(id, props.selectedId)
      if (mountedRef.current) props.onSelectId(selectedId)
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    }
  }
  const handleEditCommit = async (id: string, newLabel: string) => {
    setError(undefined)
    try {
      await props.onRenameNode?.(id, newLabel)
      if (mountedRef.current) setEditingId(current => current === id ? undefined : current)
    } catch (caught) {
      if (mountedRef.current) setError(caught instanceof Error ? caught.message : String(caught))
    }
  }
  const handleEditCancel = () => {
    setEditingId(undefined)
  }
  return (
    <ContextAssetSearch
      key={props.workspaceId}
      nodes={props.displayNodes}
      query={props.query}
      t={props.t}
      onQueryChange={props.onQueryChange}
      onSelect={selectNode}
    >
      <div ref={scroll.attach} className={styles.explorerContent} onScroll={scroll.onScroll}>
        {error ? <p role="alert">{error}</p> : null}
        <FileTree
          key={props.workspaceId}
          active={props.active}
          canBatchSelect={item => !isReadOnlyContextAssetTreeNode(item as ContextAssetNode) && !['folder', 'module', 'slot'].includes(item.kind ?? '')}
          getBatchActions={selected => [
            ...(props.onBatchToggleEnabled ? ([true, false] as const).map(enabled => ({
              id: enabled ? 'enable' : 'disable', label: props.t(enabled ? 'common.batchEnable' : 'common.batchDisable'),
              disabled: !selected.every(node => canToggleContextAssetEnabled(node as ContextAssetNode)),
              run: (nodes: typeof selected) => props.onBatchToggleEnabled!(nodes.map(node => node.id), enabled),
            })) : []),
            { id: 'delete', label: props.t('common.batchDelete'), tone: 'danger', confirm: true, run: async nodes => {
              const failedIds: string[] = []
              const errors: string[] = []
              let selectedId = props.selectedId
              for (const node of nodes) {
                try { selectedId = await props.onDeleteNode(node.id, selectedId) }
                catch (cause) { failedIds.push(node.id); errors.push(`${node.label}: ${cause instanceof Error ? cause.message : String(cause)}`) }
              }
              if (mountedRef.current) props.onSelectId(selectedId)
              return { failedIds, error: errors.join('\n') }
            } },
          ]}
          highlightMessages={props.highlightMessages}
          renderLabel={node => (
            <span className={readAnchorId(node as ContextAssetNode) ? styles.treeAnchorId : undefined}>
              <SearchHighlight text={readTreeLabel(node as ContextAssetNode)} query={props.highlightQuery ?? ''} />
            </span>
          )}
          editingId={editingId}
          onEditCommit={handleEditCommit}
          onEditCancel={handleEditCancel}
          ariaLabel={props.t('context.explorerLabel')}
          expandedIds={props.expandedIds ?? []}
          getDisclosureLabel={(item, expanded) => props.t(expanded ? 'context.tree.collapse' : 'context.tree.expand', { label: item.label })}
          getDragLabel={item => props.t('context.tree.drag', { label: item.label })}
          getVirtualScrollElement={() => scroll.ref.current}
          getActions={item => {
            const path = findContextAssetPath(props.displayNodes, item.id)
            const inheritedCategory = [...path].reverse().find(node => node.category)?.category
            const category = inheritedCategory === 'preset-root' ? 'preset' : inheritedCategory
            const root = path[0]
            return readContextAssetTreeActions({ ...item, category, ...((item as ContextAssetNode).category === 'preset-root' ? { kind: 'module' } : {}) } as ContextAssetNode, {
              insideMessage: path.some(node => node.kind === 'message'),
              hasMessageSequence: root ? flattenContextAssetNodes([root]).some(isPromptMessageSequence) : false,
              onAddMessageSequence: props.onAddMessageSequenceNode ? async parentId => selectCreated(props.onAddMessageSequenceNode!(parentId)) : undefined,
              onAdd: async parentId => selectCreated(props.onAddNode(parentId)),
              onAddFolder: props.onAddFolderNode ? async parentId => selectCreated(props.onAddFolderNode!(parentId)) : undefined,
              onAddAnchor: props.onAddAnchorNode ? async parentId => selectCreated(props.onAddAnchorNode!(parentId)) : undefined,
              onAddMessageBlock: props.onAddMessageBlockNode ? async parentId => selectCreated(props.onAddMessageBlockNode!(parentId)) : undefined,
              onDelete: deleteNode,
              onDuplicate: async id => selectCreated(props.onDuplicateNode(id)),
              onRename: id => setEditingId(id),
              onChangeRole: props.onChangeRole,
              t: props.t,
            })
          }}
          hasActions={item => !isReadOnlyContextAssetTreeNode(item as ContextAssetNode)}
          isMuted={item => (item as ContextAssetNode).kind === 'entry' && (item as ContextAssetNode).enabled === false}
          formatLabel={node => readTreeLabel(node as ContextAssetNode)}
          formatMeta={node => {
            const meta = props.formatMeta?.(node as ContextAssetNode)
            const count = props.tokenSnapshot?.summary?.nodes.get(node.id)
            const countLabel = count && (node as ContextAssetNode).kind !== 'virtual'
              ? `${formatNumber(count.enabled)} tokens`
              : undefined
            return [meta, countLabel].filter(Boolean).join(' · ') || undefined
          }}
          moreActionsLabel={props.t('context.actionMore')}
          nodes={props.displayNodes}
          onExpandedIdsChange={props.onExpandedIdsChange}
          canDrop={(sourceId, targetId, position) => canMoveContextAssetNode(props.displayNodes, sourceId, targetId, position)}
          canDrag={node => node.kind !== 'module' && (node as ContextAssetNode).category !== 'preset-root' && !isReadOnlyContextAssetTreeNode(node as ContextAssetNode)}
          onMoveNode={props.onMoveNode}
          onSelect={item => selectNode(item as ContextAssetNode)}
          renderIcon={(item, expanded) => renderContextAssetTreeIcon(item as ContextAssetNode, expanded)}
          renderLabelSuffix={item => {
            const node = item as ContextAssetNode
            const anchorId = readAnchorId(node)
            if (!anchorId || anchorId === node.label) return null
            return <span className={styles.treeAnchorBadge} title={node.label}><SearchHighlight text={node.label} query={props.highlightQuery ?? ''} /></span>
          }}
          renderMetaLeading={item => renderContextAssetLifecycleIndicator(item as ContextAssetNode, props.t)}
          renderTrailing={item => {
            const node = item as ContextAssetNode
            if (!canToggleContextAssetEnabled(node)) return null
            const enabled = node.enabled !== false
            const label = props.t(enabled ? 'context.actionDisable' : 'context.actionEnable')
            return <button type="button" className={styles.treeToggle} aria-label={`${label} ${node.label}`}
              aria-pressed={enabled} title={label} onClick={event => {
                event.stopPropagation()
                props.onToggleEnabled(node.id, !enabled)
              }}>
              {enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
            </button>
          }}
          selectedId={props.selectedId}
          variant={props.variant}
          virtualized={props.virtualized}
        />
      </div>
    </ContextAssetSearch>
  )
}


export function ContextAssetEditor(props: {
  tokenNode?: ContextAssetNode
  tokenIncomplete?: boolean
  activationEditable: boolean
  allowTargetAnchor?: boolean
  compactVirtualNotes?: boolean
  editorMode: LongTextEditorMode
  revealMatch?: SearchReveal
  metadataOpen: boolean
  node?: ContextAssetNode
  presets?: PromptResource[]
  pathNodes?: ContextAssetNode[]
  t: Translator
  onChangeNode(id: string, partial: Partial<ContextAssetNode>): void
  onCommitNode(id: string, partial: Partial<ContextAssetNode>): void
  onEditorModeChange(mode: LongTextEditorMode): void
  onMetadataOpenChange(open: boolean): void
  onSelectNodeId?(id: string): void
}) {
  const node = props.node
  const pathNodes = props.pathNodes ?? []
  const sourceTokenNode = props.tokenNode ?? node
  const tokenNode = sourceTokenNode?.kind === 'script' ? { ...sourceTokenNode, kind: 'entry' } : sourceTokenNode
  const countRoot = tokenNode ? pathNodes.filter(parent => parent.id !== node?.id)
    .reduceRight((child, parent) => ({ ...parent, children: [child] }), tokenNode) : undefined
  const tokenScope = `${node?.id}:${pathNodes.map(item => item.id).join('/')}`
  const tokenSummary = node?.kind === 'entry' || node?.kind === 'script'
    ? <TextTokenSummary text={node.body ?? ''} scope={tokenScope} t={props.t} />
    : countRoot ? <ResourceTokenSummary roots={[countRoot]}
      scope={tokenScope} t={props.t} incomplete={props.tokenIncomplete} /> : undefined

  return (
    <div className={styles.detailColumn} data-loom-component="context-detail-editor">
      <ContextAssetDetailHeader
        metadataOpen={props.metadataOpen}
        node={node}
        pathNodes={pathNodes}
        readOnly={node ? isReadOnlyDetailNode(node) : false}
        toggleEnabled={canToggleContextAssetEnabled(node)}
        t={props.t}
        onChangeLabel={label => {
          if (!node) return
          props.onChangeNode(node.id, { label })
        }}
        onCommitLabel={label => {
          if (!node) return
          props.onCommitNode(node.id, { label })
        }}
        onEnabledChange={enabled => {
          if (!node) return
          props.onChangeNode(node.id, { enabled })
          props.onCommitNode(node.id, { enabled })
        }}
        onMetadataOpenChange={props.onMetadataOpenChange}
      />
      {!node ? <div className={styles.emptyState}>{props.t('context.emptyBody')}</div> : (
        <ContextAssetDetail
          headerExtra={tokenSummary}
          activationEditable={props.activationEditable}
          allowTargetAnchor={props.allowTargetAnchor}
          compactVirtualNotes={props.compactVirtualNotes}
          metadataOpen={props.metadataOpen}
          editorMode={props.editorMode}
          revealMatch={props.revealMatch}
          node={node}
          presets={props.presets}
          onChangeNode={partial => props.onChangeNode(node.id, partial)}
          onCommitNode={partial => props.onCommitNode(node.id, partial)}
          onMetadataOpenChange={props.onMetadataOpenChange}
          onEditorModeChange={props.onEditorModeChange}
          t={props.t}
        />
      )}
    </div>
  )
}
