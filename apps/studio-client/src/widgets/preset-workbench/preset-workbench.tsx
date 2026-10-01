import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { BookOpen, Braces, ChevronDown, ChevronRight, Copy, Download, Folder, FolderOpen, Package, Regex, Search, Star, ToggleLeft, ToggleRight, Trash2, Wrench, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconButton, SearchField } from '@loom-studio/ui'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
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
import { readContextAssetBadgeInfo, renderContextAssetTreeIcon } from '../../features/context-assets/ui/context-asset-tree.js'
import { findContextAssetPath, findContextAssetByVirtualPath } from '../../features/context-assets/model/context-asset-tree.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { buildPresetTokenProjection } from '../../features/context-assets/model/preset-token-projection.js'
import { useResourceTokenSnapshot } from '../../features/context-assets/model/use-resource-token-snapshot.js'
import { presetAnchorDeclarations } from '../../features/context-assets/model/preset-declarations.js'
import { createDefaultPresetToolMountInput, toPresetToolMountInput, togglePresetToolMount, validPresetToolMounts } from '../../features/context-assets/model/preset-tool-mounts.js'
import { FileTree, type FileTreeNode } from '../../shared/ui/file-tree/file-tree.js'
import { buildPresetToolProjection } from '../../features/context-assets/model/preset-tool-projection.js'
import { findCompositionItem } from '../../features/context-assets/model/composition-items.js'
import type { AgentToolDefinition, Card, ContextAssetNode, PresetToolMount, PresetToolMountInput, PromptCompositionItem, PromptResource, SettingMount, TextExtractor, TextTransformRule } from '../../entities/index.js'
import styles from './preset-workbench.module.scss'
import { AgentModelEditor } from '../agent-panel/agent-model-editor.js'
import type { MacroAuthoringSource } from '../../features/state-variables/ui/macro-authoring-panel.js'
import { NarrativeRangePreview } from './narrative-range-preview.js'
import type { ModelProfile, ProviderAccount } from '../../entities/index.js'

function toolDisplayGroup(tool: AgentToolDefinition): string {
  if (tool.id === 'official/codeact' || tool.id === 'official/codeact_json') return 'official.codeact'
  return tool.owner.namespace === 'official' ? 'official.fixed' : tool.owner.namespace || 'default'
}

function usageSource(origin: PromptResource['origin'], imported = false): string {
  if (origin?.kind === 'extension-package') return `扩展 · ${origin.packageId}`
  if (origin?.kind === 'builtin') return '官方资源'
  return imported ? '导入资源' : '我的资源'
}

function usageFolders(entries: Array<{ source: string; node: FileTreeNode }>, query: string): FileTreeNode[] {
  const search = normalizeSearchText(query)
  const groups = new Map<string, FileTreeNode[]>()
  for (const { source, node } of entries) {
    if (!normalizeSearchText(`${source} ${node.label} ${node.meta ?? ''}`).includes(search)) continue
    const children = groups.get(source) ?? []
    children.push(node)
    groups.set(source, children)
  }
  return [...groups].map(([source, children]) => ({
    id: `source:${source}`, label: source, kind: 'folder', meta: `${children.length} 项`, children,
  }))
}

