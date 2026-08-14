import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type ContextCategory } from '../../pages/studio/model/studio-layout-store.js'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
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
import { ContextAssetDetailHeader } from '../../features/context-assets/ui/context-asset-detail-header/context-asset-detail-header.js'
import { ContextAssetSearch } from '../../features/context-assets/ui/context-asset-search/context-asset-search.js'
import {
  canToggleContextAssetEnabled,
  readContextAssetTreeActions,
  renderContextAssetLifecycleIndicator,
  renderContextAssetTreeIcon,
} from '../../features/context-assets/ui/context-asset-tree.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import type { ContextAssetNode } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import contextStyles from '../../features/context-assets/ui/context-asset-workbench.module.scss'

type ContextWorkbenchProps = {
  nodes: ContextAssetNode[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  routeAssetId?: string
  initialSearchQuery?: string
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
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setActiveCategory = useStudioLayoutStore(state => state.setContextCategory)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const [viewModes, setViewModes] = useState<Record<string, 'asset' | 'projection'>>({})
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(props.nodes, selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    setSearchQuery(props.initialSearchQuery ?? '')
  }, [props.initialSearchQuery])

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

  const tabs: Array<{ value: ContextCategory, label: string }> = [
    { value: 'setting', label: props.t('context.category.setting') },
    { value: 'logic', label: props.t('context.category.logic') },
    { value: 'runtime', label: props.t('context.category.runtime') },
    { value: 'history', label: props.t('context.category.history') },
  ]

  function handleSelectNode(node: ContextAssetNode) {
    openAssetDetail('resources', props.workspaceId, node.id)
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      toolbar={(
        <nav className="loom-page-tabs">
          {tabs.map(tab => (
            <button
              key={tab.value}
              aria-current={activeCategory === tab.value ? 'page' : undefined}
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
        <ContextAssetSearch
          key={props.workspaceId}
          nodes={displayNodes}
          query={searchQuery}
          t={props.t}
          onQueryChange={setSearchQuery}
          onSelect={handleSelectNode}
        >
          <FileTree
            key={props.workspaceId}
            ariaLabel={props.t('context.explorerLabel')}
            expandedIds={explorerView.expandedIds ?? displayNodes.map(node => node.id)}
            getDisclosureLabel={(node, expanded) => props.t(expanded ? 'context.tree.collapse' : 'context.tree.expand', { label: node.label })}
            getDragLabel={node => props.t('context.tree.drag', { label: node.label })}
            getActions={node => readContextAssetTreeActions(node as ContextAssetNode, {
              onAdd: async parentId => {
                const selectedId = await props.onAddNode(parentId)
                if (!selectedId) return
                openAssetDetail('resources', props.workspaceId, selectedId)
              },
              onDuplicate: async id => {
                const selectedId = await props.onDuplicateNode(id)
                if (!selectedId) return
                openAssetDetail('resources', props.workspaceId, selectedId)
              },
              onDelete: async id => {
                const nextSelectedId = await props.onDeleteNode(id, selectedId)
                setSelectedId('resources', props.workspaceId, nextSelectedId)
              },
              onToggleEnabled: (id, enabled) => {
                props.onChangeNode(id, { enabled })
                props.onCommitNode(id, { enabled })
              },
              t: props.t,
              view: {
                mode: viewModes[node.id],
                toggle: () => setViewModes(current => ({ ...current, [node.id]: current[node.id] === 'projection' ? 'asset' : 'projection' })),
              },
            })}
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
            onSelect={node => handleSelectNode(node as ContextAssetNode)}
            renderIcon={(node, expanded) => renderContextAssetTreeIcon(node as ContextAssetNode, expanded)}
            renderMetaLeading={node => renderContextAssetLifecycleIndicator(node as ContextAssetNode, props.t)}
            selectedId={selectedId}
          />
        </ContextAssetSearch>
      )}
    >
      <div className={contextStyles.detailColumn} data-loom-component="context-detail-editor">
        <ContextAssetDetailHeader metadataOpen={metadataOpen} node={selectedNode} toggleEnabled={canToggleContextAssetEnabled(selectedNode)} t={props.t} onEnabledChange={enabled => {
          if (!selectedNode) return
          props.onChangeNode(selectedNode.id, { enabled })
          props.onCommitNode(selectedNode.id, { enabled })
        }} onMetadataOpenChange={setMetadataOpen} />
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
                  selectedId={selectedId}
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
          <div className={contextStyles.emptyState}>{props.t('context.emptyBody')}</div>
        )}
      </div>
    </AssetWorkbenchLayout>
  )
}
