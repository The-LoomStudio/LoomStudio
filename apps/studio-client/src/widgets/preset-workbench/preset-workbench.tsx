import { RelatedLore } from '../../features/prompt-resources/ui/related-lore/related-lore.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { cardMediaUrl } from '../../shared/lib/card-media.js'
import studioLogoUrl from '../../shared/assets/logo.png'
import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import { presetIconUrl, useExtensionIdentities } from '../../shared/ui/extension-icon/extension-icon.js'
import { PresetLibraryCatalog, type PresetCatalogSource } from '../../features/prompt-resources/ui/preset-library/preset-library-catalog.js'
import { PresetConfigurationDialog } from '../../features/prompt-resources/ui/preset-library/preset-configuration-dialog.js'
import { AgentModelSelection } from '../../features/provider-settings/ui/agent-model-selection.js'
import { isPromptMessageSequence } from '@loom-studio/shared'
import { ResourceUnavailable } from '../../shared/ui/resource-unavailable/resource-unavailable.js'
import type { ResourceSearchReveal } from '../../shared/lib/search-match.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import { AlertTriangle, ArrowLeft, ArrowUpRight, Link2, Plus, Upload, SlidersHorizontal, BookOpen, Braces, Copy, Download, Folder, FolderOpen, Package, Regex, Star, ToggleLeft, ToggleRight, Trash2, Wrench } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Dialog, IconButton, SearchField, Textarea } from '@loom-studio/ui'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { readPromptResourceWorkbenchRoot } from '../../features/prompt-resources/model/prompt-resource-view.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/prompt-resources/ui/context-asset-workbench.js'
import { readContextAssetBadgeInfo, renderContextAssetTreeIcon } from '../../features/prompt-resources/ui/context-asset-tree.js'
import { flattenContextAssetNodes, findContextAssetNode, findContextAssetPath, findContextAssetByVirtualPath } from '../../features/prompt-resources/model/context-asset-tree.js'
import { PromptResourceToolbar } from '../../features/prompt-resources/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { buildPresetTokenProjection } from '../../features/prompt-resources/model/preset-token-projection.js'
import { useResourceTokenSnapshot } from '../../features/prompt-resources/model/use-resource-token-snapshot.js'
import { presetAnchorDeclarations } from '../../features/prompt-resources/model/preset-declarations.js'
import { createDefaultPresetToolMountInput, toPresetToolMountInput, togglePresetToolMount, validPresetToolMounts } from '../../features/prompt-resources/model/preset-tool-mounts.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import { buildPresetToolProjection } from '../../features/prompt-resources/model/preset-tool-projection.js'
import type { AgentToolDefinition, Card, ContextAssetNode, PresetToolMount, PresetToolMountInput, PromptResource, LoreMount } from '../../entities/index.js'
import styles from './preset-workbench.module.scss'
import { AgentModelEditor } from '../../features/prompt-resources/ui/agent-model-editor.js'
import { NarrativeRangePreview } from './narrative-range-preview.js'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'

function toolDisplayGroup(tool: AgentToolDefinition): string {
  if (tool.id === 'official/codeact' || tool.id === 'official/codeact_json') return 'official.codeact'
  return tool.owner.namespace === 'official' ? 'official.fixed' : tool.owner.namespace || 'default'
}

function usageSource(origin: PromptResource['origin'], imported = false): string {
  if (origin?.kind === 'extension-package') return origin.packageId
  if (origin?.kind === 'builtin') return '官方资源'
  return imported ? '导入资源' : '个人资源'
}

function usageSection(origin: PromptResource['origin']): string {
  return origin?.kind === 'extension-package' || origin?.kind === 'builtin' ? '扩展' : '个人'
}

function usageGroupNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap(node => node.isSection ? usageGroupNodes(node.children ?? []) : node.kind === 'folder' ? [node] : [])
}

function usageFolders(entries: Array<{ source: string; section?: string; node: FileTreeNode }>, query: string): FileTreeNode[] {
  const search = normalizeSearchText(query)
  const sections = new Map<string, Map<string, FileTreeNode[]>>()
  for (const { source, section = '', node } of entries) {
    if (!normalizeSearchText(`${section} ${source} ${node.label} ${node.meta ?? ''}`).includes(search)) continue
    const groups = sections.get(section) ?? new Map<string, FileTreeNode[]>()
    const children = groups.get(source) ?? []
    children.push(node)
    groups.set(source, children)
    sections.set(section, groups)
  }
  return [...sections].sort(([a], [b]) => ['角色', '扩展', '个人', '不可用引用'].indexOf(a) - ['角色', '扩展', '个人', '不可用引用'].indexOf(b)).flatMap(([section, groups]) => {
    const children = [...groups].flatMap(([source, entries]) => section === '个人' || section === '不可用引用'
      ? entries
      : [{ id: `source:${section}:${source}`, label: source, kind: 'folder', children: entries }])
    return section ? [{ id: `section:${section}`, label: section, isSection: true, children }] : children
  })
}