type PresetWorkbenchProps = {
  active: boolean
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  onSaveModel(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  resourceBindings?: import('../../features/context-assets/ui/prompt-resource-toolbar/resource-bindings.js').ResourceBindingsSource
  extensionInstallations?: import('../../entities/index.js').ListExtensionInstallationsResult['installations']
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  settingMounts: SettingMount[]
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  timelinePromptResourceIds?: string[]
  card?: Card
  onChangeNode: (id: string, partial: Partial<ContextAssetNode>) => void
  draftResourceIds: string[]
  onDiscardDraft(resourceId: string): void
  onRetryDraft(resourceId: string): Promise<void>
  onRenameNode(id: string, label: string): Promise<void>
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
  onExportResourceZip?: (resourceId: string) => Promise<void>
  onImportResourceZip?: (file: File) => Promise<string | undefined>
  onReplaceToolMounts: (presetId: string, mounts: PresetToolMountInput[]) => Promise<void>
  onReplaceSettingMounts: (source: { kind: 'preset'; id: string }, mounts: Array<{ id: string } | { settingResourceId: string }>) => Promise<void>
  onUpdateTool: (tool: AgentToolDefinition) => Promise<void> | void
  onSaveMacros: (resourceId: string, input: Parameters<MacroAuthoringSource['onSave']>[0]) => ReturnType<MacroAuthoringSource['onSave']>
  routeAssetId?: string
  routeResourceId?: string
  searchQuery: string
  onSearchQueryChange(value: string): void
  selectedResourceId?: string
  onSelectResource?: (resourceId: string) => void
  onOpenSetting?: (resourceId: string, nodeId: string) => void
  previewApi: StudioApi['narratives']
  previewTimelineId?: string
  previewBranchId?: string
  t: Translator
  workspaceId: string
  textTransformsApi: StudioApi['textTransforms']
  onOpenTextUse?: (kind: 'rule' | 'extractor', id: string) => void
  loomScriptsApi: StudioApi['loomScripts']
  onLoomScriptsChanged: () => void
}

type PresetZone = NonNullable<NonNullable<ContextAssetNode['skeletonPatch']>['zones']>[number]

export function PresetWorkbench(props: PresetWorkbenchProps) {
  const activePresetView = useStudioLayoutStore(state => state.presetView)
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.preset)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setAssetExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setActivePresetView = useStudioLayoutStore(state => state.setPresetView)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const presetResources = useMemo(() => props.resources.filter(resource => resource.resourceKind === 'preset'), [props.resources])
  const [internalSelectedResourceId, setInternalSelectedResourceId] = useState<string>()
  const mobilePane = useStudioLayoutStore(state => state.assetPanes.preset[props.workspaceId] ?? 'explorer')
  const legacyResource = props.routeAssetId && !props.routeResourceId
    ? presetResources.find(resource => findContextNode([resource.rootNode], props.routeAssetId))
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
  const replaceToolMounts = (presetId: string, mounts: PresetToolMountInput[]) => {
    return props.onReplaceToolMounts(presetId, validPresetToolMounts(mounts, props.tools))
  }
  const mainOrderNodes = useMemo(() => selectedResource
    ? [readPromptResourceWorkbenchRoot(selectedResource)] : [], [selectedResource])
  const workbenchNodes = mainOrderNodes
  const selectedId = explorerView.selectedId
  const tokenSnapshot = useResourceTokenSnapshot(selectedResource ? [selectedResource.rootNode] : [], `${props.workspaceId}:${selectedResource?.id ?? ''}`)
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const detailNode = selectedNode
  const tokenProjection = useMemo(() => detailNode?.kind === 'virtual' && selectedResource ? buildPresetTokenProjection({
    preset: selectedResource, resources: props.resources, settingMounts: props.settingMounts,
    timelinePromptResourceIds: props.timelinePromptResourceIds,
  }) : undefined, [detailNode?.kind, selectedResource, props.resources, props.settingMounts, props.timelinePromptResourceIds])
  const declarations = useMemo(() => detailNode?.kind === 'virtual' && selectedResource
    ? presetAnchorDeclarations({
      anchor: detailNode, presetId: selectedResource.id, resources: props.resources,
      settingMounts: props.settingMounts, timelinePromptResourceIds: props.timelinePromptResourceIds,
    }) : undefined, [detailNode, selectedResource?.id, props.resources, props.settingMounts, props.timelinePromptResourceIds])
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
  const [selectedToolId, setSelectedToolId] = useState<string>()
  const hasDetailSelection = activePresetView === 'tools'
    ? Boolean(selectedToolId)
    : Boolean(selectedNode)

  useEffect(() => {
    if (!props.routeAssetId) return
    if (props.routeResourceId) setActivePresetView('assets')
    openAssetDetail('preset', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, setActivePresetView, props.routeResourceId, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    if (props.routeResourceId) return
    if (selectedResource && selectedResource.id !== selectedResourceId) setSelectedResourceId(selectedResource.id)
  }, [props.routeResourceId, selectedResource?.id, selectedResourceId])

  useEffect(() => {
    setAssetPane('preset', props.workspaceId, props.routeResourceId ? 'detail' : 'explorer')
  }, [props.routeResourceId, selectedResource?.id])

  useEffect(() => {
    if (!selectedToolId) setSelectedToolId(props.tools[0]?.id)
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

  const [isOverviewSelected, setIsOverviewSelected] = useState(true)

  const displayNodes: ContextAssetNode[] = useMemo(() => {
    return presetResources.map(preset => {
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
        id: preset.id,
        label: preset.rootNode.label,
        kind: 'folder',
        category: 'preset-root',
        meta: `${originLabel} · ${modelLabel}`,
        children: promptChildren,
      }
    })
  }, [presetResources, selectedResource?.id, mainOrderNodes, props.t, props.extensionInstallations])

  function handleSelectNode(id?: string) {
    if (!id) return
    setAssetPane('preset', props.workspaceId, 'detail')

    const clickedPreset = presetResources.find(p => p.id === id)
    if (clickedPreset) {
      setSelectedResourceId(clickedPreset.id)
      setIsOverviewSelected(true)
      setActivePresetView('assets')
      return
    }

    const matchedPreset = presetResources.find(p => findContextNode([p.rootNode], id))
    if (matchedPreset && matchedPreset.id !== selectedResourceId) {
      setSelectedResourceId(matchedPreset.id)
    }
    setIsOverviewSelected(false)
    setActivePresetView('assets')

    openAssetDetail('preset', props.workspaceId, id)
  }

  if ((selectedResourceId || props.routeAssetId) && (!selectedResource || (props.routeAssetId && !findContextNode([selectedResource.rootNode], props.routeAssetId)))) {
    return <p role="alert">{props.t('promptResource.referenceUnavailable', { id: props.routeResourceId ?? props.routeAssetId ?? selectedResourceId! })}</p>
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      hasSelection={hasDetailSelection || isOverviewSelected}
      mobilePane={mobilePane}
      onMobilePaneChange={pane => setAssetPane('preset', props.workspaceId, pane)}
      toolbar={activePresetView === 'assets' ? (
        <PromptResourceToolbar
          tokenSnapshot={tokenSnapshot}
          resourceBindings={props.resourceBindings}
          bindingResources={props.resources}
          extensionInstallations={props.extensionInstallations}
          hideSelect
          hideSingleResourceActions
          resourceKind="preset"
          resources={presetResources}
          selectedResourceId={selectedResource?.id}
          t={props.t}
          onCreate={props.onCreateResource}
          draftResourceIds={props.draftResourceIds}
          onDiscardDraft={props.onDiscardDraft}
          onRetryDraft={props.onRetryDraft}
          onDelete={props.onDeleteResource}
          onDuplicate={props.onDuplicateResource}
          onExport={props.onExportResource}
          onExportZip={props.onExportResourceZip}
          onImport={props.onImportResource}
          onImportZip={props.onImportResourceZip}
          onSelect={setSelectedResourceId}
        />
      ) : undefined}
      header={(
        <div>
          <PanelTabs
            activeId={activePresetView}
            ariaLabel={props.t('preset.panel.views')}
            items={[
              { id: 'assets' as const, label: props.t('preset.panel.assets') },
              { id: 'tools' as const, label: props.t('preset.panel.tools') },
            ]}
            onChange={setActivePresetView}
          />
          {activePresetView === 'assets' && toolProjection.unavailableMounts.length > 0 ? (
            <div className={styles.statusMessages}>
              {toolProjection.unavailableMounts.map(mount => <p key={`tool:${mount.id}`} role="status">{props.t('preset.tools.unavailable', { id: mount.toolId })}</p>)}
            </div>
          ) : null}
        </div>
      )}
      onExplorerWidthChange={width => setExplorerWidth('preset', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={activePresetView === 'tools' ? (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <PresetToolExplorer
            selectedToolId={selectedToolId}
            t={props.t}
            toolMounts={props.toolMounts}
            unavailableMounts={toolProjection.unavailableMounts}
            tools={props.tools}
            presetId={selectedResource?.id}
            onSelect={setSelectedToolId}
          />
        </div>
      ) : (
        <ContextAssetExplorer
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
          onDeleteNode={props.onDeleteNode}
          onDuplicateNode={props.onDuplicateNode}
          onRenameNode={props.onRenameNode}
          onExpandedIdsChange={expandedIds => setAssetExpandedIds('preset', props.workspaceId, expandedIds)}
          onMoveNode={props.onMoveNode}
          onQueryChange={props.onSearchQueryChange}
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
          unavailableMounts={toolProjection.unavailableMounts}
          t={props.t}
          tool={props.tools.find(tool => tool.id === selectedToolId)}
          onReplaceMounts={replaceToolMounts}
          onUpdateTool={props.onUpdateTool}
        />
      ) : isOverviewSelected && selectedResource ? (
        <AgentPresetOverview
          key={selectedResource.id}
          preset={selectedResource}
          textTransformsApi={props.textTransformsApi}
          onOpenTextUse={props.onOpenTextUse}
          installations={props.extensionInstallations}
          modelProfiles={props.modelProfiles}
          providerAccounts={props.providerAccounts}
          tools={props.tools}
          toolMounts={props.toolMounts}
          settingMounts={props.settingMounts}
          card={props.card}
          resources={props.resources}
          unavailableMounts={toolProjection.unavailableMounts}
          t={props.t}
          onSaveModel={props.onSaveModel}
          onReplaceMounts={replaceToolMounts}
          onReplaceSettingMounts={props.onReplaceSettingMounts}
          onDuplicate={() => props.onDuplicateResource(selectedResource.id).then(() => {})}
          onDelete={() => props.onDeleteResource(selectedResource.id)}
          onExport={() => props.onExportResource(selectedResource.id)}
          onOpenSetting={props.onOpenSetting}
        />
      ) : (
        <div className={styles.detailStack}>
          <div className={`${styles.authorDetail} ${detailNode?.kind === 'virtual' ? styles.anchorDetail : ''}`}>
            <ContextAssetEditor
              activationEditable
              allowTargetAnchor={false}
              compactVirtualNotes
              editorMode={textEditorMode}
              metadataOpen={metadataOpen}
              node={detailNode}
              tokenNode={detailNode?.kind === 'virtual' && tokenProjection ? findContextNode([tokenProjection.root], detailNode.id) : undefined}
              tokenIncomplete={detailNode?.kind === 'virtual' ? tokenProjection?.incompleteIds.has(detailNode.id) : undefined}
              pathNodes={findContextAssetPath(workbenchNodes, detailNode?.id)}
              t={props.t}
              onChangeNode={props.onChangeNode}
              onCommitNode={props.onCommitNode}
              onEditorModeChange={setTextEditorMode}
              onMetadataOpenChange={setMetadataOpen}
              onSelectNodeId={handleSelectNode}
            />
            {declarations ? <section className={styles.declarations}>
              <h3>声明注入此处的资源</h3>
              <p>静态候选；本轮是否触发由运行时决定。</p>
              {detailNode?.label === '@chat.tools' ? <p>工具内容由运行时及当前工具挂载决定；这里不展示实际激活结果。</p> : null}
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
                  if (target) props.onOpenSetting?.(target.resource.id, target.node.id)
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
              && (detailNode.capabilities?.targetAnchorId === '@chat.narrative'
                || detailNode.capabilities?.targetAnchorId === '@memory.narrative')
              ? <NarrativeRangePreview key={detailNode.id} api={props.previewApi}
                  timelineId={props.previewTimelineId} branchId={props.previewBranchId} />
              : null}
          </div>
        </div>
      )}
    </AssetWorkbenchLayout>
  )
}

export function AgentPresetOverview(props: {
  preset: PromptResource
  textTransformsApi: StudioApi['textTransforms']
  onOpenTextUse?: (kind: 'rule' | 'extractor', id: string) => void
  installations?: PresetWorkbenchProps['extensionInstallations']
  modelProfiles: ModelProfile[]
  providerAccounts: ProviderAccount[]
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  settingMounts: SettingMount[]
  card?: Card
  resources: PromptResource[]
  unavailableMounts: PresetToolMount[]
  t: Translator
  onSaveModel(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
  onReplaceSettingMounts(source: { kind: 'preset'; id: string }, mounts: Array<{ id: string } | { settingResourceId: string }>): Promise<void>
  onDuplicate(): Promise<void>
  onDelete(): Promise<void>
  onExport(): Promise<void>
  onOpenSetting?: (resourceId: string, nodeId: string) => void
}) {
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
  const usedSettings = props.settingMounts
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
  const [expandedToolDetails, setExpandedToolDetails] = useState<string[]>([])
  const [toolQuery, setToolQuery] = useState('')
  const [pendingToolId, setPendingToolId] = useState<string>()
  const [toolError, setToolError] = useState<string>()
  const [settingBusy, setSettingBusy] = useState(false)
  const [settingError, setSettingError] = useState<string>()
  const [settingQuery, setSettingQuery] = useState('')
  const [collapsedSettingSources, setCollapsedSettingSources] = useState<string[]>([])
  const settingRows = [
    ...usedSettings.map(mount => {
      const resourceId = mount.resolvedSettingResourceId === null ? undefined
        : mount.resolvedSettingResourceId ?? mount.settingResourceId
      const resource = props.resources.find(item => item.id === resourceId && item.resourceKind === 'setting')
      return { id: `mount:${mount.id}`, mount, resource }
    }),
    ...props.resources.filter(item => item.resourceKind === 'setting'
      && !usedSettings.some(mount => (mount.resolvedSettingResourceId ?? mount.settingResourceId) === item.id))
      .map(resource => ({ id: `resource:${resource.id}`, mount: undefined, resource })),
  ]
  const settingRowsById = new Map(settingRows.map(row => [row.id, row]))
  const cardSettingIds = new Set(props.card?.promptResourceIds ?? [])
  const isCardSetting = (nodeId: string) => {
    const resource = settingRowsById.get(nodeId)?.resource
    return Boolean(resource && cardSettingIds.has(resource.id))
  }
  const settingNodes = (useCardSettings: boolean) => usageFolders(
    [...settingRows.filter(row => isCardSetting(row.id)), ...settingRows.filter(row => !isCardSetting(row.id))].map(row => ({
    source: isCardSetting(row.id) ? `当前角色 · ${props.card!.name}`
      : row.resource ? usageSource(row.resource.origin, Boolean(row.resource.sourceArtifactRef)) : '不可用引用',
    node: {
      id: row.id, label: row.resource?.rootNode.label ?? `Settings 引用不可用：${row.mount!.settingResourceId}`,
      kind: 'entry' as const, meta: isCardSetting(row.id) && useCardSettings
        ? '随角色默认采用' : row.mount ? row.resource ? '已采用' : '未解析' : '未采用',
    },
  })), settingQuery)
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
          ...(tool.description ? { children: [] } : {}) },
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
  const expandedToolIds = [...toolNodes.filter(node => !collapsedToolSources.includes(node.id)).map(node => node.id), ...expandedToolDetails]

  async function saveSettings(mounts: Array<{ id: string } | { settingResourceId: string }>) {
    if (settingBusy) return
    setSettingBusy(true)
    setSettingError(undefined)
    try {
      await props.onReplaceSettingMounts({ kind: 'preset', id: props.preset.id }, mounts)
    } catch (error) {
      setSettingError(error instanceof Error ? error.message : String(error))
    } finally {
      setSettingBusy(false)
    }
  }
  const currentSettingMounts = () => usedSettings.map(mount => ({ id: mount.id }))

  async function handleToggleTool(tool: AgentToolDefinition) {
    if (pendingToolId) return
    setPendingToolId(tool.id)
    setToolError(undefined)
    try {
      await props.onReplaceMounts(props.preset.id, togglePresetToolMount(presetMounts, tool))
    } catch (caught) {
      setToolError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPendingToolId(undefined)
    }
  }

  async function handleRemoveUnavailable(toolId: string) {
    const next = presetMounts.filter(m => m.toolId !== toolId).map(toPresetToolMountInput)
    await props.onReplaceMounts(props.preset.id, next)
  }

  async function handleRemoveAllUnavailable() {
    const unavailableSet = new Set(props.unavailableMounts.map(m => m.toolId))
    const next = presetMounts.filter(m => !unavailableSet.has(m.toolId)).map(toPresetToolMountInput)
    await props.onReplaceMounts(props.preset.id, next)
  }

  return (
    <div className={styles.presetOverview}>
      <header className={styles.presetOverviewHeader}>
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

      {/* 1. 顶部：模型配置 */}
      <section className={styles.presetConfigSection}>
        <h2>
          <span>{props.t('agent.profile.model')}</span>
        </h2>
        <AgentModelEditor
          key={props.preset.id}
          preset={props.preset}
          modelProfiles={props.modelProfiles}
          providerAccounts={props.providerAccounts}
          onSave={props.onSaveModel}
          t={props.t}
        />
      </section>

      <PresetTextUses preset={props.preset} api={props.textTransformsApi}
        onSave={props.onSaveModel} onOpen={props.onOpenTextUse}
        settingsContent={useCardSettings => {
          const nodes = settingNodes(useCardSettings)
          const enabled = (nodeId: string) => Boolean(settingRowsById.get(nodeId)?.mount
            || (isCardSetting(nodeId) && useCardSettings))
          return <section className={styles.presetResourceList} aria-label="Settings 使用资源">
        <SearchField aria-label="搜索 Settings" placeholder="搜索名称或来源"
          clearLabel="清除搜索" value={settingQuery} onClear={() => setSettingQuery('')}
          onChange={event => { setSettingQuery(event.target.value); setCollapsedSettingSources([]) }} />
        {settingError ? <p role="alert">{settingError}</p> : null}
        <FileTree ariaLabel="Settings 来源目录" nodes={nodes}
          expandedIds={nodes.filter(node => !collapsedSettingSources.includes(node.id)).map(node => node.id)}
          onExpandedIdsChange={ids => setCollapsedSettingSources(nodes.filter(node => !ids.includes(node.id)).map(node => node.id))}
          getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
          getDragLabel={node => node.label} moreActionsLabel="更多操作"
          isMuted={node => {
            const row = settingRowsById.get(node.id)
            return Boolean(row && (!enabled(node.id) || !row.resource))
          }}
          onSelect={node => {
            const resource = settingRowsById.get(node.id)?.resource
            if (resource) props.onOpenSetting?.(resource.id, resource.rootNode.id)
          }}
          renderIcon={(node, expanded) => node.kind === 'folder'
            ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
            : isCardSetting(node.id)
              ? <Star size={15} className={enabled(node.id) ? styles.usageEnabledIcon : undefined} />
              : <BookOpen size={15} className={enabled(node.id) ? styles.usageEnabledIcon : undefined} />}
          renderTrailing={node => {
            const row = settingRowsById.get(node.id)
            if (!row) return null
            const { mount, resource } = row
            const inherited = isCardSetting(node.id) && useCardSettings
            return resource ? <button type="button" className={styles.declarationToggle}
                aria-label={`${enabled(node.id) ? '停用' : '启用'} Settings：${resource.rootNode.label}`}
                title={inherited ? '随角色默认采用，由“使用角色世界书”控制' : mount ? '停用条目' : '启用条目'}
                aria-pressed={enabled(node.id)} disabled={settingBusy || inherited}
                onClick={() => void saveSettings(mount
                  ? currentSettingMounts().filter(item => item.id !== mount.id)
                  : [...currentSettingMounts(), { settingResourceId: resource.id }])}>
                {enabled(node.id) ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
              </button> : <IconButton aria-label="移除 Settings" title="移除引用" size="small" disabled={settingBusy}
                onClick={() => void saveSettings(currentSettingMounts().filter(item => item.id !== mount!.id))}>
                <Trash2 size={14} aria-hidden="true" />
              </IconButton>
          }} />
        {!nodes.length && <p className={styles.presetResourceEmpty}>没有匹配的 Settings</p>}
      </section>}}
      toolsContent={<section className={styles.presetResourceList} aria-label={props.t('preset.tools.mountTitle')}>
        <SearchField aria-label="搜索工具" placeholder="搜索名称或来源"
          clearLabel="清除搜索" value={toolQuery} onClear={() => setToolQuery('')}
          onChange={event => { setToolQuery(event.target.value); setCollapsedToolSources([]) }} />
        {toolError ? <p className={styles.toolError} role="alert">{toolError}</p> : null}
        <FileTree ariaLabel="工具来源目录" nodes={toolNodes} expandedIds={expandedToolIds}
          onExpandedIdsChange={ids => {
            setCollapsedToolSources(toolNodes.filter(node => !ids.includes(node.id)).map(node => node.id))
            setExpandedToolDetails(ids.filter(id => toolsByNodeId.has(id)))
          }}
          getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
          getDragLabel={node => node.label} moreActionsLabel="更多操作"
          onSelect={() => {}}
          isMuted={node => node.kind !== 'folder' && !toolEnabled(node.id)}
          renderIcon={(node, expanded) => node.kind === 'folder'
            ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
            : <Wrench size={15} className={toolEnabled(node.id) ? styles.usageEnabledIcon : undefined} />}
          renderExpandedRow={node => expandedToolDetails.includes(node.id) && toolsByNodeId.get(node.id)?.description
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
            return <button type="button" className={styles.declarationToggle}
              title={enabled ? '停用工具' : '启用工具'} aria-label={`${enabled ? '停用' : '启用'}工具：${tool.name}`}
              aria-pressed={enabled} disabled={Boolean(pendingToolId)}
              onClick={() => void handleToggleTool(tool)}>
              {enabled ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
            </button>
          }} />
        {!toolNodes.length && <p className={styles.presetResourceEmpty}>没有匹配的工具</p>}
      </section>} />
    </div>
  )
}

export function PresetTextUses(props: {
  preset: PromptResource
  api: StudioApi['textTransforms']
  onSave(input: Parameters<StudioApi['agentPresets']['update']>[0]): Promise<PromptResource>
  onOpen?: (kind: 'rule' | 'extractor', id: string) => void
  settingsContent?: ReactNode | ((useCardSettings: boolean) => ReactNode)
  toolsContent?: ReactNode
}) {
  type TextUse = NonNullable<PromptResource['textUses']>[number]
  const editableUses = (uses: PromptResource['textUses'] = []): TextUse[] => uses.map(use => ({
    id: use.id, kind: use.kind, enabled: use.enabled,
    ...(use.orderIndex !== undefined ? { orderIndex: use.orderIndex } : {}),
  }))
  const [rules, setRules] = useState<TextTransformRule[]>([])
  const [extractors, setExtractors] = useState<TextExtractor[]>([])
  const [draft, setDraft] = useState(() => ({
    textUses: editableUses(props.preset.textUses),
    useCardSettings: props.preset.useCardSettings ?? true,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useState<'settings' | 'text' | 'tools'>('settings')
  const [textQuery, setTextQuery] = useState('')
  const [collapsedTextSources, setCollapsedTextSources] = useState<string[]>([])
  const dirty = draft.useCardSettings !== (props.preset.useCardSettings ?? true)
    || JSON.stringify(draft.textUses) !== JSON.stringify(editableUses(props.preset.textUses))

  useEffect(() => {
    let active = true
    Promise.all([props.api.listRules(), props.api.listExtractors()])
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
    setDraft(current => {
      const previous = current.textUses.find(use => use.kind === kind && use.id === id)
      const enabled = !(previous?.enabled ?? defaultEnabled)
      const textUses = current.textUses.filter(use => use.kind !== kind || use.id !== id)
      if (enabled !== defaultEnabled) textUses.push({ ...previous, id, kind, enabled })
      return { ...current, textUses }
    })
  }

  async function save() {
    if (busy || !dirty) return
    setBusy(true)
    setError(undefined)
    try {
      const saved = await props.onSave({
        agentPresetId: props.preset.id,
        expectedVersion: props.preset.version,
        textUses: draft.textUses,
        useCardSettings: draft.useCardSettings,
      })
      setDraft({ textUses: editableUses(saved.textUses), useCardSettings: saved.useCardSettings ?? true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  function textSource(item: TextTransformRule | TextExtractor): string {
    if (item.owner.kind === 'card') return `角色 · ${item.owner.cardId}`
    if (item.owner.kind === 'preset') return `预设 · ${item.owner.presetId}`
    if (item.owner.kind === 'extension') return `扩展 · ${item.owner.packageId}`
    return usageSource(item.origin)
  }
  const candidates = [
    ...rules.map(rule => ({ kind: 'rule' as const, id: rule.id, name: rule.name, enabled: rule.enabled, source: textSource(rule) })),
    ...extractors.map(extractor => ({ kind: 'extractor' as const, id: extractor.id, name: extractor.name, enabled: extractor.enabled, source: textSource(extractor) })),
  ]
  const candidatesById = new Map(candidates.map(item => [`${item.kind}:${item.id}`, item]))
  const textEnabled = (nodeId: string) => {
    const item = candidatesById.get(nodeId)
    return item ? draft.textUses.find(use => use.kind === item.kind && use.id === item.id)?.enabled ?? item.enabled : false
  }
  const missing = draft.textUses.filter(use => !candidates.some(item => item.kind === use.kind && item.id === use.id))
  const textNodes = usageFolders([
    ...candidates.map(item => ({
      source: item.source,
      node: {
        id: `${item.kind}:${item.id}`, label: item.name, kind: 'entry' as const,
        meta: `${item.kind === 'rule' ? '正则' : '提取器'} · ${draft.textUses.some(use => use.kind === item.kind && use.id === item.id) ? '预设配置' : '默认'}`,
      },
    })),
    ...missing.map(use => ({
      source: '不可用引用',
      node: { id: `${use.kind}:${use.id}`, label: use.id, kind: 'entry' as const, meta: '未解析' },
    })),
  ], textQuery)

  return <div className={styles.presetUsageConfig}>
    <PanelTabs items={[
      { id: 'settings', label: 'Settings' },
      { id: 'text', label: '正则 / 提取器' },
      { id: 'tools', label: '工具' },
    ]} activeId={activeTab} onChange={setActiveTab} ariaLabel="预设使用配置" size="compact" />
    <section role="tabpanel" aria-label="Settings" hidden={activeTab !== 'settings'} className={styles.presetUsagePanel}>
      <div className={styles.presetUsageOption}>
        <span className={styles.presetResourceName}>使用角色世界书</span>
        <button type="button" className={styles.declarationToggle} aria-label="使用角色世界书"
          title={draft.useCardSettings ? '停用角色世界书' : '启用角色世界书'}
          aria-pressed={draft.useCardSettings} disabled={busy}
          onClick={() => setDraft(current => ({ ...current, useCardSettings: !current.useCardSettings }))}>
          {draft.useCardSettings ? <ToggleRight aria-hidden="true" /> : <ToggleLeft aria-hidden="true" />}
        </button>
      </div>
      {typeof props.settingsContent === 'function' ? props.settingsContent(draft.useCardSettings) : props.settingsContent}
    </section>
    <section role="tabpanel" aria-label="正则 / 提取器" hidden={activeTab !== 'text'} className={styles.presetUsagePanel}>
      <SearchField aria-label="搜索正则与提取器" placeholder="搜索名称或来源"
        clearLabel="清除搜索" value={textQuery} onClear={() => setTextQuery('')}
        onChange={event => { setTextQuery(event.target.value); setCollapsedTextSources([]) }} />
      <FileTree ariaLabel="正则与提取器来源目录" nodes={textNodes}
        expandedIds={textNodes.filter(node => !collapsedTextSources.includes(node.id)).map(node => node.id)}
        onExpandedIdsChange={ids => setCollapsedTextSources(textNodes.filter(node => !ids.includes(node.id)).map(node => node.id))}
        getDisclosureLabel={(node, expanded) => `${expanded ? '收起' : '展开'}${node.label}`}
        getDragLabel={node => node.label} moreActionsLabel="更多操作"
        isMuted={node => node.kind !== 'folder' && !textEnabled(node.id)}
        onSelect={node => {
          const item = candidatesById.get(node.id)
          if (item) props.onOpen?.(item.kind, item.id)
        }}
        renderIcon={(node, expanded) => node.kind === 'folder'
          ? expanded ? <FolderOpen size={15} /> : <Folder size={15} />
          : node.id.startsWith('rule:')
            ? <Regex size={15} className={textEnabled(node.id) ? styles.usageEnabledIcon : undefined} />
            : <Braces size={15} className={textEnabled(node.id) ? styles.usageEnabledIcon : undefined} />}
        renderTrailing={node => {
          if (node.kind === 'folder') return null
          const item = candidatesById.get(node.id)
          if (!item) return <IconButton aria-label={`移除不可用引用：${node.label}`} title="移除引用" size="small" disabled={busy}
            onClick={() => setDraft(current => ({ ...current, textUses: current.textUses.filter(use => `${use.kind}:${use.id}` !== node.id) }))}>
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
    <div hidden={activeTab === 'tools'} className={styles.presetUsageSave}>
      {error ? <p role="alert">{error}</p> : null}
      <Button disabled={!dirty || busy} onClick={() => void save()}>保存使用配置</Button>
    </div>
  </div>
}

function PresetToolExplorer(props: {
  presetId?: string
  selectedToolId?: string
  t: Translator
  tools: AgentToolDefinition[]
  toolMounts: PresetToolMount[]
  unavailableMounts: PresetToolMount[]
  onSelect(toolId: string): void
}) {
  const [query, setQuery] = useState('')
  const [collapsedNamespaces, setCollapsedNamespaces] = useState<Set<string>>(() => new Set())
  const unavailableMounts = props.unavailableMounts.filter(mount => normalizeSearchText(mount.toolId).includes(normalizeSearchText(query)))
  const mountedIds = useMemo(() => new Set(props.toolMounts
    .filter(mount => mount.presetResourceId === props.presetId)
    .map(mount => mount.toolId)), [props.presetId, props.toolMounts])
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
        {unavailableMounts.length > 0 ? <section className={styles.toolGroup}>
          <h3>{props.t('preset.tools.unavailableGroup')}</h3>
          {unavailableMounts.map(mount => <button
            className={mount.toolId === props.selectedToolId ? styles.toolExplorerActive : styles.toolExplorerItem}
            key={mount.id}
            type="button"
            onClick={() => props.onSelect(mount.toolId)}
          >
            <Wrench aria-hidden="true" />
            <span className={styles.toolExplorerText}>{props.t('preset.tools.unavailable', { id: mount.toolId })}</span>
          </button>)}
        </section> : null}
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
                <strong>{group.namespace === 'official.codeact' ? 'CodeAct（Freeform / JSON）' : group.namespace === 'official.fixed' ? '官方固定功能工具' : group.namespace}</strong>
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
        }) : unavailableMounts.length === 0 ? <div className={styles.toolSearchEmpty}>{props.t('preset.tools.searchEmpty')}</div> : null}
      </div>
    </div>
  )
}

function PresetToolDetail(props: {
  preset?: PromptResource
  tool?: AgentToolDefinition
  mount?: PresetToolMount
  presetMounts: PresetToolMount[]
  unavailableMounts: PresetToolMount[]
  t: Translator
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
  onUpdateTool(tool: AgentToolDefinition): Promise<void> | void
}) {
  if (props.preset && !props.tool && props.mount) {
    return <UnavailableToolDetail
      key={`${props.preset.id}:${props.mount.toolId}`}
      presetId={props.preset.id}
      mount={props.mount}
      presetMounts={props.presetMounts}
      unavailableMounts={props.unavailableMounts}
      t={props.t}
      onReplaceMounts={props.onReplaceMounts}
    />
  }
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
        key={`${props.preset.id}:${props.tool.id}`}
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

function UnavailableToolDetail(props: {
  presetId: string
  mount: PresetToolMount
  presetMounts: PresetToolMount[]
  unavailableMounts: PresetToolMount[]
  t: Translator
  onReplaceMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string>()
  async function removeUnavailable() {
    setPending(true)
    setError(undefined)
    const ids = new Set(props.unavailableMounts.map(mount => mount.toolId))
    try {
      await props.onReplaceMounts(props.presetId, props.presetMounts
        .filter(mount => !ids.has(mount.toolId)).map(toPresetToolMountInput))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }
  return <div className={styles.toolDetail}>
    <header className={styles.toolDetailHeader}><p role="status">{props.t('preset.tools.unavailable', { id: props.mount.toolId })}</p></header>
    <pre>{JSON.stringify(toPresetToolMountInput(props.mount), null, 2)}</pre>
    {error ? <p className={styles.toolError} role="alert">{error}</p> : null}
    <button disabled={pending} type="button" onClick={() => void removeUnavailable()}>
      <Trash2 aria-hidden="true" size={14} />{props.t('preset.tools.removeUnavailable')}
    </button>
  </div>
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
