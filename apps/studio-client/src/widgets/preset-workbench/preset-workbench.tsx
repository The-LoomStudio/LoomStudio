import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { ChevronDown, ChevronRight, Package, Search, Wrench, X } from 'lucide-react'
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
} from '../../features/context-assets/model/projection-workbench.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { ContextAssetHeader } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { findContextAssetPath, findContextAssetByVirtualPath, flattenContextAssetNodes } from '../../features/context-assets/model/context-asset-tree.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { resolvePresetBuildContextResources } from '../../features/context-assets/model/preset-build-context.js'
import { buildPresetToolProjection } from '../../features/context-assets/model/preset-tool-projection.js'
import { findCompositionItem } from '../../features/context-assets/model/composition-items.js'
import type { AgentToolDefinition, ContextAssetNode, PresetToolMount, PresetToolMountInput, PromptCompositionItem, PromptResource, SettingMount } from '../../entities/index.js'
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
  onAddFolderNode?: (parentId: string) => Promise<string | undefined>
  onAddAnchorNode?: (parentId: string) => Promise<string | undefined>
  onAddMessageBlockNode?: (parentId: string, role?: 'system' | 'user' | 'assistant') => Promise<string | undefined>
  onAddNodeInZone?: (resourceId: string, zoneId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
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
  const setAssetExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setActivePresetView = useStudioLayoutStore(state => state.setPresetView)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const presetResources = useMemo(() => props.resources.filter(resource => resource.resourceKind === 'preset'), [props.resources])
  const [selectedResourceId, setSelectedResourceId] = useState<string>()
  const selectedResource = presetResources.find(resource => resource.id === selectedResourceId) ?? presetResources[0]
  const toolProjection = useMemo(() => buildPresetToolProjection({
    mounts: props.toolMounts,
    presetId: selectedResource?.id,
    tools: props.tools,
  }), [props.toolMounts, props.tools, selectedResource?.id])
  const contextResources = useMemo(() => resolvePresetBuildContextResources({
    preset: selectedResource,
    resources: props.resources,
    settingMounts: props.settingMounts,
    timelinePromptResourceIds: props.timelinePromptResourceIds,
  }), [props.resources, props.settingMounts, props.timelinePromptResourceIds, selectedResource])

  const mainOrderNodes = useMemo(() => {
    if (!selectedResource) return []
    const presetRoot = readPromptResourceWorkbenchRoot(selectedResource)
    return [injectContextNodesIntoPresetTree(presetRoot, contextResources, toolProjection.contentNodes)]
  }, [contextResources, selectedResource, toolProjection.contentNodes])
  const workbenchNodes = mainOrderNodes
  const selectedId = explorerView.selectedId
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const detailNode = selectedNode
  const projectionModel = useMemo(() => buildProjectionWorkbenchModel(workbenchNodes), [workbenchNodes])
  const { orderNode } = projectionModel
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

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail
      if (!detail?.path) return
      
      const matchedNode = findContextAssetByVirtualPath(workbenchNodes, detail.path)
      if (matchedNode) {
        setActivePresetView('assets')
        openAssetDetail('preset', props.workspaceId, matchedNode.id)
        
        const pathNodes = findContextAssetPath(workbenchNodes, matchedNode.id)
        const expandedIds = new Set(explorerView.expandedIds ?? [])
        let changed = false
        for (const pathNode of pathNodes) {
          if (!expandedIds.has(pathNode.id)) {
            expandedIds.add(pathNode.id)
            changed = true
          }
        }
        if (changed) {
          setAssetExpandedIds('preset', props.workspaceId, [...expandedIds])
        }
      }
    }
    
    window.addEventListener('loom:navigate', handleNavigate)
    return () => window.removeEventListener('loom:navigate', handleNavigate)
  }, [workbenchNodes, explorerView.expandedIds, props.workspaceId, setAssetExpandedIds, openAssetDetail, setActivePresetView])

  const displayNodes = mainOrderNodes

  const [mobilePane, setMobilePane] = useState<'explorer' | 'detail'>('explorer')

  function handleSelectNode(id: string) {
    setMobilePane('detail')
    const toolId = toolProjection.toolIdByNodeId.get(id)
    if (toolId) {
      setSelectedToolId(toolId)
      setSelectedCompositionId(undefined)
      setSelectedZoneId(undefined)
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

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      mobilePane={mobilePane}
      onMobilePaneChange={setMobilePane}
      onBack={() => setMobilePane('explorer')}
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
          t={props.t}
          toolMounts={props.toolMounts}
          tools={props.tools}
          presetId={selectedResource?.id}
          onSelect={setSelectedToolId}
        />
      ) : (
        <ContextAssetExplorer
          displayNodes={displayNodes}
          expandedIds={explorerView.expandedIds}
          query={searchQuery}
          selectedId={selectedId}
          t={props.t}
          workspaceId={props.workspaceId}
          onAddNode={props.onAddNode}
          onAddFolderNode={props.onAddFolderNode}
          onAddAnchorNode={props.onAddAnchorNode}
          onAddMessageBlockNode={props.onAddMessageBlockNode}
          onDeleteNode={props.onDeleteNode}
          onDuplicateNode={props.onDuplicateNode}
          onExpandedIdsChange={expandedIds => setAssetExpandedIds('preset', props.workspaceId, expandedIds)}
          onMoveNode={props.onMoveNode}
          onQueryChange={setSearchQuery}
          onSelectId={handleSelectNode}
          onToggleEnabled={(id, enabled) => {
            props.onChangeNode(id, { enabled })
            props.onCommitNode(id, { enabled })
          }}
          onChangeRole={(id, role) => {
            const update = { capabilities: { roleHint: role } }
            props.onChangeNode(id, update)
            props.onCommitNode(id, update)
          }}
        />
      )}
    >
      {activePresetView === 'tools' ? (
        <PresetToolDetail
          mount={props.toolMounts.find(mount => mount.presetResourceId === selectedResource?.id && mount.toolId === selectedToolId)}
          preset={selectedResource}
          presetMounts={props.toolMounts.filter(mount => mount.presetResourceId === selectedResource?.id)}
          t={props.t}
          tool={props.tools.find(tool => tool.id === selectedToolId)}
          onReplaceMounts={props.onReplaceToolMounts}
          onUpdateTool={props.onUpdateTool}
        />
      ) : <div className={styles.detailStack}>
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
  t: Translator
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  onSelect(toolId: string): void
}) {
  const [query, setQuery] = useState('')
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(() => new Set())
  const mountedIds = useMemo(() => new Set(props.toolMounts
    .filter(mount => mount.presetResourceId === props.presetId)
    .map(mount => mount.toolId)), [props.presetId, props.toolMounts])
  const toolGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const groups = new Map<string, AgentToolDefinition[]>()
    for (const tool of props.tools) {
      const searchableText = [tool.name, tool.description, tool.id, tool.owner.namespace, tool.input.kind]
        .join(' ')
        .toLocaleLowerCase()
      if (normalizedQuery && !searchableText.includes(normalizedQuery)) continue
      const tools = groups.get(tool.owner.namespace) ?? []
      tools.push(tool)
      groups.set(tool.owner.namespace, tools)
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([namespace, tools]) => ({
        namespace,
        tools: tools.sort((left, right) => left.name.localeCompare(right.name)),
      }))
  }, [props.tools, query])

  function toggleNamespace(namespace: string) {
    setCollapsedNamespaces(current => {
      const next = new Set(current)
      if (next.has(namespace)) next.delete(namespace)
      else next.add(namespace)
      return next
    })
  }

  return (
    <div className={styles.toolExplorer}>
      <div className={styles.toolSearch}>
        <Search aria-hidden="true" />
        <input
          aria-label={props.t('preset.tools.searchLabel')}
          placeholder={props.t('preset.tools.searchPlaceholder')}
          type="search"
          value={query}
          onChange={event => {
            setQuery(event.target.value)
            setCollapsedNamespaces(new Set())
          }}
        />
        {query ? (
          <button aria-label={props.t('preset.tools.searchClear')} type="button" onClick={() => setQuery('')}>
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className={styles.toolGroups}>
        {toolGroups.length ? toolGroups.map(group => {
          const collapsed = collapsedNamespaces.has(group.namespace)
          const groupId = `tool-group-${group.namespace.replace(/[^a-zA-Z0-9_-]/g, '-')}`
          return (
            <section className={styles.toolGroup} key={group.namespace}>
              <button
                aria-controls={groupId}
                aria-expanded={!collapsed}
                aria-label={props.t(collapsed ? 'context.tree.expand' : 'context.tree.collapse', { label: group.namespace })}
                className={styles.toolGroupHeader}
                type="button"
                onClick={() => toggleNamespace(group.namespace)}
              >
                {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                <Package aria-hidden="true" />
                <strong>{group.namespace}</strong>
                <span>{group.tools.length}</span>
              </button>
              {!collapsed ? (
                <div className={styles.toolGroupItems} id={groupId}>
                  {group.tools.map(tool => (
                    <button
                      className={tool.id === props.selectedToolId ? styles.toolExplorerActive : styles.toolExplorerItem}
                      key={tool.id}
                      type="button"
                      onClick={() => props.onSelect(tool.id)}
                    >
                      <Wrench aria-hidden="true" />
                      <span className={styles.toolExplorerText}>
                        <strong>{tool.name}</strong>
                        <small>{props.t(tool.input.kind === 'structured' ? 'preset.tools.kind.provider' : 'preset.tools.kind.custom')}</small>
                      </span>
                      <em>{props.t(mountedIds.has(tool.id) ? 'preset.tools.mounted' : 'preset.tools.notMounted')}</em>
                    </button>
                  ))}
                </div>
              ) : null}
            </section>
          )
        }) : <div className={styles.toolSearchEmpty}>{props.t('preset.tools.searchEmpty')}</div>}
      </div>
    </div>
  )
}

function PresetToolDetail(props: {
  preset?: PromptResource
  tool?: AgentToolDefinition
  mount?: PresetToolMount
  presetMounts: PresetToolMount[]
  t: Translator
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
  onUpdateTool(tool: AgentToolDefinition): Promise<void> | void
}) {
  if (!props.preset || !props.tool) {
    return <div className={styles.toolEmpty}>{props.t('preset.tools.selectEmpty')}</div>
  }
  return (
    <div className={styles.toolDetail}>
      <header className={styles.toolDetailHeader}>
        <div>
          <span>{props.t(props.tool.input.kind === 'structured' ? 'preset.tools.kind.provider' : 'preset.tools.kind.custom')}</span>
          <h1>{props.tool.name}</h1>
          <p>{props.tool.description}</p>
        </div>
        <code>{props.tool.id}</code>
      </header>
      <ToolMountEditor
        mount={props.mount}
        preset={props.preset}
        presetMounts={props.presetMounts}
        t={props.t}
        tool={props.tool}
        onReplace={props.onReplaceMounts}
      />
      <ToolEntryEditor t={props.t} tool={props.tool} onSave={props.onUpdateTool} />
    </div>
  )
}

function ToolMountEditor(props: {
  preset: PromptResource
  tool: AgentToolDefinition
  mount?: PresetToolMount
  presetMounts: PresetToolMount[]
  t: Translator
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
        ? readJsonObject(draft.activation, props.t('preset.tools.activation'))
        : undefined
      const providerOrder = readOptionalFiniteNumber(draft.providerOrder, props.t('preset.tools.providerOrder'))
      const contentOrder = readOptionalFiniteNumber(draft.contentOrder, props.t('preset.tools.contentOrder'))
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
          <h2>{props.t('preset.tools.mountTitle')}</h2>
          <p>{props.t('preset.tools.mountDescription')}</p>
        </div>
        <label className={styles.toolMountToggle}>
          <input checked={Boolean(props.mount)} disabled={pending} type="checkbox" onChange={toggleMounted} />
          <span>{props.t('preset.tools.mounted')}</span>
        </label>
      </header>
      {props.tool.input.kind === 'structured' ? (
        <p className={styles.providerSurfaceNote}>{props.t('preset.tools.providerSurfaceBefore')} <code>messages</code>{props.t('preset.tools.providerSurfaceAfter')}</p>
      ) : (
        <p className={styles.providerSurfaceNote}>{props.t('preset.tools.customSurfaceNote')}</p>
      )}
      {props.mount ? (
        <form className={`${styles.toolForm} loom-underlined-fields`} onSubmit={submit}>
          <label className={styles.toolCheckbox}><input checked={draft.defaultEnabled} type="checkbox" onChange={event => setDraft(current => ({ ...current, defaultEnabled: event.target.checked }))} /><span>{props.t('preset.tools.enabledByDefault')}</span></label>
          <label><span>{props.t('preset.tools.activationJson')}</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.activation} onChange={event => setDraft(current => ({ ...current, activation: event.target.value }))} /></label>
          <fieldset>
            <legend>{props.t('preset.tools.providerSurface')}</legend>
            <label><span>{props.t('preset.tools.providerOrder')}</span><input inputMode="numeric" value={draft.providerOrder} onChange={event => setDraft(current => ({ ...current, providerOrder: event.target.value }))} /></label>
          </fieldset>
          {props.tool.input.kind === 'structured' ? null : (
            <fieldset>
              <legend>{props.t('preset.tools.contentFallback')}</legend>
              <label><span>{props.t('preset.tools.zone')}</span><input value={draft.contentZone} onChange={event => setDraft(current => ({ ...current, contentZone: event.target.value }))} /></label>
              <label><span>{props.t('preset.tools.slot')}</span><input value={draft.contentSlot} onChange={event => setDraft(current => ({ ...current, contentSlot: event.target.value }))} /></label>
              <label><span>{props.t('preset.tools.rankKey')}</span><input value={draft.contentRankKey} onChange={event => setDraft(current => ({ ...current, contentRankKey: event.target.value }))} /></label>
              <label><span>{props.t('preset.tools.orderHint')}</span><input inputMode="numeric" value={draft.contentOrder} onChange={event => setDraft(current => ({ ...current, contentOrder: event.target.value }))} /></label>
            </fieldset>
          )}
          {error ? <p className={styles.toolError}>{error}</p> : null}
          <button disabled={pending} type="submit">{props.t('preset.tools.saveMount')}</button>
        </form>
      ) : null}
    </section>
  )
}

function ToolEntryEditor(props: {
  t: Translator
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
      const input = readJsonObject(draft.input, props.t('preset.tools.inputDefinition')) as AgentToolDefinition['input']
      const parameterDescriptions = draft.parameterDescriptions.trim()
        ? readStringRecord(draft.parameterDescriptions, props.t('preset.tools.parameterDescriptions'))
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
          <h2>{props.t('preset.tools.entryTitle')}</h2>
          <p>{props.t('preset.tools.entryDescription')}</p>
        </div>
      </header>
      <form className={`${styles.toolForm} loom-underlined-fields`} onSubmit={submit}>
        <label><span>{props.t('preset.tools.name')}</span><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.description')}</span><textarea value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.guidance')}</span><textarea value={draft.guidance} onChange={event => setDraft(current => ({ ...current, guidance: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.inputDefinitionJson')}</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.input} onChange={event => setDraft(current => ({ ...current, input: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.parameterDescriptionsJson')}</span><textarea className={styles.jsonEditor} spellCheck={false} value={draft.parameterDescriptions} onChange={event => setDraft(current => ({ ...current, parameterDescriptions: event.target.value }))} /></label>
        {error ? <p className={styles.toolError}>{error}</p> : null}
        <button disabled={pending || !draft.name.trim()} type="submit">{props.t('preset.tools.saveEntry')}</button>
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

function injectContextNodesIntoPresetTree(
  presetRoot: ContextAssetNode,
  contextResources: PromptResource[],
  toolNodes: ContextAssetNode[],
): ContextAssetNode {
  const slotNodesByAnchor = new Map<string, ContextAssetNode[]>()

  for (const resource of contextResources) {
    const root = readPromptResourceWorkbenchRoot(resource)
    const entries = flattenContextAssetNodes(root.children ?? []).filter(e => e.kind === 'entry')
    if (entries.length === 0) continue

    const targetAnchor = entries[0]?.capabilities?.targetAnchorId ?? '@setting.stable'
    const localDepth = entries[0]?.capabilities?.localDepth ?? 10

    const slotNode: ContextAssetNode = {
      id: `slot.${resource.id}`,
      label: resource.rootNode.label,
      kind: 'slot',
      category: 'setting',
      meta: `Slot • depth ${localDepth}`,
      capabilities: {
        targetAnchorId: targetAnchor,
        localDepth,
      },
      children: entries.map(entry => ({
        ...entry,
        meta: entry.meta ?? 'setting',
      })),
    }

    const list = slotNodesByAnchor.get(targetAnchor) ?? []
    list.push(slotNode)
    slotNodesByAnchor.set(targetAnchor, list)
  }

  if (toolNodes.length > 0) {
    const toolsSlot: ContextAssetNode = {
      id: 'slot.tools',
      label: 'Agent Tools',
      kind: 'slot',
      category: 'runtime',
      meta: `Slot • ${toolNodes.length} tools`,
      capabilities: {
        targetAnchorId: '@chat.tools',
        localDepth: 10,
      },
      children: toolNodes,
    }
    const list = slotNodesByAnchor.get('@chat.tools') ?? []
    list.push(toolsSlot)
    slotNodesByAnchor.set('@chat.tools', list)
  }

  function transformNode(node: ContextAssetNode): ContextAssetNode {
    if (node.kind === 'virtual') {
      const anchorKey = node.label.startsWith('@') ? node.label : (node.capabilities?.targetAnchorId ?? node.label)
      const matchingSlots = (slotNodesByAnchor.get(anchorKey) ?? slotNodesByAnchor.get(node.label) ?? slotNodesByAnchor.get(node.id) ?? [])
        .sort((a, b) => (a.capabilities?.localDepth ?? 0) - (b.capabilities?.localDepth ?? 0))

      return {
        ...node,
        children: matchingSlots.length > 0 ? matchingSlots : undefined,
      }
    }

    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: node.children.map(transformNode),
      }
    }

    return node
  }

  return transformNode(presetRoot)
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
        <div><dt>{props.t('context.detail.band')}</dt><dd>{zone.band}</dd></div>
        <div><dt>{props.t('context.detail.order')}</dt><dd>{zone.orderIndex}</dd></div>
        <div><dt>{props.t('context.detail.accepts')}</dt><dd>{zone.accepts?.join(', ') || props.t('context.detail.any')}</dd></div>
        <div><dt>{props.t('context.detail.providerRole')}</dt><dd>{zone.renderHint?.providerRoleHint || '—'}</dd></div>
        <div><dt>{props.t('context.detail.wrapper')}</dt><dd>{zone.renderHint?.wrapper || '—'}</dd></div>
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
        <div><dt>{props.t('context.detail.kind')}</dt><dd>{item.kind}</dd></div>
        <div><dt>{props.t('context.detail.order')}</dt><dd>{item.orderIndex}</dd></div>
        {item.kind === 'message' ? <div><dt>{props.t('context.detail.role')}</dt><dd>{item.role}</dd></div> : null}
        {item.kind === 'zone' ? <div><dt>{props.t('context.detail.accepts')}</dt><dd>{item.accepts?.join(', ') || props.t('context.detail.any')}</dd></div> : null}
        {item.kind === 'slot' ? <div><dt>{props.t('context.detail.binding')}</dt><dd>{item.bindingId}</dd></div> : null}
        {item.kind === 'slot' ? <div><dt>{props.t('context.detail.mode')}</dt><dd>{item.messageMode || 'context'}</dd></div> : null}
        {sourceLabel ? <div><dt>{props.t('context.detail.source')}</dt><dd>{sourceLabel}</dd></div> : null}
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
