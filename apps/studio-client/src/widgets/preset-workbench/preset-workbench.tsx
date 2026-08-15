import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import type { Translator } from '../../shared/i18n/index.js'
import {
  findContextNode,
  flattenContextNodes,
} from '../../features/context-assets/model/projection-order.js'
import {
  buildProjectionWorkbenchModel,
  type ContextAssetUpdate,
  readProjectionOrderReorderUpdates,
  readProjectionZoneReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetEditor, ContextAssetProjectionExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import type { AgentRuntimeProfile, ContextAssetNode, ModelProfile } from '../../entities/index.js'
import { AgentRuntimeManager } from './agent-runtime-manager.js'
import styles from './preset-workbench.module.scss'

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
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setActivePresetView = useStudioLayoutStore(state => state.setPresetView)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(props.nodes, selectedId)
  const detailNode = selectedNode?.kind === 'order' ? undefined : selectedNode
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
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
      .filter(node => node.category === 'preset' && node.kind !== 'order')
  }, [props.nodes])
  const presetProjectionEntries = useMemo(() => {
    const presetNodeIds = new Set(flattenContextNodes(displayNodes).map(node => node.id))
    return orderedProjectionEntries.filter(entry => presetNodeIds.has(entry.node.id))
  }, [displayNodes, orderedProjectionEntries])
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

  function handleSelectNode(id: string) {
    openAssetDetail('preset', props.workspaceId, id)
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
        <ContextAssetProjectionExplorer
          entries={activePresetView === 'order' ? orderedProjectionEntries : presetProjectionEntries}
          nodes={activePresetView === 'order' ? props.nodes.filter(node => node.kind !== 'order') : displayNodes}
          query={searchQuery}
          selectedId={selectedId}
          t={props.t}
          onQueryChange={setSearchQuery}
          onReorder={handleProjectionReorder}
          onReorderZone={handleProjectionZoneReorder}
          onSelectId={handleSelectNode}
        />
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
        <ContextAssetEditor
          activationEditable
          editorMode={textEditorMode}
          metadataOpen={metadataOpen}
          node={detailNode}
          t={props.t}
          onChangeNode={props.onChangeNode}
          onCommitNode={props.onCommitNode}
          onEditorModeChange={setTextEditorMode}
          onMetadataOpenChange={setMetadataOpen}
        />
      </div>
    </AssetWorkbenchLayout>
  )
}
