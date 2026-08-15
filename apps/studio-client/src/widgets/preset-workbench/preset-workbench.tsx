import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import type { Translator } from '../../shared/i18n/index.js'
import {
  findContextNode,
  flattenContextNodes,
} from '../../features/context-assets/model/projection-order.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import {
  buildProjectionWorkbenchModel,
  type ContextAssetUpdate,
  readProjectionOrderReorderUpdates,
  readProjectionZoneReorderUpdates,
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetEditor, ContextAssetProjectionExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import type { ContextAssetNode, PromptResource } from '../../entities/index.js'
import styles from './preset-workbench.module.scss'

type PresetWorkbenchProps = {
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  buildContextResources: PromptResource[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onUpdatePresetSettings: (presetId: string, linkedSettingIds: string[]) => Promise<void>
  routeAssetId?: string
  initialSearchQuery?: string
  t: Translator
  workspaceId: string
}

type PresetZone = NonNullable<NonNullable<ContextAssetNode['skeletonPatch']>['zones']>[number]

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
  const presetResources = useMemo(() => props.resources.filter(resource => resource.resourceKind === 'preset'), [props.resources])
  const settingResources = useMemo(() => props.resources.filter(resource => resource.resourceKind === 'setting'), [props.resources])
  const [selectedResourceId, setSelectedResourceId] = useState<string>()
  const selectedResource = presetResources.find(resource => resource.id === selectedResourceId) ?? presetResources[0]
  const currentPresetNodes = selectedResource ? [readPromptResourceWorkbenchRoot(selectedResource)] : []
  const mainOrderNodes = useMemo(() => {
    const resources = [
      ...(selectedResource ? [selectedResource] : []),
      ...props.buildContextResources.filter(resource => resource.id !== selectedResource?.id),
    ]
    return resources.map(readPromptResourceWorkbenchRoot)
  }, [props.buildContextResources, selectedResource])
  const workbenchNodes = activePresetView === 'order' ? mainOrderNodes : currentPresetNodes
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const detailNode = selectedNode?.kind === 'order' ? undefined : selectedNode
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(workbenchNodes), [workbenchNodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const [selectedZoneId, setSelectedZoneId] = useState<string>()
  const zoneDefinitions = orderNode?.skeletonPatch?.zones ?? []
  const selectedZone = zoneDefinitions.find(zone => zone.id === selectedZoneId)

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('preset', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    setSearchQuery(props.initialSearchQuery ?? '')
  }, [props.initialSearchQuery])

  useEffect(() => {
    if (!selectedResource) setSelectedResourceId(undefined)
    else if (selectedResource.id !== selectedResourceId) setSelectedResourceId(selectedResource.id)
  }, [selectedResource?.id, selectedResourceId])

  useEffect(() => {
    if (selectedZoneId && !zoneDefinitions.some(zone => zone.id === selectedZoneId)) setSelectedZoneId(undefined)
  }, [selectedZoneId, zoneDefinitions])

  const displayNodes = useMemo(() => {
    return currentPresetNodes
      .filter(node => node.category === 'preset' && node.kind !== 'order')
  }, [currentPresetNodes])
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
    setSelectedZoneId(undefined)
    openAssetDetail('preset', props.workspaceId, id)
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      toolbar={(
        <div className={styles.toolbarRow}>
          <PromptResourceToolbar
            resourceKind="preset"
            resources={presetResources}
            selectedResourceId={selectedResource?.id}
            t={props.t}
            onCreate={props.onCreateResource}
            onDelete={props.onDeleteResource}
            onDuplicate={props.onDuplicateResource}
            onExport={props.onExportResource}
            onImport={props.onImportResource}
            onSelect={setSelectedResourceId}
          />
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
        </div>
      )}
      explorer={(
        <ContextAssetProjectionExplorer
          entries={activePresetView === 'order' ? orderedProjectionEntries : presetProjectionEntries}
          nodes={activePresetView === 'order' ? workbenchNodes.filter(node => node.kind !== 'order') : displayNodes}
          query={searchQuery}
          selectedId={selectedId}
          selectedZoneId={selectedZoneId}
          t={props.t}
          zoneDefinitions={zoneDefinitions}
          onQueryChange={setSearchQuery}
          onReorder={handleProjectionReorder}
          onReorderZone={handleProjectionZoneReorder}
          onSelectId={handleSelectNode}
          onSelectZone={setSelectedZoneId}
        />
      )}
    >
      <div className={styles.detailStack}>
        {selectedResource ? (
          <PresetSettingBindings
            preset={selectedResource}
            settings={settingResources}
            t={props.t}
            onChange={linkedSettingIds => props.onUpdatePresetSettings(selectedResource.id, linkedSettingIds)}
          />
        ) : null}
        {selectedZone ? <ZoneDetail zone={selectedZone} t={props.t} /> : (
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
        )}
      </div>
    </AssetWorkbenchLayout>
  )
}

function PresetSettingBindings(props: {
  preset: PromptResource
  settings: PromptResource[]
  t: Translator
  onChange(linkedSettingIds: string[]): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const linkedIds = props.preset.linkedSettingIds ?? []
  const readOnly = props.preset.origin?.kind === 'builtin'
  async function toggleSetting(settingId: string, checked: boolean) {
    setPending(true)
    try {
      await props.onChange(checked
        ? linkedIds.filter(id => id !== settingId)
        : [...linkedIds, settingId])
    } finally {
      setPending(false)
    }
  }
  return (
    <section className={styles.settingBindings}>
      <div>
        <strong>{props.t('preset.settings.title')}</strong>
        <span>{props.t('preset.settings.description')}</span>
      </div>
      <div className={styles.settingOptions}>
        {props.settings.length === 0 ? <span>{props.t('preset.settings.empty')}</span> : props.settings.map(setting => {
          const checked = linkedIds.includes(setting.id)
          return (
            <label key={setting.id}>
              <input
                checked={checked}
                disabled={readOnly || pending}
                type="checkbox"
                onChange={() => void toggleSetting(setting.id, checked)}
              />
              <span>{setting.rootNode.label}</span>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function ZoneDetail(props: {
  zone: PresetZone
  t: Translator
}) {
  const zone = props.zone
  return (
    <section className={styles.zoneDetail}>
      <header>
        <p>{props.t('promptResource.zoneDetail')}</p>
        <h1>{zone.displayName}</h1>
        <span>{zone.id}</span>
      </header>
      <dl>
        <div><dt>Band</dt><dd>{zone.band}</dd></div>
        <div><dt>Order</dt><dd>{zone.orderIndex}</dd></div>
        <div><dt>Accepts</dt><dd>{zone.accepts?.join(', ') || 'Any'}</dd></div>
        <div><dt>Provider role</dt><dd>{zone.renderHint.providerRoleHint}</dd></div>
        <div><dt>Wrapper</dt><dd>{zone.renderHint.wrapper}</dd></div>
      </dl>
    </section>
  )
}
