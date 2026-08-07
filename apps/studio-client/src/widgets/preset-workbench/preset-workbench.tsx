import { Code2, Copy, FileText, Folder, FolderOpen, GripVertical, Package, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { FileTree } from '../../shared/ui/file-tree/file-tree.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import type { ContextMenuItem } from '../../shared/ui/context-menu/context-menu.js'
import { StatusIndicator } from '../../shared/ui/status-indicator/status-indicator.js'
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
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import type { AgentRuntimeProfile, ContextAssetNode, ModelProfile } from '../../entities/index.js'
import { AgentRuntimeManager } from './agent-runtime-manager.js'
import styles from './preset-workbench.module.scss'

type PresetWorkbenchProps = {
  nodes: ContextAssetNode[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onSearchQueryChange: (query: string) => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  routeAssetId?: string
  searchQuery: string
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
  const activePresetPanel = useStudioLayoutStore(state => state.presetPanel)
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.preset)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setActivePresetPanel = useStudioLayoutStore(state => state.setPresetPanel)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(props.nodes, selectedId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(props.nodes), [props.nodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const detailNode = activePresetPanel === 'order' ? orderNode : selectedNode

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('preset', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

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
    setActivePresetPanel('assets')
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
            className={`loom-page-tab ${activePresetPanel === 'assets' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setActivePresetPanel('assets')}
          >
            {props.t('preset.panel.assets')}
          </button>
          <button
            className={`loom-page-tab ${activePresetPanel === 'order' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setActivePresetPanel('order')}
          >
            {props.t('preset.panel.mainOrder')}
          </button>
        </nav>
      )}
      explorer={(
        <ContextAssetSearch
          key={props.workspaceId}
          nodes={displayNodes}
          query={props.searchQuery}
          t={props.t}
          onQueryChange={props.onSearchQueryChange}
          onSelect={handleSelectNode}
        >
          <FileTree
            key={props.workspaceId}
            ariaLabel={props.t('context.assetsLabel')}
            expandedIds={explorerView.expandedIds}
            getActions={node => readTreeActions(
              node as ContextAssetNode,
              async parentId => {
                const selectedId = await props.onAddNode(parentId)
                if (!selectedId) return
                openAssetDetail('preset', props.workspaceId, selectedId)
              },
              async id => {
                const selectedId = await props.onDuplicateNode(id)
                if (!selectedId) return
                openAssetDetail('preset', props.workspaceId, selectedId)
              },
              async id => {
                const nextSelectedId = await props.onDeleteNode(id, selectedId)
                setSelectedId('preset', props.workspaceId, nextSelectedId)
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
            renderIcon={(node, expanded) => renderTreeIcon(node as ContextAssetNode, expanded)}
            renderMetaLeading={node => renderLifecycleIndicator(node as ContextAssetNode, props.t)}
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
        <div className={styles.detailColumn} data-loom-component="context-detail-editor">
          <ContextAssetDetailHeader metadataOpen={metadataOpen} node={detailNode} toggleEnabled={canToggleEnabled(detailNode)} t={props.t} onEnabledChange={enabled => {
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
          <div className={styles.emptyState}>{props.t('context.emptyBody')}</div>
        )}
        </div>
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
  onAddNode: (parentId: string) => void,
  onDuplicateNode: (id: string) => void,
  onDeleteNode: (id: string) => void,
  onToggleEnabled: (id: string, enabled: boolean) => void,
  t: Translator,
): ContextMenuItem[] {
  const canAdd = (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyTreeNode(node)
  const canDuplicate = node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyTreeNode(node)
  const canDelete = canDuplicate
  const items: ContextMenuItem[] = []

  if (canToggleEnabled(node)) {
    items.push({
      checked: node.enabled !== false,
      id: 'enabled',
      label: t('context.actionEnable'),
      onSelect: () => onToggleEnabled(node.id, node.enabled === false),
    })
    if (canAdd || canDuplicate) items.push({ id: 'state-separator', type: 'separator' })
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
