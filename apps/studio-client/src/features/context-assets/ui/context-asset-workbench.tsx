import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ContextAssetNode, PromptCompositionItem } from '../../../entities/index.js'
import type { Translator } from '../../../shared/i18n/index.js'
import { FileTree } from '../../../shared/ui/file-tree/file-tree.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'
import { flattenContextNodes, type ProjectionOrderEntry, type ProjectionZoneDefinition } from '../model/projection-order.js'
import { ContextAssetDetail } from './context-asset-detail/context-asset-detail.js'
import { ContextAssetDetailHeader } from './context-asset-detail-header/context-asset-detail-header.js'
import { ContextAssetSearch } from './context-asset-search/context-asset-search.js'
import { ProjectionRunlist } from './projection-runlist/projection-runlist.js'
import type { ProviderToolSurfaceItem } from '../model/preset-tool-projection.js'
import {
  canToggleContextAssetEnabled,
  readContextAssetTreeActions,
  renderContextAssetLifecycleIndicator,
  renderContextAssetTreeIcon,
} from './context-asset-tree.js'
import styles from './context-asset-workbench.module.scss'

type MovePosition = 'before' | 'inside' | 'after'

export function ContextAssetExplorer(props: {
  displayNodes: ContextAssetNode[]
  expandedIds?: string[]
  query: string
  projectionEntries?: ProjectionOrderEntry[]
  projectionModuleIds?: string[]
  selectedId?: string
  selectedZoneId?: string
  t: Translator
  zoneDefinitions?: ProjectionZoneDefinition[]
  variant?: 'tree' | 'flat'
  workspaceId: string
  onAddNode(parentId: string): Promise<string | undefined>
  onAddFolderNode?(parentId: string): Promise<string | undefined>
  onDeleteNode(id: string, selectedId?: string): Promise<string | undefined>
  onDuplicateNode(id: string): Promise<string | undefined>
  onExpandedIdsChange(ids: string[]): void
  onMoveNode(draggedId: string, targetId: string, position: MovePosition): void
  onReorderProjection?: (draggedId: string, targetId: string) => void
  onReorderProjectionZone?: (draggedZoneId: string, targetZoneId: string) => void
  onQueryChange(query: string): void
  onRenameNode?(id: string, newLabel: string): Promise<void>
  onSelectId(id?: string): void
  onToggleEnabled(id: string, enabled: boolean): void
}) {
  const [editingId, setEditingId] = useState<string>()
  const projectionModuleIds = new Set(props.projectionModuleIds)
  const selectNode = (node: ContextAssetNode) => props.onSelectId(node.id)
  const selectCreated = async (create: Promise<string | undefined>) => {
    const id = await create
    if (id) {
      props.onSelectId(id)
      setEditingId(id)
    }
  }
  const handleEditCommit = async (id: string, newLabel: string) => {
    setEditingId(undefined)
    if (props.onRenameNode) {
      await props.onRenameNode(id, newLabel)
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
      <div className={styles.explorerContent}>
        {props.displayNodes.map(node => {
          if (projectionModuleIds.has(node.id)) {
            const entryIds = new Set(flattenContextNodes(node.children ?? []).map(child => child.id))
            return (
              <ProjectionRunlist
                entries={(props.projectionEntries ?? []).filter(entry => entryIds.has(entry.node.id))}
                key={node.id}
                onDeleteNode={async id => props.onSelectId(await props.onDeleteNode(id, props.selectedId))}
                onDuplicateNode={async id => selectCreated(props.onDuplicateNode(id))}
                onRename={id => setEditingId(id)}
                onReorder={props.onReorderProjection}
                onReorderZone={props.onReorderProjectionZone}
                onSelect={props.onSelectId}
                onToggleEnabled={props.onToggleEnabled}
                selectedId={props.selectedId}
                t={props.t}
              />
            )
          }

          return (
            <FileTree
              key={node.id}
              editingId={editingId}
              onEditCommit={handleEditCommit}
              onEditCancel={handleEditCancel}
              ariaLabel={props.t('context.explorerLabel')}
              expandedIds={props.expandedIds ?? props.displayNodes.map(item => item.id)}
              getDisclosureLabel={(item, expanded) => props.t(expanded ? 'context.tree.collapse' : 'context.tree.expand', { label: item.label })}
              getDragLabel={item => props.t('context.tree.drag', { label: item.label })}
              getActions={item => readContextAssetTreeActions(item as ContextAssetNode, {
                onAdd: async parentId => selectCreated(props.onAddNode(parentId)),
                onAddFolder: props.onAddFolderNode ? async parentId => selectCreated(props.onAddFolderNode!(parentId)) : undefined,
                onDelete: async id => props.onSelectId(await props.onDeleteNode(id, props.selectedId)),
                onDuplicate: async id => selectCreated(props.onDuplicateNode(id)),
                onRename: id => setEditingId(id),
                onToggleEnabled: props.onToggleEnabled,
                t: props.t,
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
  compositionItems?: PromptCompositionItem[]
  entries: ProjectionOrderEntry[]
  providerTools?: ProviderToolSurfaceItem[]
  onSelectProviderTool?: (toolId: string) => void
  nodes: ContextAssetNode[]
  query: string
  selectedId?: string
  selectedProviderToolId?: string
  selectedZoneId?: string
  t: Translator
  zoneDefinitions?: ProjectionZoneDefinition[]
  onAddEntryInZone?: (zoneId: string) => void
  onAddDirectEntry?: (blockId: string) => void
  onAddMessageBlock?: () => void
  onAddSlot?: (blockId: string) => void
  onAddZoneToMessageBlock?: (blockId: string) => void
  onDeleteCompositionItem?: (id: string) => void
  onMoveCompositionItem?: (id: string, direction: 'up' | 'down') => void
  onDropCompositionItem?: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void
  onAddZone?: (afterZoneId?: string) => void
  onDeleteNode?: (id: string) => Promise<void | string | undefined>
  onDeleteZone?: (zoneId: string) => void
  onDuplicateNode?: (id: string) => Promise<void | string | undefined>
  onQueryChange(query: string): void
  onRename?: (id: string) => void
  onReorder(draggedId: string, targetId: string): void
  onReorderZone(draggedZoneId: string, targetZoneId: string): void
  onSelectId(id: string): void
  onSelectZone?(zoneId: string): void
  onToggleEnabled?: (id: string, enabled: boolean) => void
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
        compositionItems={props.compositionItems}
        entries={props.entries}
        providerTools={props.providerTools}
        onAddDirectEntry={props.onAddDirectEntry}
        onAddEntryInZone={props.onAddEntryInZone}
        onAddMessageBlock={props.onAddMessageBlock}
        onAddSlotToMessageBlock={props.onAddSlot}
        onAddZone={props.onAddZone}
        onAddZoneToMessageBlock={props.onAddZoneToMessageBlock}
        onDeleteCompositionItem={props.onDeleteCompositionItem}
        onDeleteNode={props.onDeleteNode}
        onDeleteZone={props.onDeleteZone}
        onDuplicateNode={props.onDuplicateNode}
        onMoveCompositionItem={props.onMoveCompositionItem}
        onDropCompositionItem={props.onDropCompositionItem}
        onRename={props.onRename}
        onReorder={props.onReorder}
        onReorderZone={props.onReorderZone}
        onSelect={props.onSelectId}
        onSelectProviderTool={props.onSelectProviderTool}
        onSelectZone={props.onSelectZone}
        onToggleEnabled={props.onToggleEnabled}
        selectedId={props.selectedId}
        selectedProviderToolId={props.selectedProviderToolId}
        selectedZoneId={props.selectedZoneId}
        t={props.t}
        zoneDefinitions={props.zoneDefinitions}
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
      {pathNodes.length > 0 ? (
        <nav aria-label="Breadcrumb" className={styles.detailBreadcrumbs} data-loom-component="detail-breadcrumbs">
          {pathNodes.map((pathNode, idx) => {
            const isLast = idx === pathNodes.length - 1
            return (
              <span key={pathNode.id} className={styles.breadcrumbItemWrapper}>
                {idx > 0 ? <ChevronRight aria-hidden="true" className={styles.breadcrumbSeparator} size={12} /> : null}
                <button
                  className={`${styles.breadcrumbButton} ${isLast ? styles.breadcrumbButtonActive : ''}`}
                  type="button"
                  onClick={() => !isLast && props.onSelectNodeId?.(pathNode.id)}
                >
                  {renderContextAssetTreeIcon(pathNode, true)}
                  <span>{pathNode.label}</span>
                </button>
              </span>
            )
          })}
        </nav>
      ) : null}
    </div>
  )
}