type PresetWorkbenchProps = {
  promptResourceApi?: StudioApi['promptResources']
  onNavigateResource?(path: string): void
  onRelatedResourceChanged?(): void | Promise<void>
  active: boolean
  onReturnToLibrary?(): void
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  onCreateModel(accountId: string, modelId: string): Promise<void>
  onListModels(accountId: string): Promise<string[]>
  onSaveModel(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  resourceBindings?: import('../../features/prompt-resources/ui/prompt-resource-toolbar/resource-bindings.js').ResourceBindingsSource
  extensionInstallations?: import('../../entities/index.js').ListExtensionInstallationsResult['installations']
  resources: PromptResource[]
  loreMounts: LoreMount[]
  tools: AgentToolDefinition[]
  toolsReady?: boolean
  providersReady?: boolean
  toolMounts: PresetToolMount[]
  timelinePromptResourceIds?: string[]
  card?: Card
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  draftResourceIds: string[]
  onDiscardDraft(resourceId: string): void
  onRetryDraft(resourceId: string): Promise<void>
  onRenameNode(id: string, label: string): Promise<void>
  onCommitNode: (id: string, partial: Partial<ContextAssetNode>) => void
  onBatchToggleEnabled?: (ids: string[], enabled: boolean) => Promise<{ failedIds: string[]; error?: string }>
  onMoveNode: (draggedId: string, targetId: string, position: 'before' | 'inside' | 'after') => void
  onAddNode: (parentId: string) => Promise<string | undefined>
  onAddFolderNode?: (parentId: string) => Promise<string | undefined>
  onAddAnchorNode?: (parentId: string) => Promise<string | undefined>
  onAddMessageBlockNode?: (parentId: string, role?: 'system' | 'user' | 'assistant') => Promise<string | undefined>
  onAddMessageSequenceNode?: (parentId: string) => Promise<string | undefined>
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onExportResourceZip?: (resourceId: string) => Promise<void>
  onImportResourceZip?: (file: File) => Promise<string | undefined>
  onReplaceToolMounts: (presetId: string, mounts: PresetToolMountInput[], expectedMountIds: string[]) => Promise<void>
  onReplaceLoreMounts: (source: { kind: 'preset'; id: string }, mounts: Array<{ id: string } | { loreResourceId: string }>, expectedMountIds: string[]) => Promise<void>
  onUpdateTool: (tool: AgentToolDefinition) => Promise<void> | void
  onOpenTool?: (toolId: string) => void
  routeToolId?: string
  routeAssetId?: string
  routeResourceId?: string
  globalSearchQuery?: string
  searchMatch?: ResourceSearchReveal
  searchQuery: string
  onSearchQueryChange(value: string): void
  selectedResourceId?: string
  onSelectResource?: (resourceId: string) => void
  onOpenLore?: (resourceId: string, nodeId: string) => void
  previewApi: StudioApi['narratives']
  previewTimelineId?: string
  previewBranchId?: string
  t: Translator
  workspaceId: string
  textTransformsApi: StudioApi['textTransforms']
  onOpenTextUse?: (kind: 'rule' | 'extractor', id: string) => void
}

export function PresetWorkbench(props: PresetWorkbenchProps) {
  const extensionIdentities = useExtensionIdentities()
  const presets = props.resources.filter(resource => resource.resourceKind === 'preset')
  const [configurationId, setConfigurationId] = useState<string>()
  const [localEditingId, setLocalEditingId] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  const pending = useRef(false)
  const configured = presets.find(preset => preset.id === configurationId)
  const [libraryTab, setLibraryTab] = useWorkbenchView<'presets' | 'tools'>('agent.library', 'presets', ['presets', 'tools'])
  const [libraryToolId, setLibraryToolId] = useState<string>()
  const [toolPane, setToolPane] = useState<'master' | 'detail'>('master')
  useEffect(() => {
    if (props.routeToolId) { setLibraryTab('tools'); setLibraryToolId(props.routeToolId); setToolPane('detail') }
    else if (props.routeResourceId || props.routeAssetId) setLibraryTab('presets')
  }, [props.routeToolId, props.routeResourceId, props.routeAssetId])
  const editing = libraryTab === 'presets' && Boolean(props.routeResourceId || props.routeAssetId || localEditingId)
  useEffect(() => { if (!props.active) setConfigurationId(undefined) }, [props.active])
  const sourceOf = (preset: PromptResource): PresetCatalogSource => {
    const origin = preset.origin
    if (origin?.kind === 'extension-package') {
      const identity = extensionIdentities.find(item => item.packageId === origin.packageId)
      const installation = props.extensionInstallations?.find(item => item.id === origin.installationId && item.packageId === origin.packageId)
      const target = installation?.target.kind === 'card' ? `角色 · ${props.card?.id === installation.target.cardId ? props.card.name : installation.target.cardId}` : installation?.target.kind === 'global' || !origin.installationId ? '全局' : '安装来源未解析'
      return { id: `package:${origin.packageId}:${origin.installationId ?? ''}`, name: `${identity?.displayName ?? origin.packageId} · ${target}`, iconUrl: identity?.iconUrl, kind: 'package', description: `${target}${installation ? ` · v${installation.packageVersion}` : ''}` }
    }
    return origin?.kind === 'builtin' ? { id: 'official', name: 'Loom Studio', kind: 'official', iconUrl: studioLogoUrl }
      : { id: 'personal', name: '我的预设', kind: 'personal' }
  }
  const sources = [...new Map(presets.map(preset => { const source = sourceOf(preset); return [source.id, source] })).values()]
  if (!sources.some(source => source.kind === 'personal')) sources.push({ id: 'personal', name: '我的预设', kind: 'personal' })
  const importPresetInput = useRef<HTMLInputElement>(null)
  async function configureOperation<T,>(operation: () => Promise<T>): Promise<T> {
    if (pending.current) throw new Error('预设配置正在保存，请稍候。')
    pending.current = true; setSaving(true); setSaveError(undefined)
    try { return await operation() }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : String(cause)); throw cause }
    finally { pending.current = false; setSaving(false) }
  }
  const configure = (id: string) => { setConfigurationId(id); setSaveError(undefined) }
  const open = (id: string) => {
    setConfigurationId(undefined)
    if (props.onSelectResource) props.onSelectResource(id)
    else setLocalEditingId(id)
  }
  const projection = buildPresetToolProjection({ mounts: props.toolMounts, presetId: configured?.id, tools: props.tools })
  const toolbar = <>
    <IconButton size="small" title="新建预设" aria-label="新建预设" onClick={() => { void configureOperation(() => props.onCreateResource('preset')).catch(() => undefined) }}><Plus size={16} /></IconButton>
    <IconButton size="small" title="导入预设" aria-label="导入预设" onClick={() => importPresetInput.current?.click()}><Upload size={16} /></IconButton>
    <input ref={importPresetInput} hidden type="file" accept=".json,.zip" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''
      if (file) void configureOperation(() => file.name.endsWith('.zip') && props.onImportResourceZip ? props.onImportResourceZip(file) : props.onImportResource(file)).catch(() => undefined)
    }} />
  </>
  return <div className={styles.libraryHost}>
    {saveError && !configured && <p role="alert">{saveError}</p>}
    {!editing && <PanelTabs className={styles.libraryTabs} ariaLabel="Agent 资源库" activeId={libraryTab} onChange={setLibraryTab}
      items={[{ id: 'presets', label: '预设库' }, { id: 'tools', label: '工具库' }]} />}
    {libraryTab === 'tools' && <div className={styles.libraryPane}>
      <MasterDetailWorkbench navigationScope="local" mobilePane={toolPane} onMobilePaneChange={setToolPane} hasSelection={Boolean(libraryToolId)}
        master={<PresetToolExplorer selectedToolId={libraryToolId} t={props.t} toolMounts={props.toolMounts} tools={props.tools} presets={presets}
          onOpenPreset={configure} onSelect={id => { setLibraryToolId(id); setToolPane('detail') }} />}>
        <PresetToolDetail promptResourceApi={props.promptResourceApi} onNavigateResource={props.onNavigateResource} onRelatedResourceChanged={props.onRelatedResourceChanged} toolsReady={props.toolsReady} t={props.t} tool={props.tools.find(tool => tool.id === libraryToolId)} onUpdateTool={props.onUpdateTool} />
      </MasterDetailWorkbench>
    </div>}
    <div className={styles.libraryPane} hidden={editing || libraryTab !== 'presets'}>
      <PresetLibraryCatalog active={props.active && !editing && libraryTab === 'presets'} sources={sources} items={presets.map(preset => ({
        id: preset.id, sourceId: sourceOf(preset).id, name: preset.rootNode.label,
        iconUrl: presetIconUrl(preset, extensionIdentities),
        modelLabel: preset.model?.modelId ?? props.t('agent.model.unbound'),
        toolCount: props.toolMounts.filter(mount => mount.presetResourceId === preset.id && mount.defaultEnabled !== false).length,
        resourceCount: props.loreMounts.filter(mount => mount.source.kind === 'preset' && mount.source.id === preset.id).length + (preset.textUses?.length ?? 0),
        draft: props.draftResourceIds.includes(preset.id),
      }))} actions={toolbar} itemActions={item => <>
        <IconButton size="small" title="复制预设" aria-label={`复制${item.name}`} onClick={() => { void configureOperation(() => props.onDuplicateResource(item.id)).catch(() => undefined) }}><Copy size={16} /></IconButton>
        <IconButton size="small" title="删除预设" aria-label={`删除${item.name}`} onClick={() => {
          if (window.confirm(`删除预设“${item.name}”？`)) void configureOperation(() => props.onDeleteResource(item.id)).catch(() => undefined)
        }}><Trash2 size={16} /></IconButton>
      </>} onConfigure={configure} onOpen={open} />
    </div>
    {editing && <div className={styles.libraryPane}>
      <PresetArrangementWorkbench {...props} selectedResourceId={localEditingId ?? props.selectedResourceId} onConfigure={configure}
        onReturnToLibrary={() => { setLocalEditingId(undefined); props.onReturnToLibrary?.() }} />
    </div>}
    <PresetConfigurationDialog open={!!configured} title={configured?.rootNode.label ?? '预设配置'} source={configured ? sourceOf(configured).name : undefined}
      busy={saving} onClose={() => setConfigurationId(undefined)} headerActions={configured && <>
        <IconButton aria-label="复制预设" size="small" onClick={() => { void configureOperation(() => props.onDuplicateResource(configured.id)).catch(() => undefined) }}><Copy size={16} /></IconButton>
        <IconButton aria-label="导出预设" size="small" onClick={() => { void configureOperation(() => props.onExportResource(configured.id)).catch(() => undefined) }}><Download size={16} /></IconButton>
        <IconButton aria-label="删除预设" size="small" variant="danger" onClick={() => {
          if (!window.confirm(`删除预设“${configured.rootNode.label}”？`)) return
          void configureOperation(() => props.onDeleteResource(configured.id)).then(() => setConfigurationId(undefined)).catch(() => undefined)
        }}><Trash2 size={16} /></IconButton>
      </>}>
      {configured && <div className={styles.configurationBody}>
        {saving && <p role="status" className={styles.configurationStatus}>正在保存…</p>}
        {saveError && <p role="alert" className={styles.configurationStatus}>{saveError}</p>}
        <div className={styles.configurationContent} inert={saving}>
          <AgentPresetOverview key={configured.id} {...props} preset={configured} installations={props.extensionInstallations}
            unavailableMounts={projection.unavailableMounts} hideHeader
            onSaveModel={input => configureOperation(() => props.onSaveModel(input))}
            onReplaceMounts={(id, mounts, baseline) => configureOperation(() => props.onReplaceToolMounts(id, validPresetToolMounts(mounts, props.tools), baseline))}
            onReplaceLoreMounts={(source, mounts, baseline) => configureOperation(() => props.onReplaceLoreMounts(source, mounts, baseline))}
            onDuplicate={async () => { await props.onDuplicateResource(configured.id) }}
            onDelete={async () => { await props.onDeleteResource(configured.id); setConfigurationId(undefined) }}
            onExport={() => props.onExportResource(configured.id)}
            onOpenTool={props.onOpenTool ? id => { setConfigurationId(undefined); props.onOpenTool!(id) } : undefined}
            onOpenLore={(id, node) => { setConfigurationId(undefined); props.onOpenLore?.(id, node) }}
            onOpenTextUse={(kind, id) => { setConfigurationId(undefined); props.onOpenTextUse?.(kind, id) }} />
        </div>
      </div>}
    </PresetConfigurationDialog>
  </div>
}

