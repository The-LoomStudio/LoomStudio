import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
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
import { buildPresetToolProjection } from '../../features/context-assets/model/preset-tool-projection.js'
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
import type { AgentToolDefinition, ContextAssetNode, PresetToolMount, PresetToolMountInput, PromptCompositionItem, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import styles from './preset-workbench.module.scss'

type PresetWorkbenchProps = {
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  settingMounts: SettingMount[]
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
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
  onReplaceToolMounts: (presetId: string, mounts: PresetToolMountInput[]) => Promise<void>
  onUpdateTool: (tool: AgentToolDefinition) => Promise<void> | void
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
  const toolProjection = useMemo(() => buildPresetToolProjection({
    mounts: props.toolMounts,
    presetId: selectedResource?.id,
    tools: props.tools,
  }), [props.toolMounts, props.tools, selectedResource?.id])
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
    return [...resources.map(readPromptResourceWorkbenchRoot), ...toolProjection.contentNodes]
  }, [props.resources, props.settingMounts, props.timelinePromptResourceIds, selectedResource, toolProjection.contentNodes])
  const workbenchNodes = activePresetView === 'order' ? mainOrderNodes : currentPresetNodes
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const detailNode = selectedNode?.kind === 'order' ? undefined : selectedNode
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(workbenchNodes), [workbenchNodes])
  const { projectionEntries, orderNode, projectionOrderIds, orderedProjectionEntries } = projectionModel
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const [selectedZoneId, setSelectedZoneId] = useState<string>()
  const [selectedCompositionId, setSelectedCompositionId] = useState<string>()
  const [selectedToolId, setSelectedToolId] = useState<string>()
  const presetZoneDefinitions = useMemo(() => orderNode?.skeletonPatch?.zones ?? [], [orderNode?.skeletonPatch?.zones])
  const displayZoneDefinitions = useMemo(() => {
    const ids = new Set(presetZoneDefinitions.map(zone => zone.id))
    return [...presetZoneDefinitions, ...toolProjection.zoneDefinitions.filter(zone => !ids.has(zone.id))]
  }, [orderNode?.skeletonPatch?.zones, toolProjection.zoneDefinitions])
  const selectedZone = presetZoneDefinitions.find(zone => zone.id === selectedZoneId)
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
    if (selectedZoneId && !displayZoneDefinitions.some(zone => zone.id === selectedZoneId)) setSelectedZoneId(undefined)
  }, [selectedZoneId, displayZoneDefinitions])

  useEffect(() => {
    if (!props.tools.length) setSelectedToolId(undefined)
    else if (!selectedToolId || !props.tools.some(tool => tool.id === selectedToolId)) setSelectedToolId(props.tools[0]?.id)
  }, [props.tools, selectedToolId])

  const displayNodes = useMemo(() => {
    return currentPresetNodes
      .filter(node => node.category === 'preset' && node.kind !== 'order')
  }, [currentPresetNodes])
  const presetProjectionEntries = useMemo(() => {
    const presetNodeIds = new Set(flattenContextNodes(displayNodes).map(node => node.id))
    return orderedProjectionEntries.filter(entry => presetNodeIds.has(entry.node.id))
  }, [displayNodes, orderedProjectionEntries])
  function handleProjectionReorder(draggedId: string, targetId: string) {
    if (toolProjection.toolIdByNodeId.has(draggedId) || toolProjection.toolIdByNodeId.has(targetId)) return
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
    const toolId = toolProjection.toolIdByNodeId.get(id)
    if (toolId) {
      setSelectedToolId(toolId)
      setActivePresetView('tools')
      return
    }
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

  function commitCompositionItems(items: PromptCompositionItem[], zones = presetZoneDefinitions) {
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
    commitCompositionItems(appendCompositionItem(items, zone, blockId), [...presetZoneDefinitions, zone])
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
    commitCompositionItems(removeCompositionItem(items, id), presetZoneDefinitions.filter(zone => !removedZoneIds.has(zone.id)))
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
          <button
            aria-current={activePresetView === 'tools' ? 'page' : undefined}
            className={`loom-page-tab ${activePresetView === 'tools' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => setActivePresetView('tools')}
          >
            {props.t('preset.panel.tools')}
          </button>
        </nav>
      )}
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={activePresetView === 'tools' ? (
        <PresetToolExplorer
          selectedToolId={selectedToolId}
          toolMounts={props.toolMounts}
          tools={props.tools}
          presetId={selectedResource?.id}
          onSelect={setSelectedToolId}
        />
      ) : (
        <ContextAssetProjectionExplorer
          entries={activePresetView === 'order' ? orderedProjectionEntries : presetProjectionEntries}
          providerTools={activePresetView === 'order' ? toolProjection.providerTools : undefined}
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
          zoneDefinitions={displayZoneDefinitions}
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
      {activePresetView === 'tools' ? (
        <PresetToolDetail
          mount={props.toolMounts.find(mount => mount.presetResourceId === selectedResource?.id && mount.toolId === selectedToolId)}
          preset={selectedResource}
          presetMounts={props.toolMounts.filter(mount => mount.presetResourceId === selectedResource?.id)}
          tool={props.tools.find(tool => tool.id === selectedToolId)}
          onReplaceMounts={props.onReplaceToolMounts}
          onUpdateTool={props.onUpdateTool}
        />
      ) : <div className={styles.detailStack}>
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
      </div>}
    </AssetWorkbenchLayout>
  )
}

function PresetToolExplorer(props: {
  presetId?: string
  selectedToolId?: string
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  onSelect(toolId: string): void
}) {
  const mountedIds = new Set(props.toolMounts
    .filter(mount => mount.presetResourceId === props.presetId)
    .map(mount => mount.toolId))
  return (
    <div className={styles.toolExplorer}>
      <header>
        <strong>Workspace Tools</strong>
        <span>Preset controls mounting and projection; Agent only applies quick overrides.</span>
      </header>
      {props.tools.map(tool => (
        <button
          className={tool.id === props.selectedToolId ? styles.toolExplorerActive : styles.toolExplorerItem}
          key={tool.id}
          type="button"
          onClick={() => props.onSelect(tool.id)}
        >
          <strong>{tool.name}</strong>
          <span>{tool.input.kind === 'structured' ? 'Provider Tool' : 'Custom / Content Tool'}</span>
          <em>{mountedIds.has(tool.id) ? 'Mounted' : 'Not mounted'}</em>
        </button>
      ))}
    </div>
  )
}

function PresetToolDetail(props: {
  preset?: PromptResource
  tool?: AgentToolDefinition
  mount?: PresetToolMount
  presetMounts: PresetToolMount[]
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
  onUpdateTool(tool: AgentToolDefinition): Promise<void> | void
}) {
  if (!props.preset || !props.tool) {
    return <div className={styles.toolEmpty}>Select a Preset and Tool.</div>
  }
  return (
    <div className={styles.toolDetail}>
      <header className={styles.toolDetailHeader}>
        <div>
          <span>{props.tool.input.kind === 'structured' ? 'Provider Tool' : 'Custom / Content Tool'}</span>
          <h1>{props.tool.name}</h1>
          <p>{props.tool.description}</p>
        </div>
        <code>{props.tool.id}</code>
      </header>
      <ToolMountEditor
        mount={props.mount}
        preset={props.preset}
        presetMounts={props.presetMounts}
        tool={props.tool}
        onReplace={props.onReplaceMounts}
      />
      <ToolEntryEditor tool={props.tool} onSave={props.onUpdateTool} />
    </div>
  )
}

function ToolMountEditor(props: {
  preset: PromptResource
  tool: AgentToolDefinition
  mount?: PresetToolMount
  presetMounts: PresetToolMount[]
  onReplace(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
}) {
  const [draft, setDraft] = useState(() => createMountDraft(props.tool, props.mount))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(createMountDraft(props.tool, props.mount))
    setError(undefined)
  }, [props.mount, props.tool])

  async function replace(mounts: PresetToolMountInput[]) {
    setPending(true)
    try {
      await props.onReplace(props.preset.id, mounts)
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  function toggleMounted() {
    if (props.mount) {
      void replace(props.presetMounts.filter(mount => mount.toolId !== props.tool.id).map(toPresetToolMountInput))
      return
    }
    const nextOrder = Math.max(-1, ...props.presetMounts.map(mount => mount.orderIndex)) + 1
    void replace([
      ...props.presetMounts.map(toPresetToolMountInput),
      createDefaultPresetToolMountInput(props.tool, nextOrder),
    ])
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!props.mount) return
    try {
      const activation = draft.activation.trim()
        ? readJsonObject(draft.activation, 'Activation')
        : undefined
      const providerOrder = readOptionalFiniteNumber(draft.providerOrder, 'Provider Tool order')
      const contentOrder = readOptionalFiniteNumber(draft.contentOrder, 'Content order hint')
      const updated: PresetToolMountInput = {
        toolId: props.tool.id,
        orderIndex: props.mount.orderIndex,
        defaultEnabled: draft.defaultEnabled,
        ...(activation ? { activation } : {}),
        ...(providerOrder === undefined ? {} : { provider: { order: providerOrder } }),
        ...(props.tool.input.kind === 'structured' ? {} : {
          content: {
            ...(draft.contentZone.trim() ? { zone: draft.contentZone.trim() } : {}),
            ...(draft.contentSlot.trim() ? { slot: draft.contentSlot.trim() } : {}),
            ...(draft.contentRankKey.trim() ? { rankKey: draft.contentRankKey.trim() } : {}),
            ...(contentOrder === undefined ? {} : { orderHint: contentOrder }),
          },
        }),
      }
      void replace(props.presetMounts.map(mount => mount.toolId === props.tool.id ? updated : toPresetToolMountInput(mount)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <section className={styles.toolSection}>
      <header>
        <div>
          <h2>Preset Mount</h2>
          <p>Controls whether this Preset exposes the Tool and how its prompt surface is projected.</p>
        </div>
        <label className={styles.toolMountToggle}>
          <input checked={Boolean(props.mount)} disabled={pending} type="checkbox" onChange={toggleMounted} />
          <span>Mounted</span>
        </label>
      </header>
      {props.tool.input.kind === 'structured' ? (
        <p className={styles.providerSurfaceNote}>Provider-managed surface · serialized beside <code>messages</code>. Its internal prompt position is not controlled by Message Zone or Slot.</p>
      ) : (
        <p className={styles.providerSurfaceNote}>Responses Custom Tool uses the provider-managed surface; Chat Completions fallback uses the Content Zone and Slot below.</p>
      )}
      {props.mount ? (
        <form className={`${styles.toolForm} loom-underlined-fields`} onSubmit={submit}>
          <label className={styles.toolCheckbox}><input checked={draft.defaultEnabled} type="checkbox" onChange={event => setDraft(current => ({ ...current, defaultEnabled: event.target.checked }))} /><span>Enabled by default in this Preset</span></label>
          <label><span>Activation · JSON</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.activation} onChange={event => setDraft(current => ({ ...current, activation: event.target.value }))} /></label>
          <fieldset>
            <legend>Provider-managed surface</legend>
            <label><span>Provider Tool order</span><input inputMode="numeric" value={draft.providerOrder} onChange={event => setDraft(current => ({ ...current, providerOrder: event.target.value }))} /></label>
          </fieldset>
          {props.tool.input.kind === 'structured' ? null : (
            <fieldset>
              <legend>Content fallback placement</legend>
              <label><span>Zone</span><input value={draft.contentZone} onChange={event => setDraft(current => ({ ...current, contentZone: event.target.value }))} /></label>
              <label><span>Slot</span><input value={draft.contentSlot} onChange={event => setDraft(current => ({ ...current, contentSlot: event.target.value }))} /></label>
              <label><span>Rank key</span><input value={draft.contentRankKey} onChange={event => setDraft(current => ({ ...current, contentRankKey: event.target.value }))} /></label>
              <label><span>Order hint</span><input inputMode="numeric" value={draft.contentOrder} onChange={event => setDraft(current => ({ ...current, contentOrder: event.target.value }))} /></label>
            </fieldset>
          )}
          {error ? <p className={styles.toolError}>{error}</p> : null}
          <button disabled={pending} type="submit">Save Preset Tool Config</button>
        </form>
      ) : null}
    </section>
  )
}

function ToolEntryEditor(props: {
  tool: AgentToolDefinition
  onSave(tool: AgentToolDefinition): Promise<void> | void
}) {
  const [draft, setDraft] = useState(() => createToolDraft(props.tool))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(createToolDraft(props.tool))
    setError(undefined)
  }, [props.tool])

  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const input = readJsonObject(draft.input, 'Input definition') as AgentToolDefinition['input']
      const parameterDescriptions = draft.parameterDescriptions.trim()
        ? readStringRecord(draft.parameterDescriptions, 'Parameter descriptions')
        : undefined
      const prompt = { ...props.tool.prompt }
      if (parameterDescriptions) prompt.parameterDescriptions = parameterDescriptions
      else delete prompt.parameterDescriptions
      if (draft.guidance.trim()) prompt.guidance = draft.guidance
      else delete prompt.guidance
      setPending(true)
      await props.onSave({
        ...props.tool,
        name: draft.name.trim(),
        description: draft.description,
        input,
        prompt,
      })
      setError(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.toolSection}>
      <header>
        <div>
          <h2>Workspace Tool Entry</h2>
          <p>This edits the single shared Tool Definition. Presets only store mounts and projection policy.</p>
        </div>
      </header>
      <form className={`${styles.toolForm} loom-underlined-fields`} onSubmit={submit}>
        <label><span>Name</span><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label><span>Description</span><textarea value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label><span>Guidance</span><textarea value={draft.guidance} onChange={event => setDraft(current => ({ ...current, guidance: event.target.value }))} /></label>
        <label><span>Input definition · JSON</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.input} onChange={event => setDraft(current => ({ ...current, input: event.target.value }))} /></label>
        <label><span>Parameter descriptions · JSON</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.parameterDescriptions} onChange={event => setDraft(current => ({ ...current, parameterDescriptions: event.target.value }))} /></label>
        {error ? <p className={styles.toolError}>{error}</p> : null}
        <button disabled={pending || !draft.name.trim()} type="submit">Save Workspace Tool Entry</button>
      </form>
    </section>
  )
}

function createMountDraft(tool: AgentToolDefinition, mount?: PresetToolMount) {
  const content = mount ? mount.content ?? {} : tool.prompt?.content ?? {}
  return {
    defaultEnabled: mount?.defaultEnabled ?? true,
    activation: mount?.activation
      ? JSON.stringify(mount.activation, null, 2)
      : !mount && tool.prompt?.activation
        ? JSON.stringify(tool.prompt.activation, null, 2)
        : '',
    providerOrder: (mount ? mount.provider?.order : tool.prompt?.provider?.order)?.toString() ?? '',
    contentZone: content.zone ?? '',
    contentSlot: content.slot ?? '',
    contentRankKey: content.rankKey ?? '',
    contentOrder: content.orderHint?.toString() ?? '',
  }
}

function createDefaultPresetToolMountInput(tool: AgentToolDefinition, orderIndex: number): PresetToolMountInput {
  return {
    toolId: tool.id,
    orderIndex,
    defaultEnabled: true,
    ...(tool.prompt?.activation ? { activation: structuredClone(tool.prompt.activation) } : {}),
    ...(tool.prompt?.provider ? { provider: { ...tool.prompt.provider } } : {}),
    ...(tool.input.kind === 'structured' || !tool.prompt?.content ? {} : { content: { ...tool.prompt.content } }),
  }
}

function toPresetToolMountInput(mount: PresetToolMount): PresetToolMountInput {
  return {
    toolId: mount.toolId,
    orderIndex: mount.orderIndex,
    defaultEnabled: mount.defaultEnabled,
    ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
    ...(mount.provider ? { provider: { ...mount.provider } } : {}),
    ...(mount.content ? { content: { ...mount.content } } : {}),
  }
}

function createToolDraft(tool: AgentToolDefinition) {
  return {
    name: tool.name,
    description: tool.description,
    guidance: tool.prompt?.guidance ?? '',
    input: JSON.stringify(tool.input, null, 2),
    parameterDescriptions: tool.prompt?.parameterDescriptions
      ? JSON.stringify(tool.prompt.parameterDescriptions, null, 2)
      : '',
  }
}

function readJsonObject(value: string, label: string): Record<string, ClientJsonValue> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return parsed as Record<string, ClientJsonValue>
}

function readStringRecord(value: string, label: string): Record<string, string> {
  const parsed = readJsonObject(value, label)
  if (!Object.values(parsed).every(item => typeof item === 'string')) {
    throw new Error(`${label} values must be strings`)
  }
  return parsed as Record<string, string>
}

function readOptionalFiniteNumber(value: string, label: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a finite number`)
  return parsed
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
