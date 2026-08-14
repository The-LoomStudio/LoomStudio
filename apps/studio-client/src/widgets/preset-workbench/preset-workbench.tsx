import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import type { Translator } from '../../shared/i18n/index.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import { transformForProjectionView } from '../../features/context-assets/model/projection-view.js'
import {
  buildProjectionWorkbenchModel,
  type ContextAssetUpdate,
  findRootContextModule,
  readPresetProjectionMoveUpdates,
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
import type { AgentRuntimeProfile, ContextAssetNode, ModelProfile } from '../../entities/index.js'
import { AgentRuntimeManager } from './agent-runtime-manager.js'
import styles from './preset-workbench.module.scss'
import contextStyles from '../../features/context-assets/ui/context-asset-workbench.module.scss'

type PresetWorkbenchProps = {
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
  agentRuntimeProfiles: AgentRuntimeProfile[]
  modelProfiles: ModelProfile[]
  selectedAgentRuntimeProfileId?: string
  onSelectAgentRuntimeProfile: (id: string) => void
  onCreateAgentRuntimeProfile: (input: { name: string; purpose: string; presetId?: string; modelProfileId?: string }) => void
  onUpdateAgentRuntimeProfile: (id: string, updates: { name?: string; purpose?: string; modelProfileId?: string }) => void
  onDeleteAgentRuntimeProfile: (id: string) => void
}

export function PresetWorkbench(props: PresetWorkbenchProps) {
  const activePresetView = useStudioLayoutStore(state => state.presetView)
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.preset)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setActivePresetView = useStudioLayoutStore(state => state.setPresetView)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(props.nodes, selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const detailNode = activePresetView === 'order' ? orderNode : selectedNode
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('preset', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    setSearchQuery(props.initialSearchQuery ?? '')
  }, [props.initialSearchQuery])

  const displayNodes = useMemo(() => {
    return props.nodes
      .filter(node => node.category === 'preset')
      .map(node => {
        if (node.kind === 'module') {
          return transformForProjectionView(node, orderedProjectionEntries)
        }
        return node
      })
  }, [props.nodes, orderedProjectionEntries])

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

  function handleSelectNode(node: ContextAssetNode) {
    openAssetDetail('preset', props.workspaceId, node.id)
    setActivePresetView('assets')
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      toolbar={(
        <nav className="loom-page-tabs">
          <button
            aria-current={activePresetView === 'assets' ? 'page' : undefined}
            className={`loom-page-tab ${activePresetView === 'assets' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setActivePresetView('assets')}
          >
            {props.t('preset.panel.assets')}
          </button>
          <button
            aria-current={activePresetView === 'order' ? 'page' : undefined}
            className={`loom-page-tab ${activePresetView === 'order' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setActivePresetView('order')}
          >
            {props.t('preset.panel.mainOrder')}
          </button>
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
                openAssetDetail('preset', props.workspaceId, selectedId)
              },
              onDuplicate: async id => {
                const selectedId = await props.onDuplicateNode(id)
                if (!selectedId) return
                openAssetDetail('preset', props.workspaceId, selectedId)
              },
              onDelete: async id => {
                const nextSelectedId = await props.onDeleteNode(id, selectedId)
                setSelectedId('preset', props.workspaceId, nextSelectedId)
              },
              onToggleEnabled: (id, enabled) => {
                props.onChangeNode(id, { enabled })
                props.onCommitNode(id, { enabled })
              },
              t: props.t,
            })}
            isMuted={node => (node as ContextAssetNode).kind === 'entry' && (node as ContextAssetNode).enabled === false}
            moreActionsLabel={props.t('context.actionMore')}
            nodes={displayNodes}
            onExpandedIdsChange={expandedIds => setExpandedIds('preset', props.workspaceId, expandedIds)}
            onMoveNode={(draggedId, targetId, position) => {
               const rootModule = findRootContextModule(props.nodes, draggedId)
               const isProjectionView = rootModule?.category === 'preset'

               if (isProjectionView) {
                 props.onChangeNodes(readPresetProjectionMoveUpdates({
                   draggedId,
                   nodes: props.nodes,
                   orderedProjectionEntries,
                   orderNode,
                   position,
                   projectionEntries,
                   projectionOrderIds,
                   targetId,
                 }))
                 return
               }

               props.onMoveNode(draggedId, targetId, position)
            }}
            onSelect={node => handleSelectNode(node as ContextAssetNode)}
            renderIcon={(node, expanded) => renderContextAssetTreeIcon(node as ContextAssetNode, expanded)}
            renderMetaLeading={node => renderContextAssetLifecycleIndicator(node as ContextAssetNode, props.t)}
            selectedId={selectedId}
            variant="flat"
          />
        </ContextAssetSearch>
      )}
    >
      <div className={styles.detailStack}>
        <AgentRuntimeManager
          profiles={props.agentRuntimeProfiles}
          models={props.modelProfiles}
          selectedId={props.selectedAgentRuntimeProfileId}
          onSelect={props.onSelectAgentRuntimeProfile}
          onCreate={props.onCreateAgentRuntimeProfile}
          onUpdate={props.onUpdateAgentRuntimeProfile}
          onDelete={props.onDeleteAgentRuntimeProfile}
          t={props.t}
        />
        <div className={contextStyles.detailColumn} data-loom-component="context-detail-editor">
          <ContextAssetDetailHeader metadataOpen={metadataOpen} node={detailNode} toggleEnabled={canToggleContextAssetEnabled(detailNode)} t={props.t} onEnabledChange={enabled => {
            if (!detailNode) return
            props.onChangeNode(detailNode.id, { enabled })
            props.onCommitNode(detailNode.id, { enabled })
          }} onMetadataOpenChange={setMetadataOpen} />
        {detailNode ? (
          detailNode.kind === 'order' ? (
            <ProjectionOrderEditor
              entries={orderedProjectionEntries}
              onReorder={handleProjectionReorder}
              selectedId={selectedId}
              t={props.t}
            />
          ) : (
            <ContextAssetDetail
              activationEditable
              metadataOpen={metadataOpen}
              editorMode={textEditorMode}
              node={detailNode}
              onChangeNode={partial => props.onChangeNode(detailNode.id, partial)}
              onCommitNode={partial => props.onCommitNode(detailNode.id, partial)}
              onMetadataOpenChange={setMetadataOpen}
              onEditorModeChange={setTextEditorMode}
              t={props.t}
            />
          )
        ) : (
          <div className={contextStyles.emptyState}>{props.t('context.emptyBody')}</div>
        )}
        </div>
      </div>
    </AssetWorkbenchLayout>
  )
}
