import { AlignLeft, Code2, Copy, FileText, Folder, FolderOpen, GripVertical, Package, Plus, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type ContextCategory } from '../../pages/studio/model/studio-layout-store.js'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import type { ContextMenuItem } from '../../shared/ui/context-menu/context-menu.js'
import { Toggle } from '../../shared/ui/toggle/toggle.js'
import { StatusIndicator } from '../../shared/ui/status-indicator/status-indicator.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import { transformForProjectionView } from '../../features/context-assets/model/projection-view.js'
import {
  buildProjectionWorkbenchModel,
  type ContextAssetUpdate,
  findRootContextModule,
  readContextProjectionMoveUpdate,
  readProjectionOrderReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetDetail } from '../../features/context-assets/ui/context-asset-detail/context-asset-detail.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import type { ContextAssetNode } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './context-workbench.module.scss'

type ContextWorkbenchProps = {
  nodes: ContextAssetNode[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onSelectNode: (id: string) => void
  t: Translator
  workspaceId: string
}

export function ContextWorkbench(props: ContextWorkbenchProps) {
  const activeCategory = useStudioLayoutStore(state => state.contextCategory)
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.resources)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const setActiveCategory = useStudioLayoutStore(state => state.setContextCategory)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const [viewModes, setViewModes] = useState<Record<string, 'asset' | 'projection'>>({})
  const selectedNode = findContextNode(props.nodes, explorerView.selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel

  const displayNodes = useMemo(() => {
    return props.nodes
      .filter(node => node.category === activeCategory)
      .map(node => {
        const isProjection = viewModes[node.id] === 'projection'
        if (node.kind === 'module' && isProjection) {
          return transformForProjectionView(node, orderedProjectionEntries, { groupSettingLayerSlots: true })
        }
        return node
      })
  }, [props.nodes, viewModes, activeCategory, orderedProjectionEntries])

  const TABS: Array<{ value: ContextCategory, label: string }> = [
    { value: 'setting', label: 'Setting' },
    { value: 'logic', label: 'Logic' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'history', label: 'History' },
  ]

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      toolbar={(
        <nav className="loom-page-tabs">
          {TABS.map(tab => (
            <button
              key={tab.value}
              className={`loom-page-tab ${activeCategory === tab.value ? 'loom-page-tab-active' : ''}`}
              type="button"
              onClick={() => setActiveCategory(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
      explorer={(
        <FileTree
          key={props.workspaceId}
          ariaLabel={props.t('context.assetsLabel')}
          expandedIds={explorerView.expandedIds}
          getActions={node => readTreeActions(
            node as ContextAssetNode,
            viewModes[node.id],
            () => setViewModes(current => ({ ...current, [node.id]: current[node.id] === 'projection' ? 'asset' : 'projection' })),
            async parentId => {
              const selectedId = await props.onAddNode(parentId)
              if (!selectedId) return
              setSelectedId('resources', props.workspaceId, selectedId)
              setAssetViewMode('resources', props.workspaceId, 'split')
            },
            async id => {
              const selectedId = await props.onDuplicateNode(id)
              if (!selectedId) return
              setSelectedId('resources', props.workspaceId, selectedId)
              setAssetViewMode('resources', props.workspaceId, 'split')
            },
            async id => {
              const selectedId = await props.onDeleteNode(id, explorerView.selectedId)
              setSelectedId('resources', props.workspaceId, selectedId)
              if (!selectedId) setAssetViewMode('resources', props.workspaceId, 'explorer')
            },
            (id, enabled) => {
              props.onChangeNode(id, { enabled })
              props.onCommitNode(id, { enabled })
            },
            props.t,
          )}
          isMuted={node => (node as ContextAssetNode).kind === 'entry' && (node as ContextAssetNode).enabled === false}
          moreActionsLabel={props.t('context.actionMore')}
          nodes={displayNodes}
          onExpandedIdsChange={expandedIds => setExpandedIds('resources', props.workspaceId, expandedIds)}
          onMoveNode={(draggedId, targetId, position) => {
             const rootModule = findRootContextModule(props.nodes, draggedId)
             const isProjectionView = rootModule && viewModes[rootModule.id] === 'projection'

             if (isProjectionView) {
               const update = readContextProjectionMoveUpdate(props.nodes, projectionEntries, draggedId, targetId, position)
               if (update) props.onChangeNodes([update])
               return
             }

             props.onMoveNode(draggedId, targetId, position)
          }}
          onSelect={node => {
            setSelectedId('resources', props.workspaceId, node.id)
            if (explorerView.viewMode === 'explorer') setAssetViewMode('resources', props.workspaceId, 'split')
            props.onSelectNode(node.id)
          }}
          renderIcon={(node, expanded) => renderTreeIcon(node as ContextAssetNode, expanded)}
          renderTrailing={node => renderLifecycleIndicator(node as ContextAssetNode, props.t)}
          selectedId={explorerView.selectedId}
        />
      )}
    >
      <div className={styles.detailColumn} data-loom-component="context-detail-editor">
        <header className={`${styles.detailHeader} ${selectedNode?.kind === 'entry' && selectedNode.enabled === false ? styles.detailHeaderMuted : ''}`}>
          <p>{readKindLabel(selectedNode, props.t)}</p>
          <div className={styles.detailTitleRow}>
            {canToggleEnabled(selectedNode) ? (
              <Toggle
                checked={selectedNode.enabled !== false}
                label={props.t(selectedNode.enabled === false ? 'context.actionEnable' : 'context.actionDisable')}
                onChange={enabled => {
                  props.onChangeNode(selectedNode.id, { enabled })
                  props.onCommitNode(selectedNode.id, { enabled })
                }}
              />
            ) : null}
            <h1>{selectedNode?.label ?? props.t('context.emptyTitle')}</h1>
            {selectedNode && selectedNode.kind !== 'order' ? (
              <button
                aria-expanded={metadataOpen}
                aria-label={props.t(metadataOpen ? 'context.hideMetadata' : 'context.showMetadata')}
                className={`${styles.metadataToggle} ${metadataOpen ? styles.metadataToggleActive : ''}`}
                title={props.t(metadataOpen ? 'context.hideMetadata' : 'context.showMetadata')}
                type="button"
                onClick={() => setMetadataOpen(!metadataOpen)}
                onMouseDown={event => event.preventDefault()}
              >
                <SlidersHorizontal aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <span>{selectedNode?.meta ?? props.t('context.emptyBody')}</span>
        </header>
        {selectedNode ? (
          selectedNode.kind === 'order' ? (
            <ProjectionOrderEditor
              entries={orderedProjectionEntries}
              onReorder={(draggedId, targetId) => {
                props.onChangeNodes(readProjectionOrderReorderUpdates({
                  draggedId,
                  orderedProjectionEntries,
                  orderNode,
                  projectionEntries,
                  projectionOrderIds,
                  targetId,
                }))
              }}
                  selectedId={explorerView.selectedId}
              t={props.t}
            />
          ) : (
            <ContextAssetDetail
              activationEditable={activeCategory === 'setting'}
              metadataOpen={metadataOpen}
              editorMode={textEditorMode}
              node={selectedNode}
              onChangeNode={partial => props.onChangeNode(selectedNode.id, partial)}
              onCommitNode={partial => props.onCommitNode(selectedNode.id, partial)}
              onMetadataOpenChange={setMetadataOpen}
              onEditorModeChange={setTextEditorMode}
              t={props.t}
            />
          )
        ) : (
          <div className={styles.emptyState}>{props.t('context.emptyBody')}</div>
        )}
      </div>
    </AssetWorkbenchLayout>
  )
}

function renderTreeIcon(node: ContextAssetNode, expanded: boolean) {
  if (node.kind === 'module') return <Package />
  if (node.kind === 'folder') return expanded ? <FolderOpen /> : <Folder />
  if (node.kind === 'script') return <Code2 />
  if (node.kind === 'virtual') return <FileText />
  if (node.kind === 'order') return <GripVertical />
  return <FileText />
}

function renderLifecycleIndicator(node: ContextAssetNode, t: Translator) {
  if (node.enabled === false || node.projection?.lifecycle !== 'always') return null
  return <StatusIndicator label={t('context.lifecycleAlwaysIndicator')} tone="info" />
}

function readTreeActions(
  node: ContextAssetNode,
  viewMode: 'asset' | 'projection' | undefined,
  onToggleViewMode: () => void,
  onAddNode: (parentId: string) => void,
  onDuplicateNode: (id: string) => void,
  onDeleteNode: (id: string) => void,
  onToggleEnabled: (id: string, enabled: boolean) => void,
  t: Translator,
): ContextMenuItem[] {
  const canAdd = (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyTreeNode(node)
  const canDelete = canDuplicate
  const isSettingLayer = node.category === 'setting' && node.kind === 'module'
  const items: ContextMenuItem[] = []

  if (canToggleEnabled(node)) {
    items.push({
      checked: node.enabled !== false,
      id: 'enabled',
      label: t('context.actionEnable'),
      onSelect: () => onToggleEnabled(node.id, node.enabled === false),
    })
    if (isSettingLayer || canAdd || canDuplicate) items.push({ id: 'state-separator', type: 'separator' })
  }
  if (isSettingLayer) {
    items.push({
      icon: viewMode === 'projection' ? <Folder aria-hidden="true" /> : <AlignLeft aria-hidden="true" />,
      id: 'view-mode',
      label: t(viewMode === 'projection' ? 'context.actionAssetView' : 'context.actionProjectionView'),
      onSelect: onToggleViewMode,
    })
  }
  if (canAdd) items.push({ icon: <Plus aria-hidden="true" />, id: 'add', label: t('context.actionAdd'), onSelect: () => onAddNode(node.id) })
  if (canDuplicate) items.push({ icon: <Copy aria-hidden="true" />, id: 'duplicate', label: t('context.actionDuplicate'), onSelect: () => onDuplicateNode(node.id) })
  if (canDelete) {
    if (items.length > 0) items.push({ id: 'delete-separator', type: 'separator' })
    items.push({ icon: <Trash2 aria-hidden="true" />, id: 'delete', label: t('context.actionDelete'), onSelect: () => onDeleteNode(node.id), tone: 'danger' })
  }
  return items
}

function canToggleEnabled(node: ContextAssetNode | undefined): node is ContextAssetNode {
  return node?.kind === 'entry' && !isReadOnlyTreeNode(node)
}

function isReadOnlyTreeNode(node: ContextAssetNode): boolean {
  return node.category === 'runtime'
    || node.category === 'history'
    || node.projection?.sourceKind === 'virtual'
    || node.id.startsWith('history-')
}

function readKindLabel(node: ContextAssetNode | undefined, t: Translator): string {
  if (!node) return t('context.detailLabel')
  if (node.kind === 'module') return t('context.kind.module')
  if (node.kind === 'folder') return t('context.kind.folder')
  if (node.kind === 'script') return t('context.kind.script')
  if (node.kind === 'virtual') return t('context.kind.virtual')
  if (node.kind === 'order') return t('context.kind.order')
  return t('context.kind.entry')
}