export function PresetArrangementWorkbench(props: PresetWorkbenchProps & { onConfigure(id: string): void }) {
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.preset)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setAssetExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const presetResources = useMemo(() => props.resources.filter(resource => resource.resourceKind === 'preset'), [props.resources])
  const [internalSelectedResourceId, setInternalSelectedResourceId] = useState<string>()
  const mobilePane = useStudioLayoutStore(state => state.assetPanes.preset[props.workspaceId] ?? 'explorer')
  const legacyResource = props.routeAssetId && !props.routeResourceId
    ? presetResources.find(resource => findContextAssetNode([resource.rootNode], props.routeAssetId))
    : undefined
  const selectedResourceId = props.routeResourceId ?? legacyResource?.id ?? props.selectedResourceId ?? internalSelectedResourceId
  const setSelectedResourceId = (id: string | undefined) => {
    setInternalSelectedResourceId(id)
    setAssetPane('preset', props.workspaceId, 'explorer')
    if (id) props.onSelectResource?.(id)
  }
  const selectedResource = presetResources.find(resource => resource.id === selectedResourceId)
    ?? (selectedResourceId || props.routeAssetId ? undefined : presetResources[0])
  const toolProjection = useMemo(() => buildPresetToolProjection({
    mounts: props.toolMounts,
    presetId: selectedResource?.id,
    tools: props.tools,
  }), [props.toolMounts, props.tools, selectedResource?.id])
  const mainOrderNodes = useMemo(() => selectedResource
    ? [readPromptResourceWorkbenchRoot(selectedResource)] : [], [selectedResource])
  const workbenchNodes = mainOrderNodes
  const initializedExpansion = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!selectedResource) return
    const key = JSON.stringify([props.workspaceId, selectedResource.id])
    if (initializedExpansion.current === key) return
    initializedExpansion.current = key
    const expanded = new Set(useStudioLayoutStore.getState().assetLayouts.preset.views[props.workspaceId]?.expandedIds ?? [])
    expanded.add(selectedResource.rootNode.id)
    for (const node of flattenContextAssetNodes(mainOrderNodes)) {
      if (node.kind === 'message') expanded.add(node.id)
    }
    setAssetExpandedIds('preset', props.workspaceId, [...expanded])
  }, [selectedResource, mainOrderNodes, props.workspaceId, setAssetExpandedIds])
  const selectedId = explorerView.selectedId
  const tokenSnapshot = useResourceTokenSnapshot(selectedResource ? [selectedResource.rootNode] : [], `${props.workspaceId}:${selectedResource?.id ?? ''}`)
  const selectedNode = findContextAssetNode(workbenchNodes, selectedId)
  const detailNode = selectedNode
  const tokenProjection = useMemo(() => detailNode?.kind === 'virtual' && selectedResource ? buildPresetTokenProjection({
    preset: selectedResource, resources: props.resources, loreMounts: props.loreMounts,
    timelinePromptResourceIds: props.timelinePromptResourceIds,
  }) : undefined, [detailNode?.kind, selectedResource, props.resources, props.loreMounts, props.timelinePromptResourceIds])
  const declarations = useMemo(() => detailNode?.kind === 'virtual' && !isPromptMessageSequence(detailNode) && selectedResource
    ? presetAnchorDeclarations({
      anchor: detailNode, presetId: selectedResource.id, resources: props.resources,
      loreMounts: props.loreMounts, timelinePromptResourceIds: props.timelinePromptResourceIds,
    }) : undefined, [detailNode, selectedResource?.id, props.resources, props.loreMounts, props.timelinePromptResourceIds])
  const declarationNodes = useMemo(() => declarations?.nodes.map(node => ({
    ...node,
    label: ({
      timeline: '当前 Timeline 引用',
      global: '全局挂载',
      extension: '扩展',
      builtin: '官方',
    } as Record<string, string>)[node.label] ?? node.label,
  })) ?? [], [declarations])
  const [declarationExpandedIds, setDeclarationExpandedIds] = useState<string[]>([])
  const searchQuery = props.searchQuery
  const hasDetailSelection = Boolean(selectedNode)

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('preset', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeResourceId, props.routeAssetId, props.searchMatch?.requestId, props.workspaceId])



  useEffect(() => {
    setAssetPane('preset', props.workspaceId, props.routeResourceId || props.routeToolId ? 'detail' : 'explorer')
  }, [props.routeResourceId, props.routeToolId, selectedResource?.id])



  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail
      if (!detail?.path) return
      
      const matchedNode = findContextAssetByVirtualPath(workbenchNodes, detail.path)
      if (matchedNode) {
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
  }, [workbenchNodes, explorerView.expandedIds, props.workspaceId, setAssetExpandedIds, openAssetDetail])


  const displayNodes: ContextAssetNode[] = useMemo(() => {
    return (selectedResource ? [selectedResource] : []).map(preset => {
      const isSelected = preset.id === selectedResource?.id
      const origin = preset.origin
      const isBuiltin = origin?.kind === 'builtin'
      const isExtension = origin?.kind === 'extension-package'
      const installation = isExtension
        ? props.extensionInstallations?.find(inst => inst.id === origin.installationId && inst.packageId === origin.packageId)
        : undefined
      const originLabel = isBuiltin
        ? props.t('promptResource.official')
        : isExtension
          ? (installation?.packageId ?? origin.packageId)
          : props.t('agent.sources.workspace')
      const modelLabel = preset.model?.modelId ?? props.t('agent.model.unbound')

      const promptChildren: ContextAssetNode[] = (isSelected && mainOrderNodes[0]?.children
        ? mainOrderNodes[0].children
        : preset.rootNode.children ?? []) as ContextAssetNode[]

      return {
        id: preset.rootNode.id,
        label: preset.rootNode.label,
        kind: 'folder',
        category: 'preset-root',
        enabled: preset.rootNode.enabled,
        meta: `${originLabel} · ${modelLabel}`,
        children: promptChildren,
      }
    })
  }, [presetResources, selectedResource?.id, mainOrderNodes, props.t, props.extensionInstallations])

  function handleSelectNode(id?: string) {
    if (!id) return
    setAssetPane('preset', props.workspaceId, 'detail')

    const clickedPreset = presetResources.find(p => p.id === id || p.rootNode.id === id)
    if (clickedPreset) {
      setSelectedResourceId(clickedPreset.id)
      openAssetDetail('preset', props.workspaceId, clickedPreset.rootNode.id)
      return
    }

    const matchedPreset = presetResources.find(p => findContextAssetNode([p.rootNode], id))
    if (matchedPreset && matchedPreset.id !== selectedResourceId) {
      setSelectedResourceId(matchedPreset.id)
    }

    openAssetDetail('preset', props.workspaceId, id)
  }

  async function handleDeleteResource(resourceId: string) {
    await props.onDeleteResource(resourceId)
    setInternalSelectedResourceId(current => current === resourceId ? undefined : current)
  }

  const handleRenameNode = async (id: string, label: string) => {
    const matchedPreset = presetResources.find(p => p.id === id || p.rootNode.id === id)
    const targetId = matchedPreset ? matchedPreset.rootNode.id : id
    await props.onRenameNode(targetId, label)
  }

  if (!props.routeToolId && (selectedResourceId || props.routeAssetId) && (!selectedResource || (props.routeAssetId && !findContextAssetNode([selectedResource.rootNode], props.routeAssetId)))) {
    return <ResourceUnavailable message={props.t('promptResource.referenceUnavailable')} />
  }

  const configurationAction = <button type="button" aria-label="配置预设" title="配置预设"
    disabled={!selectedResource} onClick={() => { if (selectedResource) props.onConfigure(selectedResource.id) }}>
    <SlidersHorizontal aria-hidden="true" />
  </button>

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      hasSelection={hasDetailSelection}
      mobilePane={mobilePane}
      onMobilePaneChange={pane => setAssetPane('preset', props.workspaceId, pane)}
      toolbar={(
        <PromptResourceToolbar
          trailingActions={configurationAction}
          tokenSnapshot={tokenSnapshot}
          resourceKind="preset"
          resources={presetResources}
          selectedResourceId={selectedResource?.id}
          t={props.t}
          onCreate={props.onCreateResource}
          draftResourceIds={props.draftResourceIds}
          onDiscardDraft={props.onDiscardDraft}
          onRetryDraft={props.onRetryDraft}
          onDelete={handleDeleteResource}
          onDuplicate={props.onDuplicateResource}
          onImport={props.onImportResource}
          onImportZip={props.onImportResourceZip}
          onSelect={setSelectedResourceId}
        />
      )}
      header={(
        <div>
          {props.onReturnToLibrary && <Button className={styles.libraryBack} size="small" variant="ghost" onClick={props.onReturnToLibrary}>
            <ArrowLeft size={15} />预设库
          </Button>}
          {toolProjection.unavailableMounts.length > 0 ? (
            <div>
              {toolProjection.unavailableMounts.map(mount => <p key={`tool:${mount.id}`} role="status">{props.t('preset.tools.unavailable', { id: mount.toolId })}</p>)}
            </div>
          ) : null}
        </div>
      )}
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={(
        <ContextAssetExplorer
            highlightQuery={props.globalSearchQuery}
          tokenSnapshot={tokenSnapshot}
          active={props.active}
          highlightMessages
          displayNodes={displayNodes}
          expandedIds={explorerView.expandedIds}
          query={searchQuery}
          scrollKey={`preset:${props.workspaceId}`}
          selectedId={selectedId}
          t={props.t}
          virtualized
          workspaceId={props.workspaceId}
          onAddNode={props.onAddNode}
          onAddFolderNode={props.onAddFolderNode}
          onAddAnchorNode={props.onAddAnchorNode}
          onAddMessageBlockNode={props.onAddMessageBlockNode}
          onAddMessageSequenceNode={props.onAddMessageSequenceNode}
          onDeleteNode={props.onDeleteNode}
            onBatchToggleEnabled={props.onBatchToggleEnabled}
          onDuplicateNode={props.onDuplicateNode}
          onRenameNode={handleRenameNode}
          onExpandedIdsChange={expandedIds => setAssetExpandedIds('preset', props.workspaceId, expandedIds)}
          onMoveNode={props.onMoveNode}
          onQueryChange={props.onSearchQueryChange}
          onSelectId={handleSelectNode}
          onToggleEnabled={(id, enabled) => {
            props.onChangeNode(id, { enabled })
            props.onCommitNode(id, { enabled })
          }}
          onChangeRole={(id, role) => {
            const node = findContextAssetPath(workbenchNodes, id).at(-1)
            const update = { capabilities: { ...node?.capabilities, roleHint: role } }
            props.onChangeNode(id, update)
            props.onCommitNode(id, update)
          }}
        />
      )}
    >
      {(
        <div className={styles.detailStack}>
          <div className={`${styles.authorDetail} ${detailNode?.kind === 'virtual' ? styles.anchorDetail : ''}`}>
            <ContextAssetEditor
              activationEditable
              allowTargetAnchor={false}
              compactVirtualNotes
              editorMode={textEditorMode}
              metadataOpen={metadataOpen}
              node={detailNode}
              revealMatch={props.searchMatch?.resourceId === selectedResource?.id && props.searchMatch?.nodeId === detailNode?.id
                ? props.searchMatch : undefined}
              tokenNode={detailNode?.kind === 'virtual' && tokenProjection ? findContextAssetNode([tokenProjection.root], detailNode.id) : undefined}
              tokenIncomplete={detailNode?.kind === 'virtual' ? tokenProjection?.incompleteIds.has(detailNode.id) : undefined}
              pathNodes={findContextAssetPath(workbenchNodes, detailNode?.id)}
              t={props.t}
              onChangeNode={props.onChangeNode}
              onCommitNode={props.onCommitNode}
              onEditorModeChange={setTextEditorMode}
              onMetadataOpenChange={setMetadataOpen}
            />
            {declarations ? <section className={styles.declarations}>
              <h3>声明注入此处的资源</h3>
              <p>静态候选；本轮是否触发由运行时决定。</p>
              {detailNode?.kind === 'virtual' && (detailNode.capabilities?.targetAnchorId === '@chat.tools' || detailNode.label === '@chat.tools') ? <p>工具内容由运行时及当前工具挂载决定；这里不展示实际激活结果。</p> : null}
              <FileTree ariaLabel="声明注入此处的资源" nodes={declarationNodes}
                expandedIds={declarationExpandedIds} onExpandedIdsChange={setDeclarationExpandedIds}
                getDisclosureLabel={item => item.label} getDragLabel={item => item.label}
                moreActionsLabel={props.t('context.actionMore')}
                renderMetaLeading={item => {
                  const target = declarations.targets.get(item.id)
                  const badge = target && readContextAssetBadgeInfo(target.node, props.t)
                  return badge ? <span title={badge.label}>{badge.label}</span> : null
                }}
                isMuted={item => declarations.targets.get(item.id)?.enabled === false}
                renderTrailing={item => {
                  const target = declarations.targets.get(item.id)
                  if (!target || target.node.readOnly) return null
                  const enabled = target.node.enabled !== false
                  const label = props.t(enabled ? 'context.actionDisable' : 'context.actionEnable')
                  return <button type="button" className={styles.declarationToggle} title={label}
                    aria-label={`${label} ${target.node.label}`} aria-pressed={enabled}
                    onClick={event => {
                      event.stopPropagation()
                      props.onChangeNode(target.node.id, { enabled: !enabled })
                      props.onCommitNode(target.node.id, { enabled: !enabled })
                    }}>{enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}</button>
                }}
                onSelect={item => {
                  const target = declarations.targets.get(item.id)
                  if (target) props.onOpenLore?.(target.resource.id, target.node.id)
                  else setDeclarationExpandedIds(current => current.includes(item.id)
                    ? current.filter(id => id !== item.id) : [...current, item.id])
                }}
                renderIcon={(item, expanded) => {
                  const target = declarations.targets.get(item.id)
                  return target ? renderContextAssetTreeIcon(target.node, expanded) : expanded ? <FolderOpen size={16} /> : <Folder size={16} />
                }}
              />
            </section> : null}
            {detailNode?.kind === 'virtual'
              && (detailNode.capabilities?.targetAnchorId === '@chat.narrative' || detailNode.label === '@chat.narrative')
              ? <NarrativeRangePreview key={detailNode.id} api={props.previewApi}
                  timelineId={props.previewTimelineId} branchId={props.previewBranchId} t={props.t} />
              : null}
          </div>
        </div>
      )}
    </AssetWorkbenchLayout>
  )
}

