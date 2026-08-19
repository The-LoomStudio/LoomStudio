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
import { ContextAssetHeader } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { findContextAssetPath } from '../../features/context-assets/model/context-asset-tree.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { resolvePresetBuildContextResources } from '../../features/context-assets/model/preset-build-context.js'
import {
  appendCompositionItem,
  createCompositionEntry,
  createCompositionSlot,
  createCompositionZone,
  createMessageBlock,
  findCompositionItem,
  moveCompositionItem,
  readCompositionItems,
  removeCompositionItem,
} from '../../features/context-assets/model/composition-items.js'
import type { ContextAssetNode, PromptCompositionItem, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import styles from './preset-workbench.module.scss'

type PresetWorkbenchProps = {
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  settingMounts: SettingMount[]
  timelinePromptResourceIds?: string[]
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onChangeNodes: (updates: ContextAssetUpdate[]) => void
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onAddNodeInZone?: (resourceId: string, zoneId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onReplaceSettingMounts: (source: SettingMountSource, settingResourceIds: string[]) => Promise<void>
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
      ...resolvePresetBuildContextResources({
        preset: selectedResource,
        resources: props.resources,
        settingMounts: props.settingMounts,
        timelinePromptResourceIds: props.timelinePromptResourceIds,
      }),
    ]
    return resources.map(readPromptResourceWorkbenchRoot)
  }, [props.resources, props.settingMounts, props.timelinePromptResourceIds, selectedResource])
  const workbenchNodes = activePresetView === 'order' ? mainOrderNodes : currentPresetNodes
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const detailNode = selectedNode?.kind === 'order' ? undefined : selectedNode
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(workbenchNodes), [workbenchNodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const [selectedZoneId, setSelectedZoneId] = useState<string>()
  const [selectedCompositionId, setSelectedCompositionId] = useState<string>()
  const zoneDefinitions = orderNode?.skeletonPatch?.zones ?? []
  const selectedZone = zoneDefinitions.find(zone => zone.id === selectedZoneId)
  const compositionItems = orderNode?.skeletonPatch?.items
  const selectedCompositionItem = findCompositionItem(compositionItems ?? [], selectedCompositionId)

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

  function handleAddZone(afterZoneId?: string) {
    if (!orderNode) return
    const currentZones = orderNode.skeletonPatch?.zones
      ? [...orderNode.skeletonPatch.zones]
      : [
          { id: 'preset.system', displayName: 'Preset System', band: 'stable-prefix' as const, orderIndex: 10, parentId: null, renderHint: { providerRoleHint: 'system' as const, wrapper: 'section' as const } },
          { id: 'setting.stable', displayName: 'Stable Setting', band: 'stable-prefix' as const, orderIndex: 20, parentId: null, renderHint: { providerRoleHint: 'system' as const, wrapper: 'section' as const } },
          { id: 'chat.history', displayName: 'Narrative History', band: 'narrative' as const, orderIndex: 30, parentId: null, renderHint: { providerRoleHint: 'system' as const, wrapper: 'message' as const } },
          { id: 'session.history', displayName: 'Session History', band: 'narrative' as const, orderIndex: 35, parentId: null, renderHint: { providerRoleHint: 'assistant' as const, wrapper: 'message' as const } },
          { id: 'setting.lower', displayName: 'Lower Context Setting', band: 'lower-context' as const, orderIndex: 40, parentId: null, renderHint: { providerRoleHint: 'system' as const, wrapper: 'section' as const } },
          { id: 'chat.inside', displayName: 'Current Chat', band: 'current-turn' as const, orderIndex: 60, parentId: null, renderHint: { providerRoleHint: 'user' as const, wrapper: 'message' as const } },
          { id: 'fresh.tail', displayName: 'Fresh Tail', band: 'fresh-tail' as const, orderIndex: 80, parentId: null, renderHint: { providerRoleHint: 'system' as const, wrapper: 'section' as const } },
        ]

    const newZoneId = `custom.zone.${Date.now().toString(36)}`
    const newZone = {
      id: newZoneId,
      displayName: props.t('context.newZoneName'),
      band: 'current-turn' as const,
      orderIndex: (currentZones.length + 1) * 10,
      parentId: null,
      renderHint: {
        providerRoleHint: 'system' as const,
        wrapper: 'section' as const,
      },
    }

    let nextZones: typeof currentZones
    if (afterZoneId) {
      const afterIndex = currentZones.findIndex(z => z.id === afterZoneId)
      if (afterIndex >= 0) {
        nextZones = [
          ...currentZones.slice(0, afterIndex + 1),
          newZone,
          ...currentZones.slice(afterIndex + 1),
        ]
      } else {
        nextZones = [...currentZones, newZone]
      }
    } else {
      nextZones = [...currentZones, newZone]
    }

    props.onCommitNode(orderNode.id, {
      skeletonPatch: {
        ...orderNode.skeletonPatch,
        zones: nextZones,
      },
    })
  }

  function handleDeleteZone(zoneId: string) {
    if (!orderNode || !orderNode.skeletonPatch?.zones) return
    const nextZones = orderNode.skeletonPatch.zones.filter(z => z.id !== zoneId)
    props.onCommitNode(orderNode.id, {
      skeletonPatch: {
        ...orderNode.skeletonPatch,
        zones: nextZones,
      },
    })
  }

  function handleSelectNode(id: string) {
    const compositionItem = findCompositionItem(compositionItems ?? [], id)
    if (compositionItem) {
      setSelectedCompositionId(id)
      setSelectedZoneId(compositionItem.kind === 'zone' ? compositionItem.id : undefined)
      return
    }
    setSelectedCompositionId(undefined)
    setSelectedZoneId(undefined)
    openAssetDetail('preset', props.workspaceId, id)
  }

  function commitCompositionItems(items: PromptCompositionItem[], zones = zoneDefinitions) {
    if (!orderNode) return
    props.onCommitNode(orderNode.id, {
      skeletonPatch: {
        ...orderNode.skeletonPatch,
        items,
        zones,
      },
    })
  }

  function handleAddMessageBlock() {
    const items = readCompositionItems(orderNode)
    commitCompositionItems([...items, createMessageBlock(items)])
  }

  function handleAddZoneToMessageBlock(blockId: string) {
    const items = readCompositionItems(orderNode)
    const zone = createCompositionZone(items, props.t('context.newZoneName'))
    commitCompositionItems(appendCompositionItem(items, zone, blockId), [...zoneDefinitions, zone])
  }

  function handleAddSlotToMessageBlock(blockId: string) {
    const items = readCompositionItems(orderNode)
    const block = findCompositionItem(items, blockId)
    const zoneId = block?.kind === 'message' ? block.items.find(item => item.kind === 'zone')?.id : undefined
    const slot = createCompositionSlot(items, zoneId)
    commitCompositionItems(appendCompositionItem(items, slot, blockId))
  }

  async function handleAddDirectEntry(blockId: string) {
    if (!selectedResource) return
    const createdId = await props.onAddNode(selectedResource.rootNode.id)
    if (!createdId) return
    const items = readCompositionItems(orderNode)
    const entry = createCompositionEntry(items, createdId)
    commitCompositionItems(appendCompositionItem(items, entry, blockId))
    handleSelectNode(createdId)
  }

  function handleDeleteCompositionItem(id: string) {
    const items = readCompositionItems(orderNode)
    const removed = findCompositionItem(items, id)
    const removedZoneIds = new Set<string>()
    if (removed?.kind === 'zone') removedZoneIds.add(removed.id)
    if (removed?.kind === 'message') {
      removed.items.forEach(item => {
        if (item.kind === 'zone') removedZoneIds.add(item.id)
      })
    }
    commitCompositionItems(removeCompositionItem(items, id), zoneDefinitions.filter(zone => !removedZoneIds.has(zone.id)))
    setSelectedCompositionId(undefined)
    setSelectedZoneId(undefined)
  }

  function handleMoveCompositionItem(id: string, direction: 'up' | 'down') {
    const items = readCompositionItems(orderNode)
    commitCompositionItems(moveCompositionItem(items, id, direction))
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      toolbar={(
        <PromptResourceToolbar
          hideSelect
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
      )}
      footer={(
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
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={(
        <ContextAssetProjectionExplorer
          entries={activePresetView === 'order' ? orderedProjectionEntries : presetProjectionEntries}
          nodes={activePresetView === 'order' ? workbenchNodes.filter(node => node.kind !== 'order') : displayNodes}
          query={searchQuery}
          selectedId={selectedCompositionId ?? selectedId}
          selectedZoneId={selectedZoneId}
          t={props.t}
          compositionItems={activePresetView === 'order' && compositionItems?.length ? compositionItems : undefined}
          onAddDirectEntry={handleAddDirectEntry}
          onAddMessageBlock={handleAddMessageBlock}
          onAddSlot={handleAddSlotToMessageBlock}
          onAddZoneToMessageBlock={handleAddZoneToMessageBlock}
          onDeleteCompositionItem={handleDeleteCompositionItem}
          onMoveCompositionItem={handleMoveCompositionItem}
          zoneDefinitions={zoneDefinitions}
          onAddEntryInZone={zoneId => {
            if (selectedResource) void props.onAddNodeInZone?.(selectedResource.id, zoneId)
          }}
          onAddZone={handleAddZone}
          onDeleteNode={props.onDeleteNode}
          onDeleteZone={handleDeleteZone}
          onDuplicateNode={props.onDuplicateNode}
          onQueryChange={setSearchQuery}
          onReorder={handleProjectionReorder}
          onReorderZone={handleProjectionZoneReorder}
          onSelectId={handleSelectNode}
          onSelectZone={setSelectedZoneId}
          onToggleEnabled={(id, enabled) => {
            props.onChangeNode(id, { enabled })
            props.onCommitNode(id, { enabled })
          }}
        />
      )}
    >
      <div className={styles.detailStack}>
        {selectedResource ? (
          <PresetSettingBindings
            preset={selectedResource}
            settings={settingResources}
            settingMounts={props.settingMounts}
            t={props.t}
            onChange={settingResourceIds => props.onReplaceSettingMounts({ kind: 'preset', id: selectedResource.id }, settingResourceIds)}
          />
        ) : null}
        {selectedCompositionItem ? <CompositionItemDetail item={selectedCompositionItem} nodes={workbenchNodes} t={props.t} /> : selectedZone ? <ZoneDetail zone={selectedZone} t={props.t} /> : (
          <ContextAssetEditor
            activationEditable
            editorMode={textEditorMode}
            metadataOpen={metadataOpen}
            node={detailNode}
            pathNodes={findContextAssetPath(workbenchNodes, detailNode?.id)}
            t={props.t}
            onChangeNode={props.onChangeNode}
            onCommitNode={props.onCommitNode}
            onEditorModeChange={setTextEditorMode}
            onMetadataOpenChange={setMetadataOpen}
            onSelectNodeId={handleSelectNode}
          />
        )}
      </div>
    </AssetWorkbenchLayout>
  )
}

function PresetSettingBindings(props: {
  preset: PromptResource
  settings: PromptResource[]
  settingMounts: SettingMount[]
  t: Translator
  onChange(settingResourceIds: string[]): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const linkedIds = props.settingMounts
    .filter(mount => mount.source.kind === 'preset' && mount.source.id === props.preset.id)
    .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
    .map(mount => mount.settingResourceId)
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
        <div><dt>Provider role</dt><dd>{zone.renderHint?.providerRoleHint || '—'}</dd></div>
        <div><dt>Wrapper</dt><dd>{zone.renderHint?.wrapper || '—'}</dd></div>
      </dl>
    </section>
  )
}

function CompositionItemDetail(props: {
  item: PromptCompositionItem
  nodes: ContextAssetNode[]
  t: Translator
}) {
  const sourceNodes = flattenContextNodes(props.nodes)
  const item = props.item
  let sourceLabel: string | undefined
  if (item.kind === 'entry') {
    const source = item.source
    if (source.kind === 'preset') sourceLabel = sourceNodes.find(node => node.id === source.nodeId)?.label ?? source.nodeId
    else sourceLabel = source.bindingId
  }
  return (
    <section className={styles.zoneDetail}>
      <header>
        <p>{item.kind === 'message' ? props.t('context.messageBlockDetail') : props.t('context.compositionItemDetail')}</p>
        <h1>{item.displayName}</h1>
        <span>{item.id}</span>
      </header>
      <dl>
        <div><dt>Kind</dt><dd>{item.kind}</dd></div>
        <div><dt>Order</dt><dd>{item.orderIndex}</dd></div>
        {item.kind === 'message' ? <div><dt>Role</dt><dd>{item.role}</dd></div> : null}
        {item.kind === 'zone' ? <div><dt>Accepts</dt><dd>{item.accepts?.join(', ') || 'Any'}</dd></div> : null}
        {item.kind === 'slot' ? <div><dt>Binding</dt><dd>{item.bindingId}</dd></div> : null}
        {item.kind === 'slot' ? <div><dt>Mode</dt><dd>{item.messageMode || 'context'}</dd></div> : null}
        {sourceLabel ? <div><dt>Source</dt><dd>{sourceLabel}</dd></div> : null}
      </dl>
    </section>
  )
}

export function PresetWorkbenchHeader(props: {
  resources: PromptResource[]
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.preset
  const presetResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'preset'), [props.resources])
  const selectedResource = presetResources[0]

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={props.t(definition.labelKey)}
      resources={presetResources}
      selectedResourceId={selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
