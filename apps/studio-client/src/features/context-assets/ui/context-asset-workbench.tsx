import type { ReactNode } from 'react'
import type { ContextAssetNode } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'
import { flattenContextNodes, type ProjectionOrderEntry } from '../model/projection-order.js'
import { ContextAssetDetail } from './context-asset-detail/context-asset-detail.js'
import { ContextAssetDetailHeader } from './context-asset-detail-header/context-asset-detail-header.js'
import { ContextAssetSearch } from './context-asset-search/context-asset-search.js'
import { ProjectionRunlist } from './projection-runlist/projection-runlist.js'
import {
  canToggleContextAssetEnabled,
  readContextAssetTreeActions,
  renderContextAssetLifecycleIndicator,
  renderContextAssetTreeIcon,
} from './context-asset-tree.js'
import styles from './context-asset-workbench.module.scss'

type MovePosition = 'before' | 'inside' | 'after'
type ProjectionView = { mode: 'asset' | 'projection' | undefined; toggle(): void }

export function ContextAssetExplorer(props: {
  displayNodes: ContextAssetNode[]
  expandedIds?: string[]
  query: string
  projectionEntries?: ProjectionOrderEntry[]
  projectionModuleIds?: string[]
  selectedId?: string
  t: Translator
  variant?: 'tree' | 'flat'
  view?: (node: ContextAssetNode) => ProjectionView
  workspaceId: string
  onAddNode(parentId: string): Promise<string | undefined>
  onDeleteNode(id: string, selectedId?: string): Promise<string | undefined>
  onDuplicateNode(id: string): Promise<string | undefined>
  onExpandedIdsChange(ids: string[]): void
  onMoveNode(draggedId: string, targetId: string, position: MovePosition): void
  onReorderProjection?: (draggedId: string, targetId: string) => void
  onReorderProjectionZone?: (draggedZoneId: string, targetZoneId: string) => void
  onQueryChange(query: string): void
  onSelectId(id?: string): void
  onToggleEnabled(id: string, enabled: boolean): void
}) {
  const projectionModuleIds = new Set(props.projectionModuleIds)
  const selectNode = (node: ContextAssetNode) => props.onSelectId(node.id)
  const selectCreated = async (create: Promise<string | undefined>) => {
    const id = await create
    if (id) props.onSelectId(id)
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
      <div className={styles.explorerContent}>
        {props.displayNodes.map(node => {
          if (projectionModuleIds.has(node.id)) {
            const entryIds = new Set(flattenContextNodes(node.children ?? []).map(child => child.id))
            return (
              <ProjectionRunlist
                entries={(props.projectionEntries ?? []).filter(entry => entryIds.has(entry.node.id))}
                key={node.id}
                onReorder={props.onReorderProjection}
                onReorderZone={props.onReorderProjectionZone}
                onSelect={props.onSelectId}
                selectedId={props.selectedId}
                t={props.t}
              />
            )
          }

          return (
            <FileTree
              key={node.id}
              ariaLabel={props.t('context.explorerLabel')}
              expandedIds={props.expandedIds ?? props.displayNodes.map(item => item.id)}
              getDisclosureLabel={(item, expanded) => props.t(expanded ? 'context.tree.collapse' : 'context.tree.expand', { label: item.label })}
              getDragLabel={item => props.t('context.tree.drag', { label: item.label })}
              getActions={item => readContextAssetTreeActions(item as ContextAssetNode, {
                onAdd: async parentId => selectCreated(props.onAddNode(parentId)),
                onDelete: async id => props.onSelectId(await props.onDeleteNode(id, props.selectedId)),
                onDuplicate: async id => selectCreated(props.onDuplicateNode(id)),
                onToggleEnabled: props.onToggleEnabled,
                t: props.t,
                view: props.view?.(item as ContextAssetNode),
              })}
              isMuted={item => (item as ContextAssetNode).kind === 'entry' && (item as ContextAssetNode).enabled === false}
              moreActionsLabel={props.t('context.actionMore')}
              nodes={[node]}
              onExpandedIdsChange={props.onExpandedIdsChange}
              onMoveNode={props.onMoveNode}
              onSelect={item => selectNode(item as ContextAssetNode)}
              renderIcon={(item, expanded) => renderContextAssetTreeIcon(item as ContextAssetNode, expanded)}
              renderMetaLeading={item => renderContextAssetLifecycleIndicator(item as ContextAssetNode, props.t)}
              selectedId={props.selectedId}
              variant={props.variant}
            />
          )
        })}
      </div>
    </ContextAssetSearch>
  )
}

export function ContextAssetProjectionExplorer(props: {
  entries: ProjectionOrderEntry[]
  nodes: ContextAssetNode[]
  query: string
  selectedId?: string
  t: Translator
  onQueryChange(query: string): void
  onReorder(draggedId: string, targetId: string): void
  onReorderZone(draggedZoneId: string, targetZoneId: string): void
  onSelectId(id: string): void
}) {
  return (
    <ContextAssetSearch
      nodes={props.nodes}
      query={props.query}
      t={props.t}
      onQueryChange={props.onQueryChange}
      onSelect={node => props.onSelectId(node.id)}
    >
      <ProjectionRunlist
        entries={props.entries}
        onReorder={props.onReorder}
        onReorderZone={props.onReorderZone}
        onSelect={props.onSelectId}
        selectedId={props.selectedId}
        t={props.t}
      />
    </ContextAssetSearch>
  )
}

export function ContextAssetEditor(props: {
  activationEditable: boolean
  editorMode: LongTextEditorMode
  metadataOpen: boolean
  node?: ContextAssetNode
  orderEditor?: ReactNode
  t: Translator
  onChangeNode(id: string, partial: Partial<ContextAssetNode>): void
  onCommitNode(id: string, partial: Partial<ContextAssetNode>): void
  onEditorModeChange(mode: LongTextEditorMode): void
  onMetadataOpenChange(open: boolean): void
}) {
  const node = props.node
  return (
    <div className={styles.detailColumn} data-loom-component="context-detail-editor">
      <ContextAssetDetailHeader
        metadataOpen={props.metadataOpen}
        node={node}
        toggleEnabled={canToggleContextAssetEnabled(node)}
        t={props.t}
        onEnabledChange={enabled => {
          if (!node) return
          props.onChangeNode(node.id, { enabled })
          props.onCommitNode(node.id, { enabled })
        }}
        onMetadataOpenChange={props.onMetadataOpenChange}
      />
      {!node ? <div className={styles.emptyState}>{props.t('context.emptyBody')}</div> : node.kind === 'order' ? props.orderEditor : (
        <ContextAssetDetail
          activationEditable={props.activationEditable}
          metadataOpen={props.metadataOpen}
          editorMode={props.editorMode}
          node={node}
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
