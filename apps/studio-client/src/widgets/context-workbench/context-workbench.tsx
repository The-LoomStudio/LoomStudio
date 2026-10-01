import { useEffect, useId, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import {
  type ContextAssetUpdate,
} from '../../features/context-assets/model/projection-workbench.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { findContextAssetPath, findContextAssetByVirtualPath } from '../../features/context-assets/model/context-asset-tree.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { useResourceTokenSnapshot } from '../../features/context-assets/model/use-resource-token-snapshot.js'
import { Dialog } from '@loom-studio/ui'
import type { Card, ContextAssetNode, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './context-workbench.module.scss'
import { readSettingTreeMeta, resolveSettingScope, resolveSettingTarget } from './setting-target.js'

type ContextWorkbenchProps = {
  resourceBindings?: import('../../features/context-assets/ui/prompt-resource-toolbar/resource-bindings.js').ResourceBindingsSource
  extensionInstallations?: import('../../entities/index.js').ListExtensionInstallationsResult['installations']
  view?: 'settings' | 'macros' | 'text'
  onViewChange?: (view: 'settings' | 'macros' | 'text') => void
  card?: Card
  nodes: ContextAssetNode[]
  resources: PromptResource[]
  settingMounts: SettingMount[]
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
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onExportResourceZip?: (resourceId: string) => Promise<void>
  onImportResourceZip?: (file: File) => Promise<string | undefined>
  onReplaceSettingMounts: (source: SettingMountSource, settingResourceIds: string[]) => Promise<void>
  onReplaceCardResources: (cardId: string, resourceIds: string[]) => Promise<void>
  selectedResourceId?: string
  onSelectResource?: (resourceId: string, replace?: boolean) => void
  routeAssetId?: string
  routeResourceId?: string
  searchQuery: string
  onSearchQueryChange(value: string): void
  t: Translator
  workspaceId: string
}

export function ContextWorkbench(props: ContextWorkbenchProps) {
  const viewId = useId()
  const metadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const textEditorMode = useStudioLayoutStore(state => state.textEditorMode)
  const explorerLayout = useStudioLayoutStore(state => state.assetLayouts.resources)
  const explorerView = explorerLayout.views[props.workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
  const setExpandedIds = useStudioLayoutStore(state => state.setAssetExpandedIds)
  const setExplorerWidth = useStudioLayoutStore(state => state.setAssetExplorerWidth)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const searchQuery = props.searchQuery
  const [bindingOpen, setBindingOpen] = useState(false)
  const [internalSelectedResourceId, setInternalSelectedResourceId] = useState<string>()
  const [temporarySelection, setTemporarySelection] = useState<{ resourceId: string; nodeId: string }>()
  const [temporaryExpandedIds, setTemporaryExpandedIds] = useState<string[]>([])
  const mobilePane = useStudioLayoutStore(state => state.assetPanes.resources[props.workspaceId] ?? 'explorer')

  const settingResources = useMemo(
    () => props.resources.filter(resource => resource.resourceKind === 'setting'),
    [props.resources],
  )
  const cardResourceIds = useMemo(() => new Set(props.card?.promptResourceIds ?? []), [props.card?.promptResourceIds])
  const unavailableBoundIds = [...cardResourceIds].filter(id => !props.resources.some(resource => resource.id === id))
  const routeTargetResource = useMemo(() => {
    if (props.routeResourceId) return settingResources.find(resource => resource.id === props.routeResourceId)
    if (!props.routeAssetId) return undefined
    return settingResources.find(r => r.id === props.routeAssetId || Boolean(findContextNode([r.rootNode], props.routeAssetId)))
  }, [props.routeResourceId, props.routeAssetId, settingResources])

  const [scopeFilter, setScopeFilter] = useState<'current' | 'global'>('current')

  const globalMountIds = useMemo(() => new Set(
    props.settingMounts
      .filter(m => m.source.id === 'global')
      .map(m => m.settingResourceId)
  ), [props.settingMounts])

  const collection = useMemo(() => resolveSettingScope(
    settingResources, globalMountIds, cardResourceIds, props.extensionInstallations ?? [], scopeFilter,
  ), [settingResources, globalMountIds, cardResourceIds, props.extensionInstallations, scopeFilter])
  const target = resolveSettingTarget(collection, settingResources, props.routeResourceId)
  const targetResources = target.resources
  const temporaryOrigin = target.target?.origin?.kind === 'extension-package'
    ? `${props.t('directory.extensionContribution')} · ${target.target.origin.packageId}`
    : target.target?.origin?.kind === 'builtin' ? props.t('directory.builtinResource')
      : target.target?.sourceArtifactRef ? props.t('directory.cardResource') : props.t('directory.userResource')
  const selectedId = target.temporary
    ? (temporarySelection?.resourceId === props.routeResourceId ? temporarySelection?.nodeId : props.routeAssetId ?? target.target!.rootNode.id)
    : explorerView.selectedId
  const selectedNodeResource = selectedId ? settingResources.find(r => r.id === selectedId || Boolean(findContextNode([r.rootNode], selectedId))) : undefined
  const selectedResourceId = props.routeResourceId ?? props.selectedResourceId
    ?? routeTargetResource?.id ?? selectedNodeResource?.id ?? internalSelectedResourceId
    ?? (settingResources.find(r => cardResourceIds.has(r.id))?.id ?? (unavailableBoundIds.length === 0 ? settingResources[0]?.id : undefined))
  const tokenResource = targetResources.find(resource => resource.id === selectedResourceId)
  const tokenSnapshot = useResourceTokenSnapshot(tokenResource ? [tokenResource.rootNode] : [], `${props.workspaceId}:${selectedResourceId ?? ''}`)

  const displayNodes: ContextAssetNode[] = useMemo(() => {
    return targetResources.map(resource => {
      const origin = resource.origin
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

      const isGlobal = globalMountIds.has(resource.id)
      const isCurrent = cardResourceIds.has(resource.id)
      const scopeBadge = isGlobal && isCurrent ? '全局 · 当前' : isGlobal ? '全局默认' : isCurrent ? '当前卡片' : undefined
      const meta = [scopeBadge, originLabel].filter(Boolean).join(' · ')

      const root = readPromptResourceWorkbenchRoot(resource)
      const children = (root.children ?? []) as ContextAssetNode[]

      return {
        ...root,
        id: resource.rootNode.id,
        label: resource.rootNode.label,
        kind: 'folder',
        category: 'setting-root',
        meta,
        children,
      }
    })
  }, [targetResources, globalMountIds, cardResourceIds, props.extensionInstallations, props.t])

  const workbenchNodes = displayNodes
  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const selectedSettingResource = targetResources.find(r => r.id === selectedId)
  const hasDetailSelection = Boolean(selectedNode || selectedSettingResource)

  const bindingResources = props.resources
  const boundIds = scopeFilter === 'global' ? [...globalMountIds] : props.card?.promptResourceIds ?? []

  useEffect(() => {
    if (!props.routeAssetId || target.temporary) return
    if (props.routeResourceId) props.onViewChange?.('settings')
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeResourceId, props.routeAssetId, target.temporary, props.workspaceId, props.onViewChange])

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail
      if (!detail?.path) return
      
      const matchedNode = findContextAssetByVirtualPath(workbenchNodes, detail.path)
      if (matchedNode) {
        openAssetDetail('resources', props.workspaceId, matchedNode.id)
        
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
          setExpandedIds('resources', props.workspaceId, [...expandedIds])
        }
      }
    }
    
    window.addEventListener('loom:navigate', handleNavigate)
    return () => window.removeEventListener('loom:navigate', handleNavigate)
  }, [workbenchNodes, explorerView.expandedIds, props.workspaceId, setExpandedIds, openAssetDetail])

  useEffect(() => {
    if (target.temporary || target.unavailable) return
    if (selectedId && findContextNode(workbenchNodes, selectedId)) return
    if (workbenchNodes[0]?.id) {
      setSelectedId('resources', props.workspaceId, workbenchNodes[0].id)
    }
  }, [target.temporary, target.unavailable, props.workspaceId, selectedId, setSelectedId, workbenchNodes])

  useEffect(() => {
    if (!target.temporary) return
    const previous = useStudioLayoutStore.getState().assetPanes.resources[props.workspaceId] ?? 'explorer'
    setAssetPane('resources', props.workspaceId, 'detail')
    return () => setAssetPane('resources', props.workspaceId, previous)
  }, [target.temporary, props.workspaceId, setAssetPane])

  useEffect(() => {
    if (target.temporary) setTemporaryExpandedIds([])
  }, [target.temporary, props.routeResourceId])

  function handleSelectNode(id: string) {
    setAssetPane('resources', props.workspaceId, 'detail')
    if (target.temporary) setTemporarySelection({ resourceId: props.routeResourceId!, nodeId: id })
    else openAssetDetail('resources', props.workspaceId, id)
  }

  function handleSelectResource(resourceId: string) {
    setInternalSelectedResourceId(resourceId)
    if (props.onSelectResource) {
      props.onSelectResource(resourceId, target.temporary)
      return
    }
    const resource = settingResources.find(r => r.id === resourceId)
    if (resource) {
      handleSelectNode(resource.rootNode.id)
    }
  }

  if (props.routeResourceId && (target.unavailable || (props.routeAssetId && !findContextNode([routeTargetResource!.rootNode], props.routeAssetId)))) {
    return <p role="alert">{props.t('promptResource.referenceUnavailable', { id: props.routeResourceId })}</p>
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      hasSelection={hasDetailSelection}
      mobilePane={mobilePane}
      onMobilePaneChange={pane => setAssetPane('resources', props.workspaceId, pane)}
      header={(
        <div className={styles.header}>
        {target.temporary ? <>
          <span>{props.t('promptResource.temporaryOpen')} · {temporaryOrigin}</span>
        </> : null}
        <PanelTabs
          activeId={scopeFilter}
          ariaLabel={props.t('context.authoring.views')}
          items={[
            { id: 'current', label: '当前角色' },
            { id: 'global', label: '全局' },
          ]}
          onChange={id => {
            setBindingOpen(false)
            setScopeFilter(id as 'current' | 'global')
          }}
        />
        </div>
      )}
      toolbar={(
        <PromptResourceToolbar
          tokenSnapshot={tokenSnapshot}
          extensionInstallations={props.extensionInstallations}
          hideSelect
          hideSingleResourceActions
          resourceKind="setting"
          resources={settingResources}
          selectedResourceId={selectedResourceId}
          t={props.t}
          bindResourcesLabel={props.t(scopeFilter === 'global' ? 'context.globalBindings.action' : 'context.cardBindings.action')}
          onBindResources={scopeFilter === 'global' || props.card ? () => setBindingOpen(true) : undefined}
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
          onSelect={handleSelectResource}
        />
      )}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={(
        <div className={styles.resourceExplorer}>
          {unavailableBoundIds.map(id => <p key={id} role="status">{props.t('context.bindings.unavailable', { id })}</p>)}
          <ContextAssetExplorer
            tokenSnapshot={tokenSnapshot}
            formatMeta={readSettingTreeMeta}
            key={target.temporary ? `temporary:${props.routeResourceId}` : 'collection'}
            displayNodes={displayNodes}
            expandedIds={target.temporary ? temporaryExpandedIds : explorerView.expandedIds}
            query={searchQuery}
            scrollKey={`resources:${props.workspaceId}:${target.temporary ? props.routeResourceId : 'collection'}`}
            selectedId={selectedId}
            t={props.t}
            virtualized
            workspaceId={props.workspaceId}
            onAddNode={props.onAddNode}
            onAddFolderNode={props.onAddFolderNode}
            onDeleteNode={props.onDeleteNode}
            onDuplicateNode={props.onDuplicateNode}
            onRenameNode={props.onRenameNode}
            onExpandedIdsChange={expandedIds => target.temporary ? setTemporaryExpandedIds(expandedIds) : setExpandedIds('resources', props.workspaceId, expandedIds)}
            onMoveNode={(draggedId, targetId, position) => {
              props.onMoveNode(draggedId, targetId, position)
            }}
            onQueryChange={props.onSearchQueryChange}
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
            description={props.t(scopeFilter === 'global' ? 'context.globalBindings.description' : 'context.cardBindings.description')}
            open={bindingOpen}
            resources={bindingResources}
            t={props.t}
            title={props.t(scopeFilter === 'global' ? 'context.globalBindings.title' : 'context.cardBindings.title')}
            onChange={resourceIds => scopeFilter === 'global'
              ? props.onReplaceSettingMounts({ kind: 'manual', id: 'global' }, resourceIds)
              : props.onReplaceCardResources(props.card!.id, resourceIds)}
            onClose={() => setBindingOpen(false)}
          />
        </div>
      )}
    >
      <div
        className={styles.viewContent}
        id={`${viewId}-settings-content`}
        role="tabpanel"
        aria-labelledby={`${viewId}-settings`}
      >
        {target.temporary ? <div className={styles.temporaryDetailHeader}>
          <span>{props.t('promptResource.temporaryOpen')} · {temporaryOrigin} · {target.target?.rootNode.label}</span>
        </div> : null}
        <ContextAssetEditor
          activationEditable={selectedNode?.category === 'setting'}
          presets={props.resources.filter(resource => resource.resourceKind === 'preset')}
          editorMode={textEditorMode}
          metadataOpen={metadataOpen}
          node={selectedNode}
          pathNodes={findContextAssetPath(workbenchNodes, selectedNode?.id)}
          t={props.t}
          onChangeNode={props.onChangeNode}
          onCommitNode={props.onCommitNode}
          onEditorModeChange={setTextEditorMode}
          onMetadataOpenChange={setMetadataOpen}
          onSelectNodeId={handleSelectNode}
        />
      </div>
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
  const [error, setError] = useState<string>()
  const bound = props.boundIds.map(id => {
    const resource = props.resources.find(candidate => candidate.id === id)
    return { id, resource }
  })
  const available = props.resources.filter(resource => resource.resourceKind === 'setting' && !props.boundIds.includes(resource.id)
    && normalizeSearchText(`${resource.rootNode.label} ${resource.resourceKind}`).includes(normalizeSearchText(query)))

  async function change(ids: string[]) {
    setPending(true)
    setError(undefined)
    try {
      await props.onChange(ids)
      setQuery('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog closeOnBackdrop description={props.description} open={props.open} title={props.title} onClose={props.onClose}>
      <div className={styles.bindingEditor}>
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.globalSettingOptions}>
          {bound.map(({ id, resource }) => (
            <button aria-label={props.t('context.bindings.remove', { id })} disabled={pending} key={id} type="button" onClick={() => void change(props.boundIds.filter(candidate => candidate !== id))}>
              <span>{resource?.rootNode.label ?? props.t('context.bindings.unavailable', { id })}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        {bound.some(item => !item.resource) ? <button disabled={pending} type="button" onClick={() => void change(bound.filter(item => item.resource).map(item => item.id))}>
          <Trash2 aria-hidden="true" size={14} />{props.t('context.bindings.removeUnavailable')}
        </button> : null}
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
