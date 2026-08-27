import { useEffect, useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
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
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { ContextAssetHeader } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { findContextAssetPath } from '../../features/context-assets/model/context-asset-tree.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import { ProjectionOrderEditor } from '../../features/context-assets/ui/projection-order-editor/projection-order-editor.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { Dialog } from '../../shared/ui/dialog/dialog.js'
import type { Card, ContextAssetNode, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './context-workbench.module.scss'

type ContextWorkbenchProps = {
  card?: Card
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  settingMounts: SettingMount[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onAddFolderNode?: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onReplaceSettingMounts: (source: SettingMountSource, settingResourceIds: string[]) => Promise<void>
  onReplaceCardResources: (cardId: string, resourceIds: string[]) => Promise<void>
  routeAssetId?: string
  initialSearchQuery?: string
  t: Translator
  workspaceId: string
}

export function ContextWorkbench(props: ContextWorkbenchProps) {
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.resources)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const [viewModes] = useState<Record<string, 'asset' | 'projection'>>({})
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const [scope, setScope] = useState<'character' | 'global'>('character')
  const [bindingOpen, setBindingOpen] = useState(false)
  const cardResourceIds = useMemo(() => new Set(props.card?.promptResourceIds ?? []), [props.card?.promptResourceIds])
  const globalSettingIds = useMemo(() => new Set(props.settingMounts
    .filter(mount => mount.source.kind === 'manual')
    .map(mount => mount.settingResourceId)), [props.settingMounts])
  const scopedResources = useMemo(() => scope === 'character'
    ? props.resources.filter(resource => cardResourceIds.has(resource.id))
    : props.resources.filter(resource => resource.resourceKind === 'setting' && globalSettingIds.has(resource.id)), [cardResourceIds, globalSettingIds, props.resources, scope])
  const workbenchNodes = useMemo(() => scopedResources.map(readPromptResourceWorkbenchRoot), [scopedResources])
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const selectedResource = useMemo(() => {
    const root = selectedId ? findRootContextModule(workbenchNodes, selectedId) : undefined
    return scopedResources.find(resource => resource.rootNode.id === root?.id) ?? scopedResources[0]
  }, [scopedResources, selectedId, workbenchNodes])
  const bindingResources = scope === 'character'
    ? props.resources
    : props.resources.filter(resource => resource.resourceKind === 'setting')
  const boundIds = scope === 'character'
    ? props.card?.promptResourceIds ?? []
    : props.settingMounts
      .filter(mount => mount.source.kind === 'manual')
      .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
      .map(mount => mount.settingResourceId)
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(workbenchNodes), [workbenchNodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    setSearchQuery(props.initialSearchQuery ?? '')
  }, [props.initialSearchQuery])

  useEffect(() => {
    if (selectedId && findContextNode(workbenchNodes, selectedId)) return
    setSelectedId('resources', props.workspaceId, workbenchNodes[0]?.id)
  }, [props.workspaceId, selectedId, setSelectedId, workbenchNodes])

  const displayNodes = workbenchNodes
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

  function handleSelectNode(id: string) {
    openAssetDetail('resources', props.workspaceId, id)
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      toolbar={(
        <PromptResourceToolbar
          hideSelect
          resourceKind={selectedResource?.resourceKind ?? 'setting'}
          resources={scopedResources}
          selectedResourceId={selectedResource?.id}
          t={props.t}
          onCreate={props.onCreateResource}
          onDelete={props.onDeleteResource}
          onDuplicate={props.onDuplicateResource}
          onExport={props.onExportResource}
          onImport={props.onImportResource}
          onSelect={resourceId => {
            const resource = scopedResources.find(candidate => candidate.id === resourceId)
            if (resource) handleSelectNode(resource.rootNode.id)
          }}
        />
      )}
      footer={(
        <nav className="loom-page-tabs">
          <button
            aria-current={scope === 'character' ? 'page' : undefined}
            className={`loom-page-tab ${scope === 'character' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setScope('character')}
          >
            {props.t('context.scope.character')}
          </button>
          <button
            aria-current={scope === 'global' ? 'page' : undefined}
            className={`loom-page-tab ${scope === 'global' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setScope('global')}
          >
            {props.t('context.scope.global')}
          </button>
        </nav>
      )}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={(
        <div className={styles.resourceExplorer}>
          <button className={styles.bindResourcesButton} type="button" onClick={() => setBindingOpen(true)}>
            <Link2 aria-hidden="true" />
            <span>{props.t(scope === 'character' ? 'context.cardBindings.action' : 'context.globalSettings.action')}</span>
          </button>
          <ContextAssetExplorer
            displayNodes={displayNodes}
          expandedIds={explorerView.expandedIds}
          query={searchQuery}
          projectionEntries={orderedProjectionEntries}
          projectionModuleIds={projectionModuleIds}
          selectedId={selectedId}
          t={props.t}
          workspaceId={props.workspaceId}
          onAddNode={props.onAddNode}
          onAddFolderNode={props.onAddFolderNode}
          onDeleteNode={props.onDeleteNode}
          onDuplicateNode={props.onDuplicateNode}
          onExpandedIdsChange={expandedIds => setExpandedIds('resources', props.workspaceId, expandedIds)}
          onMoveNode={(draggedId, targetId, position) => {
            const rootModule = findRootContextModule(workbenchNodes, draggedId)
            if (rootModule && viewModes[rootModule.id] === 'projection') {
              const update = readContextProjectionMoveUpdate(workbenchNodes, projectionEntries, draggedId, targetId, position)
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
          <ResourceBindingDialog
            boundIds={boundIds}
            description={props.t(scope === 'character' ? 'context.cardBindings.description' : 'context.globalSettings.description')}
            open={bindingOpen}
            resources={bindingResources}
            t={props.t}
            title={props.t(scope === 'character' ? 'context.cardBindings.title' : 'context.globalSettings.title')}
            onChange={resourceIds => scope === 'character'
              ? props.card ? props.onReplaceCardResources(props.card.id, resourceIds) : Promise.resolve()
              : props.onReplaceSettingMounts({ kind: 'manual', id: 'global' }, resourceIds)}
            onClose={() => setBindingOpen(false)}
          />
        </div>
      )}
    >
      <ContextAssetEditor
          activationEditable={selectedNode?.category === 'setting'}
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
          pathNodes={findContextAssetPath(workbenchNodes, selectedNode?.id)}
          t={props.t}
          onChangeNode={props.onChangeNode}
          onCommitNode={props.onCommitNode}
          onEditorModeChange={setTextEditorMode}
          onMetadataOpenChange={setMetadataOpen}
          onSelectNodeId={handleSelectNode}
      />
    </AssetWorkbenchLayout>
  )
}

function ResourceBindingDialog(props: {
  boundIds: string[]
  description: string
  open: boolean
  resources: PromptResource[]
  t: Translator
  title: string
  onChange(resourceIds: string[]): Promise<void>
  onClose(): void
}) {
  const [pending, setPending] = useState(false)
  const [query, setQuery] = useState('')
  const bound = props.boundIds.flatMap(id => {
    const resource = props.resources.find(candidate => candidate.id === id)
    return resource ? [resource] : []
  })
  const available = props.resources.filter(resource => !props.boundIds.includes(resource.id)
    && `${resource.rootNode.label} ${resource.resourceKind}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  async function change(ids: string[]) {
    setPending(true)
    try {
      await props.onChange(ids)
      setQuery('')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog closeOnBackdrop description={props.description} open={props.open} title={props.title} onClose={props.onClose}>
      <div className={styles.bindingEditor}>
        <div className={styles.globalSettingOptions}>
          {bound.map(resource => (
            <button disabled={pending} key={resource.id} type="button" onClick={() => void change(props.boundIds.filter(id => id !== resource.id))}>
              <span>{resource.rootNode.label}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <input
          autoFocus
          aria-label={props.t('context.bindings.search')}
          disabled={pending}
          placeholder={props.t('context.bindings.searchPlaceholder')}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div className={styles.bindingResults}>
          {available.length === 0 ? <span>{props.t('context.bindings.noResults')}</span> : available.map(resource => (
              <button disabled={pending} key={resource.id} type="button" onClick={() => void change([...props.boundIds, resource.id])}>
                <strong>{resource.rootNode.label}</strong>
                <small>{resource.resourceKind}</small>
              </button>
            ))}
        </div>
      </div>
    </Dialog>
  )
}

export function ContextWorkbenchHeader(props: {
  resources: PromptResource[]
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.resource
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.resources.views[props.workspaceId]?.selectedId)
  const selectedResource = props.resources.find(resource => Boolean(findContextNode([resource.rootNode], selectedId)))
  const breadcrumbs = selectedResource
    ? [selectedResource.rootNode.label, ...(selectedResource.origin?.kind === 'builtin' ? [props.t('promptResource.official')] : [])]
    : []

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      breadcrumbs={breadcrumbs}
      title={props.t(definition.labelKey)}
      resources={[]}
      selectedResourceId={selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