export function AgentPresetOverview(props: {
  hideHeader?: boolean
  preset: PromptResource
  textTransformsApi: StudioApi['textTransforms']
  onOpenTextUse?: (kind: 'rule' | 'extractor', id: string) => void
  installations?: PresetWorkbenchProps['extensionInstallations']
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  onCreateModel(accountId: string, modelId: string): Promise<void>
  onListModels(accountId: string): Promise<string[]>
  tools: AgentToolDefinition[]
  toolsReady?: boolean
  providersReady?: boolean
  toolMounts: PresetToolMount[]
  loreMounts: LoreMount[]
  card?: Card
  resources: PromptResource[]
  unavailableMounts: PresetToolMount[]
  t: Translator
  onSaveModel(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[], expectedMountIds: string[]): Promise<void>
  onReplaceLoreMounts(source: { kind: 'preset'; id: string }, mounts: Array<{ id: string } | { loreResourceId: string }>, expectedMountIds: string[]): Promise<void>
  onDuplicate(): Promise<void>
  onDelete(): Promise<void>
  onExport(): Promise<void>
  onOpenLore?: (resourceId: string, nodeId: string) => void
  onOpenTool?: (toolId: string) => void
}) {
  const identities = useExtensionIdentities()
  const origin = props.preset.origin
  const isBuiltin = origin?.kind === 'builtin'
  const isExtension = origin?.kind === 'extension-package'
  const installation = isExtension
    ? props.installations?.find(item => item.id === origin.installationId && item.packageId === origin.packageId)
    : undefined
  const originLabel = isBuiltin
    ? props.t('promptResource.official')
    : isExtension
      ? `${origin.packageId} · ${installation?.target.kind === 'card'
          ? props.t('promptResource.cardInstallation', { id: installation.target.cardId })
          : installation?.target.kind === 'global' || !origin.installationId
            ? props.t('promptResource.globalInstallation')
            : props.t('promptResource.unresolvedInstallation')}`
      : props.t('agent.sources.workspace')

  const presetMounts = useMemo(() =>
    props.toolMounts.filter(m => m.presetResourceId === props.preset.id),
    [props.toolMounts, props.preset.id]
  )
  const usedLore = props.loreMounts
    .filter(mount => mount.source.kind === 'preset' && mount.source.id === props.preset.id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const mountedToolMap = useMemo(() =>
    new Map(presetMounts.map(m => [m.toolId, m])),
    [presetMounts]
  )

  const toolGroups = useMemo(() => {
    const groups = new Map<string, AgentToolDefinition[]>()
    for (const tool of props.tools) {
      const ns = toolDisplayGroup(tool)
      const list = groups.get(ns) ?? []
      list.push(tool)
      groups.set(ns, list)
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, tools]) => ({
        namespace,
        tools: tools.sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [props.tools])

  const [collapsedToolSources, setCollapsedToolSources] = useState<string[]>([])
  const [toolQuery, setToolQuery] = useState('')
  const [mountSettingsId, setMountSettingsId] = useState<string>()
  const [pendingToolId, setPendingToolId] = useState<string>()
  const [toolError, setToolError] = useState<string>()
  const [loreBusy, setLoreBusy] = useState(false)
  const [loreError, setLoreError] = useState<string>()
  const [loreQuery, setLoreQuery] = useState('')
  const [collapsedLoreSources, setCollapsedLoreSources] = useState<string[]>([])
  const loreRows = [
    ...usedLore.map(mount => {
      const resourceId = mount.resolvedLoreResourceId === null ? undefined
        : mount.resolvedLoreResourceId ?? mount.loreResourceId
      const resource = props.resources.find(item => item.id === resourceId && item.resourceKind === 'lore')
      return { id: `mount:${mount.id}`, mount, resource }
    }),
    ...props.resources.filter(item => item.resourceKind === 'lore'
      && !usedLore.some(mount => (mount.resolvedLoreResourceId ?? mount.loreResourceId) === item.id))
      .map(resource => ({ id: `resource:${resource.id}`, mount: undefined, resource })),
  ]
  const loreRowsById = new Map(loreRows.map(row => [row.id, row]))
  const cardLoreIds = new Set(props.card?.promptResourceIds ?? [])
  const isCardLore = (nodeId: string) => {
    const resource = loreRowsById.get(nodeId)?.resource
    return Boolean(resource && cardLoreIds.has(resource.id))
  }
  const globalLoreIds = new Set(props.loreMounts.filter(mount => mount.source.kind === 'manual' && mount.source.id === 'global' && mount.resolvedLoreResourceId !== null)
    .map(mount => mount.resolvedLoreResourceId ?? mount.loreResourceId))
  const isGlobalLore = (nodeId: string) => globalLoreIds.has(loreRowsById.get(nodeId)?.resource?.id ?? '')
  const loreNodes = (useCardLore: boolean, useGlobalLore: boolean) => usageFolders(
    [...loreRows.filter(row => isCardLore(row.id)), ...loreRows.filter(row => !isCardLore(row.id))].map(row => ({
    section: isCardLore(row.id) ? '角色' : row.resource ? usageSection(row.resource.origin) : '不可用引用',
    source: isCardLore(row.id) ? props.card!.name
      : row.resource ? identities.find(identity => row.resource?.origin?.kind === 'extension-package' && identity.packageId === row.resource.origin.packageId)?.displayName ?? usageSource(row.resource.origin, Boolean(row.resource.sourceArtifactRef)) : '不可用引用',
    node: {
      id: row.id, label: row.resource?.rootNode.label ?? `Lore 引用不可用：${row.mount!.loreResourceId}`,
      kind: 'entry' as const, meta: isCardLore(row.id) && useCardLore
        ? '随角色默认采用' : isGlobalLore(row.id) && useGlobalLore ? '随全局默认采用' : row.mount ? row.resource ? '已采用' : '未解析' : '未采用',
    },
  })), loreQuery)
  const toolsByNodeId = new Map(props.tools.map(tool => [`tool:${tool.id}`, tool]))
  const toolEnabled = (nodeId: string) => {
    const tool = toolsByNodeId.get(nodeId)
    const mount = tool && mountedToolMap.get(tool.id)
    return Boolean(mount && mount.defaultEnabled !== false)
  }
  const unavailableToolsByNodeId = new Map(props.unavailableMounts.map(mount => [`unavailable:${mount.id}`, mount]))
  const unavailableToolSource = props.t('preset.tools.unavailableGroup')
  const toolNodes = usageFolders([
    ...toolGroups.flatMap(group => {
      const source = group.namespace === 'official.codeact' ? 'CodeAct（Freeform / JSON）'
        : group.namespace === 'official.fixed' ? '官方固定功能工具'
          : group.namespace === 'native' || group.namespace === 'system' ? `原生工具 (${group.namespace})`
            : group.namespace === 'image' || group.namespace === 'image-generation' ? `生图工具 (${group.namespace})`
              : `${group.namespace} 工具集`
      return group.tools.map(tool => ({
        source,
        node: { id: `tool:${tool.id}`, label: tool.name, kind: 'entry', meta: tool.id,
        },
      }))
    }),
    ...props.unavailableMounts.map(mount => ({
      source: unavailableToolSource,
      node: { id: `unavailable:${mount.id}`, label: props.t('preset.tools.unavailable', { id: mount.toolId }), kind: 'entry', meta: mount.toolId },
    })),
  ], toolQuery).map(node => ({
    ...node,
    meta: node.label === unavailableToolSource ? node.meta : `${node.children!.filter(child => toolEnabled(child.id)).length} / ${node.children!.length} 已启用`,
  }))
  const expandedToolIds = toolNodes.filter(node => !collapsedToolSources.includes(node.id)).map(node => node.id)

  async function saveLore(mounts: Array<{ id: string } | { loreResourceId: string }>) {
    if (loreBusy) return
    setLoreBusy(true)
    setLoreError(undefined)
    try {
      await props.onReplaceLoreMounts({ kind: 'preset', id: props.preset.id }, mounts, usedLore.map(mount => mount.id))
    } catch (error) {
      setLoreError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoreBusy(false)
    }
  }
  const currentLoreMounts = () => usedLore.map(mount => ({ id: mount.id }))

  async function handleToggleTool(tool: AgentToolDefinition) {
    if (pendingToolId) return
    setPendingToolId(tool.id)
    setToolError(undefined)
    try {
      await props.onReplaceMounts(props.preset.id, togglePresetToolMount(presetMounts, tool), presetMounts.map(mount => mount.id))
    } catch (caught) {
      setToolError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPendingToolId(undefined)
    }
  }

  async function handleRemoveUnavailable(toolId: string) {
    const next = presetMounts.filter(m => m.toolId !== toolId).map(toPresetToolMountInput)
    await props.onReplaceMounts(props.preset.id, next, presetMounts.map(mount => mount.id))
  }

  async function handleRemoveAllUnavailable() {
    const unavailableSet = new Set(props.unavailableMounts.map(m => m.toolId))
    const next = presetMounts.filter(m => !unavailableSet.has(m.toolId)).map(toPresetToolMountInput)
    await props.onReplaceMounts(props.preset.id, next, presetMounts.map(mount => mount.id))
  }

  return (
    <div className={styles.presetOverview}>
      <header className={styles.presetOverviewHeader} hidden={props.hideHeader}>
        <div className={styles.presetOverviewTitleGroup}>
          <h1>{props.preset.rootNode.label}</h1>
          <span className={styles.presetOverviewOrigin}>{originLabel}</span>
        </div>
        <div className={styles.presetOverviewActions}>
          <IconButton aria-label="复制预设" size="small" onClick={props.onDuplicate}><Copy size={16} aria-hidden="true" /></IconButton>
          <IconButton aria-label="导出编排" size="small" onClick={props.onExport}><Download size={16} aria-hidden="true" /></IconButton>
          <IconButton aria-label="删除预设" size="small" variant="danger" onClick={props.onDelete}><Trash2 size={16} aria-hidden="true" /></IconButton>
        </div>
      </header>

      <PresetTextUses modelContent={<section className={styles.presetConfigSection} inert={props.providersReady === false}>
        <h2>
          <span>{props.t('agent.profile.model')}</span>
        </h2>
        <AgentModelEditor
          key={props.preset.id}
          preset={props.preset}
          onCreateModel={props.onCreateModel}
          onSave={props.onSaveModel}
          t={props.t}
          renderModelPicker={input => <AgentModelSelection {...input} modelProfiles={props.modelProfiles}
            providerAccounts={props.providerAccounts} onListModels={props.onListModels} t={props.t} />}
        />
      </section>} preset={props.preset} api={props.textTransformsApi} t={props.t}
        onSave={props.onSaveModel} onOpen={props.onOpenTextUse}
        card={props.card} identities={identities}
        cardLoreCount={loreRows.filter(row => isCardLore(row.id)).length}
        loreContent={(useCardLore, useGlobalLore) => {
          const inherited = (nodeId: string) => (isCardLore(nodeId) && useCardLore) || (isGlobalLore(nodeId) && useGlobalLore)
          const nodes = loreNodes(useCardLore, useGlobalLore)
          const enabled = (nodeId: string) => Boolean(loreRowsById.get(nodeId)?.mount
            || inherited(nodeId))
          return <section className={styles.presetResourceList} aria-label="Lore 使用资源">
        <SearchField aria-label="搜索 Lore" placeholder="搜索名称或来源"
          clearLabel="清除搜索" value={loreQuery} onClear={() => setLoreQuery('')}
          onChange={event => { setLoreQuery(event.target.value); setCollapsedLoreSources([]) }} />
        {loreError ? <p role="alert">{loreError}</p> : null}
        <FileTree key={props.preset.id} ariaLabel="Lore 来源目录" nodes={nodes}
          batchDisabled={loreBusy}
          canBatchSelect={node => node.kind !== 'folder' && !inherited(node.id)}
          getBatchActions={selected => [
            { id: 'enable', label: props.t('common.batchEnable'), disabled: selected.some(node => !loreRowsById.get(node.id)?.resource), run: async selected => {
              const mounts: Array<{ id: string } | { loreResourceId: string }> = currentLoreMounts()
              for (const node of selected) {
                const row = loreRowsById.get(node.id)
                if (row?.resource && !row.mount) mounts.push({ loreResourceId: row.resource.id })
              }
              await props.onReplaceLoreMounts({ kind: 'preset', id: props.preset.id }, mounts, usedLore.map(mount => mount.id))
            } },
            { id: 'remove', label: props.t('common.batchRemove'), run: async selected => {
              const ids = new Set(selected.map(node => loreRowsById.get(node.id)?.mount?.id))
              await props.onReplaceLoreMounts({ kind: 'preset', id: props.preset.id }, currentLoreMounts().filter(mount => !ids.has(mount.id)), usedLore.map(mount => mount.id))
            } },
          ]}
          expandedIds={usageGroupNodes(nodes).filter(node => !collapsedLoreSources.includes(node.id)).map(node => node.id)}
          onExpandedIdsChange={ids => setCollapsedLoreSources(usageGroupNodes(nodes).filter(node => !ids.includes(node.id)).map(node => node.id))}
          getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
          getDragLabel={node => node.label} moreActionsLabel="更多操作"
          isMuted={node => {
            const row = loreRowsById.get(node.id)
            return Boolean(row && (!enabled(node.id) || !row.resource))
          }}
          onSelect={node => {
            const resource = loreRowsById.get(node.id)?.resource
            if (resource) props.onOpenLore?.(resource.id, resource.rootNode.id)
          }}
          renderIcon={(node, expanded) => node.kind === 'folder'
            ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
            : isCardLore(node.id)
              ? <Star size={15} className={enabled(node.id) ? styles.usageEnabledIcon : undefined} />
              : <BookOpen size={15} className={enabled(node.id) ? styles.usageEnabledIcon : undefined} />}
          renderTrailing={node => {
            const row = loreRowsById.get(node.id)
            if (!row) return null
            const { mount, resource } = row
            const isInherited = inherited(node.id)
            return resource ? <button type="button" className={styles.declarationToggle}
                aria-label={`${enabled(node.id) ? '停用' : '启用'} Lore：${resource.rootNode.label}`}
                title={isInherited ? '随角色或全局采用，由对应继承开关控制' : mount ? '停用条目' : '启用条目'}
                aria-pressed={enabled(node.id)} disabled={loreBusy || isInherited}
                onClick={() => void saveLore(mount
                  ? currentLoreMounts().filter(item => item.id !== mount.id)
                  : [...currentLoreMounts(), { loreResourceId: resource.id }])}>
                {enabled(node.id) ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
              </button> : <IconButton aria-label="移除 Lore" title="移除引用" size="small" disabled={loreBusy}
                onClick={() => void saveLore(currentLoreMounts().filter(item => item.id !== mount!.id))}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
          }} />
        {!nodes.length && <p className={styles.presetResourceEmpty}>没有匹配的 Lore</p>}
      </section>}}
      toolsContent={<section inert={props.toolsReady === false} className={styles.presetResourceList} aria-label={props.t('preset.tools.mountTitle')}>
        <SearchField aria-label="搜索工具" placeholder="搜索名称或来源"
          clearLabel="清除搜索" value={toolQuery} onClear={() => setToolQuery('')}
          onChange={event => { setToolQuery(event.target.value); setCollapsedToolSources([]) }} />
        {toolError ? <p className={styles.toolError} role="alert">{toolError}</p> : null}
        <FileTree key={props.preset.id} ariaLabel="工具来源目录" variant="indented" nodes={toolNodes} expandedIds={expandedToolIds}
          batchDisabled={Boolean(pendingToolId)}
          canBatchSelect={node => node.kind !== 'folder'}
          getBatchActions={selected => [
            ...([true, false] as const).map(enabled => ({
              id: enabled ? 'enable' : 'disable', label: props.t(enabled ? 'common.batchEnable' : 'common.batchDisable'),
              disabled: selected.some(node => !toolsByNodeId.has(node.id)),
              run: async (nodes: FileTreeNode[]) => {
                const mounts = presetMounts.map(toPresetToolMountInput)
                for (const node of nodes) {
                  const tool = toolsByNodeId.get(node.id)
                  if (!tool) continue
                  const mount = mounts.find(item => item.toolId === tool.id)
                  if (mount) mount.defaultEnabled = enabled
                  else if (enabled) mounts.push(createDefaultPresetToolMountInput(tool, Math.max(-1, ...mounts.map(item => item.orderIndex)) + 1))
                }
                await props.onReplaceMounts(props.preset.id, mounts, presetMounts.map(mount => mount.id))
              },
            })),
            { id: 'remove', label: props.t('common.batchRemove'), run: async nodes => {
              const ids = new Set(nodes.map(node => toolsByNodeId.get(node.id)?.id ?? unavailableToolsByNodeId.get(node.id)?.toolId))
              await props.onReplaceMounts(props.preset.id, presetMounts.filter(mount => !ids.has(mount.toolId)).map(toPresetToolMountInput), presetMounts.map(mount => mount.id))
            } },
          ]}
          onExpandedIdsChange={ids => {
            setCollapsedToolSources(toolNodes.filter(node => !ids.includes(node.id)).map(node => node.id))
          }}
          getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
          getDragLabel={node => node.label} moreActionsLabel="更多操作"
          onSelect={() => {}}
          isMuted={node => node.kind !== 'folder' && !toolEnabled(node.id)}
          renderIcon={(node, expanded) => node.kind === 'folder'
            ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
            : <Wrench size={15} className={toolEnabled(node.id) ? styles.usageEnabledIcon : undefined} />}
          renderExpandedRow={node => toolsByNodeId.get(node.id)?.description
            ? <p className={styles.toolDescription}>{toolsByNodeId.get(node.id)!.description}</p> : null}
          renderTrailing={node => {
            if (node.kind === 'folder') return node.label === unavailableToolSource
              ? <IconButton size="small" title={props.t('preset.tools.removeUnavailable')}
                aria-label={props.t('preset.tools.removeUnavailable')} onClick={handleRemoveAllUnavailable}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton> : null
            const unavailable = unavailableToolsByNodeId.get(node.id)
            if (unavailable) return <IconButton size="small" title="移除不可用工具"
              aria-label={`移除工具：${unavailable.toolId}`} onClick={() => void handleRemoveUnavailable(unavailable.toolId)}>
              <Trash2 size={14} aria-hidden="true" />
            </IconButton>
            const tool = toolsByNodeId.get(node.id)!
            const enabled = toolEnabled(node.id)
            return <>
              <IconButton size="small" title="工具在此预设中的配置" aria-label={`配置工具：${tool.name}`} onClick={() => setMountSettingsId(tool.id)}><SlidersHorizontal size={16} /></IconButton>
              {props.onOpenTool && <IconButton size="small" title="查看工具详情"
                aria-label={`查看工具详情：${tool.name}`} onClick={() => props.onOpenTool!(tool.id)}>
                <ArrowUpRight size={16} aria-hidden="true" />
              </IconButton>}
              <button type="button" className={styles.declarationToggle}
              title={enabled ? '停用工具' : '启用工具'} aria-label={`${enabled ? '停用' : '启用'}工具：${tool.name}`}
              aria-pressed={enabled} disabled={Boolean(pendingToolId)}
              onClick={() => void handleToggleTool(tool)}>
              {enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
            </button>
            </>
          }} />
        {mountSettingsId && toolsByNodeId.get(`tool:${mountSettingsId}`) && <Dialog open title="工具在此预设中的配置" onClose={() => setMountSettingsId(undefined)}>
          <ToolMountEditor key={mountSettingsId} tool={toolsByNodeId.get(`tool:${mountSettingsId}`)!} preset={props.preset}
            mount={mountedToolMap.get(mountSettingsId)} presetMounts={presetMounts} t={props.t} onReplace={props.onReplaceMounts} />
        </Dialog>}
        {!toolNodes.length && <p className={styles.presetResourceEmpty}>没有匹配的工具</p>}
      </section>} />
    </div>
  )
}

function PresetCardInheritance({ card, enabled, count, resourceLabel }: {
  card?: Card; enabled: boolean; count?: number; resourceLabel: string
}) {
  const avatar = card && cardMediaUrl(card.id, 'avatar', card.media?.avatarAssetId, card.version)
  return <span className={styles.presetInheritanceSource}>
    {avatar && <img src={avatar} alt="" width={20} height={20} />}
    <span>{card ? `${card.name} · ${count === undefined ? '' : count === 0 ? `暂无关联${resourceLabel} · ` : `${count} 项${resourceLabel} · `}${enabled ? '跟随当前角色' : '未继承'}`
      : enabled ? '尚未选择角色，将随故事的当前角色采用' : '尚未选择角色 · 未继承'}</span>
  </span>
}

export function PresetTextUses(props: {
  card?: Card
  identities?: ReturnType<typeof useExtensionIdentities>
  cardLoreCount?: number
  t: Translator
  preset: PromptResource
  api: StudioApi['textTransforms']
  onSave(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  onOpen?: (kind: 'rule' | 'extractor', id: string) => void
  loreContent?: ReactNode | ((useCardLore: boolean, useGlobalLore: boolean) => ReactNode)
  toolsContent?: ReactNode
  modelContent?: ReactNode
}) {
  type TextUse = NonNullable<PromptResource['textUses']>[number]
  const editableUses = (uses: PromptResource['textUses'] = []): TextUse[] => uses.map(use => ({
    id: use.id, kind: use.kind, enabled: use.enabled,
    ...(use.orderIndex !== undefined ? { orderIndex: use.orderIndex } : {}),
  }))
  type RuleSummary = Awaited<ReturnType<StudioApi['textTransforms']['listRuleSummaries']>>['rules'][number]
  type ExtractorSummary = Awaited<ReturnType<StudioApi['textTransforms']['listExtractorSummaries']>>['extractors'][number]
  const [rules, setRules] = useState<RuleSummary[]>([])
  const [extractors, setExtractors] = useState<ExtractorSummary[]>([])
  const [baseline, setBaseline] = useState(props.preset)
  const [storedDraft, setDraft] = useState(() => ({
    textUses: editableUses(props.preset.textUses),
    useCardLore: props.preset.useCardLore ?? true,
    useGlobalLore: props.preset.useGlobalLore ?? true,
    useCardText: props.preset.useCardText ?? true,
    useGlobalText: props.preset.useGlobalText ?? true,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useWorkbenchView<'model' | 'lore' | 'text' | 'tools'>('preset.configuration', props.modelContent ? 'model' : 'lore', props.modelContent ? ['model', 'lore', 'text', 'tools'] : ['lore', 'text', 'tools'])
  const [textQuery, setTextQuery] = useState('')
  const [collapsedTextSources, setCollapsedTextSources] = useState<string[]>([])
  const readDraft = (preset: PromptResource) => ({
    textUses: editableUses(preset.textUses),
    useCardLore: preset.useCardLore ?? true, useGlobalLore: preset.useGlobalLore ?? true,
    useCardText: preset.useCardText ?? true, useGlobalText: preset.useGlobalText ?? true,
  })
  const baseDraft = readDraft(baseline)
  const dirty = JSON.stringify(storedDraft) !== JSON.stringify(baseDraft)
  const currentBaseline = !dirty && props.preset.version > baseline.version ? props.preset : baseline
  const draft = !dirty ? readDraft(currentBaseline) : storedDraft
  const conflict = dirty && props.preset.version > baseline.version && !busy


  useEffect(() => {
    let active = true
    Promise.all([props.api.listRuleSummaries(), props.api.listExtractorSummaries()])
      .then(([ruleResult, extractorResult]) => {
        if (active) {
          setRules(ruleResult.rules)
          setExtractors(extractorResult.extractors)
        }
      })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [props.api])

  function toggle(kind: TextUse['kind'], id: string, defaultEnabled: boolean) {
    const previous = draft.textUses.find(use => use.kind === kind && use.id === id)
    const enabled = !(previous?.enabled ?? defaultEnabled)
    const textUses = draft.textUses.filter(use => use.kind !== kind || use.id !== id)
    if (enabled !== defaultEnabled) textUses.push({ ...previous, id, kind, enabled })
    void save({ ...draft, textUses }).catch(() => undefined)
  }

  async function save(next = draft, base = currentBaseline) {
    if (busy) return
    setBaseline(base)
    setDraft(next)
    setBusy(true)
    setError(undefined)
    try {
      const saved = await props.onSave({
        agentPresetId: props.preset.id,
        expectedVersion: base.version,
        textUses: next.textUses,
        useCardLore: next.useCardLore,
        useGlobalLore: next.useGlobalLore,
        useCardText: next.useCardText, useGlobalText: next.useGlobalText,
      })
      setBaseline(saved)
      setDraft(readDraft(saved))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }

  function textSource(item: RuleSummary | ExtractorSummary): string {
    if (item.owner.kind === 'card') return props.card?.id === item.owner.cardId ? props.card.name : '其他角色'
    if (item.owner.kind === 'preset') return props.preset.rootNode.label
    const packageId = item.owner.kind === 'extension' ? item.owner.packageId : item.origin?.packageId
    return props.identities?.find(identity => identity.packageId === packageId)?.displayName ?? packageId ?? usageSource(item.origin)
  }
  const resources = [
    ...rules.map(rule => ({ ...rule, kind: 'rule' as const })),
    ...extractors.map(extractor => ({ ...extractor, kind: 'extractor' as const })),
  ]
  const candidates = resources.filter(item => item.owner.kind === 'card' ? item.owner.cardId === props.card?.id
    : item.owner.kind === 'preset' ? item.owner.presetId === props.preset.id : true).map(item => ({
      kind: item.kind, id: item.id, name: item.name,
      enabled: item.enabled && (item.owner.kind === 'card' ? draft.useCardText : item.owner.kind === 'preset' || draft.useGlobalText),
      section: item.owner.kind === 'card' ? '角色' : item.owner.kind === 'extension' ? '扩展' : usageSection(item.origin),
      source: textSource(item), cardSource: item.owner.kind === 'card',
    }))
  const candidatesById = new Map(candidates.map(item => [`${item.kind}:${item.id}`, item]))
  const textEnabled = (nodeId: string) => {
    const item = candidatesById.get(nodeId)
    return item ? draft.textUses.find(use => use.kind === item.kind && use.id === item.id)?.enabled ?? item.enabled : false
  }
  const missing = draft.textUses.filter(use => !candidates.some(item => item.kind === use.kind && item.id === use.id))
  const textNodes = usageFolders([
    ...candidates.map(item => ({
      section: item.section, source: item.source,
      node: {
        id: `${item.kind}:${item.id}`, label: item.name, kind: 'entry' as const,
        meta: `${item.kind === 'rule' ? '正则' : '提取器'} · ${draft.textUses.some(use => use.kind === item.kind && use.id === item.id) ? '预设配置' : item.enabled ? item.cardSource ? '随当前角色采用' : '随全局采用' : '未采用'}`,
      },
    })),
    ...missing.map(use => ({
      section: '不可用引用', source: '不可用引用',
      node: { id: `${use.kind}:${use.id}`, label: resources.find(item => item.kind === use.kind && item.id === use.id)?.name ?? '原资源已删除或不可用', kind: 'entry' as const,
        meta: resources.some(item => item.kind === use.kind && item.id === use.id) ? '不属于当前角色或预设 · 可移除引用' : `引用失效 · ${use.id}` },
    })),
  ], textQuery)

  return <div data-loom-mobile-tab-scope="" className={styles.presetUsageConfig}>
    <PanelTabs items={[
      ...(props.modelContent ? [{ id: 'model' as const, label: '模型与审批' }] : []),
      { id: 'lore', label: 'Lore' },
      { id: 'text', label: '正则 / 提取器' },
      { id: 'tools', label: '工具' },
    ]} activeId={activeTab} onChange={setActiveTab} ariaLabel="预设使用配置" size="compact" />
    <section role="tabpanel" aria-label="模型与审批" hidden={activeTab !== 'model'} className={styles.presetUsagePanel}>{props.modelContent}</section>
    <section role="tabpanel" aria-label="Lore" hidden={activeTab !== 'lore'} className={styles.presetUsagePanel}>
      <div className={styles.presetUsageOption}>
        <span className={styles.presetResourceName}>使用全局世界书</span>
        <button type="button" className={styles.declarationToggle} aria-label="使用全局世界书"
          title={draft.useGlobalLore ? '停用全局世界书' : '启用全局世界书'}
          aria-pressed={draft.useGlobalLore} disabled={busy}
          onClick={() => void save({ ...draft, useGlobalLore: !draft.useGlobalLore }).catch(() => undefined)}>
          {draft.useGlobalLore ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
        </button>
      </div>
      <div className={styles.presetUsageOption}>
        <span className={styles.presetResourceName}>使用角色世界书
          <PresetCardInheritance card={props.card} enabled={draft.useCardLore} count={props.cardLoreCount} resourceLabel="Lore" />
        </span>
        <button type="button" className={styles.declarationToggle} aria-label="使用角色世界书"
          title={draft.useCardLore ? '停用角色世界书' : '启用角色世界书'}
          aria-pressed={draft.useCardLore} disabled={busy}
          onClick={() => void save({ ...draft, useCardLore: !draft.useCardLore }).catch(() => undefined)}>
          {draft.useCardLore ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
        </button>
      </div>
      {typeof props.loreContent === 'function' ? props.loreContent(draft.useCardLore, draft.useGlobalLore) : props.loreContent}
    </section>
    <section role="tabpanel" aria-label="正则 / 提取器" hidden={activeTab !== 'text'} className={styles.presetUsagePanel}>
      {(['useGlobalText', 'useCardText'] as const).map(key => <div key={key} className={styles.presetUsageOption}>
        <span className={styles.presetResourceName}>{key === 'useCardText' ? '使用当前角色规则' : '使用全局规则'}
          {key === 'useCardText' && <PresetCardInheritance card={props.card} enabled={draft.useCardText}
            count={candidates.filter(item => item.cardSource).length} resourceLabel="正则 / 提取器" />}
        </span>
        <button type="button" className={styles.declarationToggle}
          aria-label={key === 'useCardText' ? '使用当前角色规则' : '使用全局规则'} aria-pressed={draft[key]} disabled={busy}
          onClick={() => void save({ ...draft, [key]: !draft[key] }).catch(() => undefined)}>
          {draft[key] ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
        </button>
      </div>)}
      {missing.length > 0 && <p role="status">有 {missing.length} 项引用已失效或在当前角色下不可用，可在下方单独移除。</p>}
      <SearchField aria-label="搜索正则与提取器" placeholder="搜索名称或来源"
        clearLabel="清除搜索" value={textQuery} onClear={() => setTextQuery('')}
        onChange={event => { setTextQuery(event.target.value); setCollapsedTextSources([]) }} />
      <FileTree key={props.preset.id} ariaLabel="正则与提取器来源目录" nodes={textNodes}
        batchDisabled={busy}
        canBatchSelect={node => node.kind !== 'folder'}
        getBatchActions={selected => [
          ...([true, false] as const).map(enabled => ({
            id: enabled ? 'enable' : 'disable', label: props.t(enabled ? 'common.batchEnable' : 'common.batchDisable'),
            disabled: selected.some(node => !candidatesById.has(node.id)),
            run: (nodes: FileTreeNode[]) => {
              const current = draft
              const ids = new Set(nodes.map(node => node.id))
              const textUses = current.textUses.filter(use => !ids.has(`${use.kind}:${use.id}`))
              for (const node of nodes) {
                const item = candidatesById.get(node.id)
                if (item && enabled !== item.enabled) {
                  const previous = current.textUses.find(use => use.kind === item.kind && use.id === item.id)
                  textUses.push({ ...previous, kind: item.kind, id: item.id, enabled })
                }
              }
              return save({ ...current, textUses })
            },
          })),
          { id: 'reset', label: props.t('common.batchReset'), run: nodes => {
            const ids = new Set(nodes.map(node => node.id))
            return save({ ...draft, textUses: draft.textUses.filter(use => !ids.has(`${use.kind}:${use.id}`)) })
          } },
        ]}
        expandedIds={usageGroupNodes(textNodes).filter(node => !collapsedTextSources.includes(node.id)).map(node => node.id)}
        onExpandedIdsChange={ids => setCollapsedTextSources(usageGroupNodes(textNodes).filter(node => !ids.includes(node.id)).map(node => node.id))}
        getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
        getDragLabel={node => node.label} moreActionsLabel="更多操作"
        isMuted={node => candidatesById.has(node.id) && !textEnabled(node.id)}
        onSelect={node => {
          const item = candidatesById.get(node.id)
          if (item) props.onOpen?.(item.kind, item.id)
        }}
        renderIcon={(node, expanded) => node.kind === 'folder'
          ? props.card?.media?.avatarAssetId && node.id === `source:角色:${props.card.name}`
            ? <img src={cardMediaUrl(props.card.id, 'avatar', props.card.media.avatarAssetId, props.card.version)} alt="" width={20} height={20} />
            : expanded ? <FolderOpen size={15} /> : <Folder size={15} />
          : !candidatesById.has(node.id) ? <AlertTriangle size={15} aria-label="引用不可用" />
          : node.id.startsWith('rule:')
            ? <Regex size={15} className={textEnabled(node.id) ? styles.usageEnabledIcon : undefined} />
            : <Braces size={15} className={textEnabled(node.id) ? styles.usageEnabledIcon : undefined} />}
        renderTrailing={node => {
          if (node.kind === 'folder') return null
          const item = candidatesById.get(node.id)
          if (!item) return <IconButton aria-label={`移除不可用引用：${node.label}`} title="移除引用" size="small" disabled={busy}
            onClick={() => void save({ ...draft, textUses: draft.textUses.filter(use => `${use.kind}:${use.id}` !== node.id) }).catch(() => undefined)}>
            <Trash2 size={14} aria-hidden="true" />
          </IconButton>
          const enabled = textEnabled(node.id)
          return <button type="button" className={styles.declarationToggle}
              aria-label={`启用${item.kind === 'rule' ? '规则' : '提取器'}：${item.name}`}
              title={enabled ? '停用条目' : '启用条目'} aria-pressed={enabled} disabled={busy}
              onClick={() => toggle(item.kind, item.id, item.enabled)}>
              {enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
            </button>
        }} />
      {!textNodes.length && <p className={styles.presetResourceEmpty}>没有匹配的正则或提取器</p>}
    </section>
    <section role="tabpanel" aria-label="工具" hidden={activeTab !== 'tools'} className={styles.presetUsagePanel}>
      {props.toolsContent}
    </section>
    <div className={styles.presetUsageSave} hidden={!error && !busy && !conflict}>
      {error ? <p role="alert">{error}</p> : null}
      {busy && <p role="status">正在保存…</p>}
      {conflict && <div role="alert">
        <p>预设已在其他位置更新。保留的修改尚未应用到新版本。</p>
        <Button disabled={busy} onClick={() => { setBaseline(props.preset); setDraft(readDraft(props.preset)); setError(undefined) }}>采用服务端内容</Button>
        <Button disabled={busy} onClick={() => {
          const latest = readDraft(props.preset)
          const reapplied = { ...latest }
          for (const key of ['useCardLore', 'useGlobalLore', 'useCardText', 'useGlobalText'] as const) {
            if (draft[key] !== baseDraft[key]) reapplied[key] = draft[key]
          }
          const uses = new Map(latest.textUses.map(use => [`${use.kind}:${use.id}`, use]))
          const before = new Map(baseDraft.textUses.map(use => [`${use.kind}:${use.id}`, use]))
          const edited = new Map(draft.textUses.map(use => [`${use.kind}:${use.id}`, use]))
          for (const key of new Set([...before.keys(), ...edited.keys()])) {
            if (JSON.stringify(before.get(key)) === JSON.stringify(edited.get(key))) continue
            const use = edited.get(key)
            if (use) uses.set(key, use)
            else uses.delete(key)
          }
          reapplied.textUses = [...uses.values()]
          void save(reapplied, props.preset).catch(() => undefined)
        }}>重新应用保留的修改</Button>
      </div>}
      {error && dirty && !conflict && <Button disabled={busy} onClick={() => void save().catch(() => undefined)}>重试保存</Button>}
    </div>
  </div>
}

function PresetToolExplorer(props: {
  presets: PromptResource[]
  onOpenPreset(id: string): void
  selectedToolId?: string
  t: Translator
  tools: AgentToolDefinition[]
  toolsReady?: boolean
  providersReady?: boolean
  toolMounts: PresetToolMount[]
  onSelect(toolId: string): void
}) {
  const [query, setQuery] = useState('')
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(() => new Set())
  const [referencesToolId, setReferencesToolId] = useState<string>()
  const references = (toolId: string) => props.presets.filter(preset =>
    props.toolMounts.some(mount => mount.toolId === toolId && mount.presetResourceId === preset.id))
  const toolGroups = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    const groups = new Map<string, AgentToolDefinition[]>()
    for (const tool of props.tools) {
      const searchableText = [tool.name, tool.description, tool.id, tool.owner.namespace, tool.input.kind]
        .join(' ')
        .toLocaleLowerCase()
      if (normalizedQuery && !searchableText.includes(normalizedQuery)) continue
      const group = toolDisplayGroup(tool)
      const tools = groups.get(group) ?? []
      tools.push(tool)
      groups.set(group, tools)
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([namespace, tools]) => ({
        namespace,
        tools: tools.sort((left, right) => left.name.localeCompare(right.name)),
      }))
  }, [props.tools, query])

  const nodes: FileTreeNode[] = [
    ...toolGroups.map(group => ({
      id: `tool-group:${group.namespace}`,
      kind: 'folder',
      label: group.namespace === 'official.codeact' ? 'CodeAct（Freeform / JSON）'
        : group.namespace === 'official.fixed' ? '官方固定功能工具' : group.namespace,
      children: group.tools.map(tool => ({
        id: tool.id,
        kind: 'tool',
        label: tool.name,
        meta: props.t(tool.input.kind === 'structured' ? 'preset.tools.kind.provider' : 'preset.tools.kind.custom'),
      })),
    })),
  ]
  const groupIds = nodes.filter(node => node.kind === 'folder').map(node => node.id)

  return (
    <div className={styles.toolExplorer}>
      <SearchField
        containerClassName={styles.toolSearch}
        aria-label={props.t('preset.tools.searchLabel')}
        placeholder={props.t('preset.tools.searchPlaceholder')}
        clearLabel={props.t('preset.tools.searchClear')}
        value={query}
        onClear={() => setQuery('')}
        onChange={event => {
          setQuery(event.target.value)
          setCollapsedNamespaces(new Set())
        }}
      />
      <div className={styles.toolGroups}>
        {nodes.length ? <FileTree ariaLabel={props.t('preset.tools.searchLabel')} nodes={nodes}
          expandedIds={groupIds.filter(id => !collapsedNamespaces.has(id))}
          onExpandedIdsChange={ids => setCollapsedNamespaces(new Set(groupIds.filter(id => !ids.includes(id))))}
          selectedId={props.selectedToolId}
          getDisclosureLabel={(node, expanded) => props.t(expanded ? 'context.tree.collapse' : 'context.tree.expand', { label: node.label })}
          getDragLabel={node => node.label}
          moreActionsLabel={props.t('preset.tools.searchLabel')}
          renderIcon={node => node.kind === 'folder' ? <Package aria-hidden="true" /> : <Wrench aria-hidden="true" />}
          renderTrailing={node => node.kind === 'tool'
            ? references(node.id).length > 0 ? <button type="button" className={styles.toolReferenceButton}
                title="查看引用此工具的预设" aria-label={`查看引用此工具的 ${references(node.id).length} 个预设`}
                onClick={() => setReferencesToolId(node.id)}><Link2 size={16} aria-hidden="true" />{references(node.id).length}</button> : null
            : null}
          onSelect={node => {
            if (node.kind === 'folder') {
              setCollapsedNamespaces(current => {
                const next = new Set(current)
                if (next.has(node.id)) next.delete(node.id)
                else next.add(node.id)
                return next
              })
            } else props.onSelect(node.id)
          }}
        /> : <div className={styles.toolSearchEmpty}>{props.t('preset.tools.searchEmpty')}</div>}
      </div>
      {referencesToolId && <Dialog open title="引用此工具的预设" onClose={() => setReferencesToolId(undefined)}>
        <div className={styles.toolReferences}>
          {references(referencesToolId).map(preset => {
            const enabled = props.toolMounts.some(mount => mount.toolId === referencesToolId && mount.presetResourceId === preset.id && mount.defaultEnabled !== false)
            return <div key={preset.id} className={styles.toolReferenceRow}>
              <button type="button" onClick={() => { setReferencesToolId(undefined); props.onOpenPreset(preset.id) }}>{preset.rootNode.label}</button>
              <span>{enabled ? '已启用' : '已停用'}</span>
            </div>
          })}
        </div>
      </Dialog>}
    </div>
  )
}

function PresetToolDetail(props: {
  promptResourceApi?: StudioApi['promptResources']
  onNavigateResource?(path: string): void
  onRelatedResourceChanged?(): void | Promise<void>
  toolsReady?: boolean
  tool?: AgentToolDefinition
  t: Translator
  onUpdateTool(tool: AgentToolDefinition): Promise<void> | void
}) {
  if (!props.tool) {
    return <div className={styles.toolEmpty}>{props.t('preset.tools.selectEmpty')}</div>
  }
  return (
    <div className={styles.toolDetail} inert={props.toolsReady === false}>
      <header className={styles.toolDetailHeader}>
        <div>
          <span>{props.t(props.tool.input.kind === 'structured' ? 'preset.tools.kind.provider' : 'preset.tools.kind.custom')}</span>
          <h1>{props.tool.name}</h1>
          <p>{props.tool.description}</p>
        </div>
        <code>{props.tool.id}</code>
      </header>
      {props.tool.prompt?.loreRefs?.length && props.promptResourceApi && props.onNavigateResource && <RelatedLore references={props.tool.prompt.loreRefs}
        api={props.promptResourceApi} onNavigate={props.onNavigateResource} onChanged={() => props.onRelatedResourceChanged?.()} />}
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
  onReplace(presetId: string, mounts: PresetToolMountInput[], expectedMountIds: string[]): Promise<void>
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
      await props.onReplace(props.preset.id, mounts, props.presetMounts.map(mount => mount.id))
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
      const contentDepth = readOptionalFiniteNumber(draft.contentDepth, props.t('preset.tools.localDepth'))
      const updated: PresetToolMountInput = {
        toolId: props.tool.id,
        orderIndex: props.mount.orderIndex,
        defaultEnabled: draft.defaultEnabled,
        ...(activation ? { activation } : {}),
        ...(providerOrder === undefined ? {} : { provider: { order: providerOrder } }),
        ...(props.tool.input.kind === 'structured' ? {} : {
          content: {
            ...(draft.contentAnchor.trim() ? { targetAnchorId: draft.contentAnchor.trim() } : {}),
            ...(contentDepth === undefined ? {} : { localDepth: contentDepth }),
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
          <label><span>{props.t('preset.tools.activationJson')}</span><Textarea className={styles.jsonEditor} spellCheck={false} value={draft.activation} onChange={event => setDraft(current => ({ ...current, activation: event.target.value }))} /></label>
          <fieldset>
            <legend>{props.t('preset.tools.providerSurface')}</legend>
            <label><span>{props.t('preset.tools.providerOrder')}</span><input inputMode="numeric" value={draft.providerOrder} onChange={event => setDraft(current => ({ ...current, providerOrder: event.target.value }))} /></label>
          </fieldset>
          {props.tool.input.kind === 'structured' ? null : (
            <fieldset>
              <legend>{props.t('preset.tools.contentFallback')}</legend>
              <label><span>{props.t('preset.tools.targetAnchorId')}</span><input value={draft.contentAnchor} onChange={event => setDraft(current => ({ ...current, contentAnchor: event.target.value }))} /></label>
              <label><span>{props.t('preset.tools.localDepth')}</span><input inputMode="numeric" value={draft.contentDepth} onChange={event => setDraft(current => ({ ...current, contentDepth: event.target.value }))} /></label>
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
  const baseline = useRef(props.tool)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const previous = baseline.current
    baseline.current = props.tool
    setDraft(current => {
      const latest = createToolDraft(props.tool)
      if (previous.id !== props.tool.id) return latest
      const before = createToolDraft(previous)
      for (const key of Object.keys(latest) as Array<keyof typeof latest>) {
        if (current[key] !== before[key]) latest[key] = current[key]
      }
      return latest
    })
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
        <label><span>{props.t('preset.tools.description')}</span><Textarea className={styles.descriptionEditor} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.guidance')}</span><Textarea className={styles.guidanceEditor} value={draft.guidance} onChange={event => setDraft(current => ({ ...current, guidance: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.inputDefinitionJson')}</span><Textarea className={styles.jsonEditor} spellCheck={false} value={draft.input} onChange={event => setDraft(current => ({ ...current, input: event.target.value }))} /></label>
        <label><span>{props.t('preset.tools.parameterDescriptionsJson')}</span><Textarea className={styles.jsonEditor} spellCheck={false} value={draft.parameterDescriptions} onChange={event => setDraft(current => ({ ...current, parameterDescriptions: event.target.value }))} /></label>
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
    contentAnchor: content.targetAnchorId ?? '',
    contentDepth: content.localDepth?.toString() ?? '',
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
