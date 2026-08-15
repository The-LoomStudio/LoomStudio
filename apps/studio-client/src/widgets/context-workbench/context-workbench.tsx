import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type ContextCategory } from '../../pages/studio/model/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import {
  buildProjectionWorkbenchModel,
  type ContextAssetUpdate,
  findRootContextModule,
  readContextProjectionMoveUpdate,
  readProjectionOrderReorderUpdates,
  readProjectionZoneReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import type { ContextAssetNode } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'

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
  }, [props.nodes, activeCategory])
  const projectionModuleIds = displayNodes
    .filter(node => node.kind === 'module' && viewModes[node.id] === 'projection')
    .map(node => node.id)

  function handleProjectionReorder(draggedId: string, targetId: string) {
    props.onChangeNodes(readProjectionOrderReorderUpdates({
      draggedId,
      orderedProjectionEntries,
      orderNode,
      projectionEntries,
      projectionOrderIds,
      targetId,
    }))
  }

  function handleProjectionZoneReorder(draggedZoneId: string, targetZoneId: string) {
    props.onChangeNodes(readProjectionZoneReorderUpdates({
      draggedZoneId,
      orderedProjectionEntries,
      orderNode,
      projectionEntries,
      targetZoneId,
    }))
  }

  const tabs: Array<{ value: ContextCategory, label: string }> = [
    { value: 'setting', label: props.t('context.category.setting') },
    { value: 'logic', label: props.t('context.category.logic') },
    { value: 'runtime', label: props.t('context.category.runtime') },
    { value: 'history', label: props.t('context.category.history') },
  ]

  function handleSelectNode(id: string) {
    openAssetDetail('resources', props.workspaceId, id)
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
        <ContextAssetExplorer
          displayNodes={displayNodes}
          expandedIds={explorerView.expandedIds}
          query={searchQuery}
          projectionEntries={orderedProjectionEntries}
          projectionModuleIds={projectionModuleIds}
          selectedId={selectedId}
          t={props.t}
          view={node => ({
            mode: viewModes[node.id],
            toggle: () => setViewModes(current => ({ ...current, [node.id]: current[node.id] === 'projection' ? 'asset' : 'projection' })),
          })}
          workspaceId={props.workspaceId}
          onAddNode={props.onAddNode}
          onDeleteNode={props.onDeleteNode}
          onDuplicateNode={props.onDuplicateNode}
          onExpandedIdsChange={expandedIds => setExpandedIds('resources', props.workspaceId, expandedIds)}
          onMoveNode={(draggedId, targetId, position) => {
            const rootModule = findRootContextModule(props.nodes, draggedId)
            if (rootModule && viewModes[rootModule.id] === 'projection') {
              const update = readContextProjectionMoveUpdate(props.nodes, projectionEntries, draggedId, targetId, position)
              if (update) props.onChangeNodes([update])
              return
            }
            props.onMoveNode(draggedId, targetId, position)
          }}
          onReorderProjection={handleProjectionReorder}
          onReorderProjectionZone={handleProjectionZoneReorder}
          onQueryChange={setSearchQuery}
          onSelectId={id => {
            if (id) handleSelectNode(id)
            else setSelectedId('resources', props.workspaceId, undefined)
          }}
          onToggleEnabled={(id, enabled) => {
            props.onChangeNode(id, { enabled })
            props.onCommitNode(id, { enabled })
          }}
        />
      )}
    >
      <ContextAssetEditor
        activationEditable={activeCategory === 'setting'}
        editorMode={textEditorMode}
        metadataOpen={metadataOpen}
        node={selectedNode}
        orderEditor={selectedNode?.kind === 'order' ? (
          <ProjectionOrderEditor
            entries={orderedProjectionEntries}
            onReorder={handleProjectionReorder}
            onReorderZone={handleProjectionZoneReorder}
            selectedId={selectedId}
            t={props.t}
          />
        ) : undefined}
        t={props.t}
        onChangeNode={props.onChangeNode}
        onCommitNode={props.onCommitNode}
        onEditorModeChange={setTextEditorMode}
        onMetadataOpenChange={setMetadataOpen}
      />
    </AssetWorkbenchLayout>
  )
}
