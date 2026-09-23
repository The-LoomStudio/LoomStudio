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
import { Dialog } from '@loom-studio/ui'
import { MacroAuthoringDetail, MacroAuthoringExplorer, type MacroAuthoringPanelProps, useMacroAuthoring } from '../../features/state-variables/ui/macro-authoring-panel.js'
import type { Card, ContextAssetNode, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { TextTransformDetail, TextTransformExplorer, useTextTransformController } from '../../features/text-transforms/ui/text-transform-panel.js'
import styles from './context-workbench.module.scss'

type ContextWorkbenchProps = {
  view: 'settings' | 'macros' | 'text'
  onViewChange: (view: 'settings' | 'macros' | 'text') => void
  textTransformsApi: StudioApi['textTransforms']
  loomScriptsApi: StudioApi['loomScripts']
  onLoomScriptsChanged: () => void
  macroAuthoring?: MacroAuthoringPanelProps
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
  onSelectResource?: (resourceId: string) => void
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
  const mobilePane = useStudioLayoutStore(state => state.assetPanes.resources[props.workspaceId] ?? 'explorer')
  const macroController = useMacroAuthoring(props.macroAuthoring)
  const textController = useTextTransformController({
    api: props.textTransformsApi,
    loomScriptsApi: props.loomScriptsApi,
    onRuntimeChanged: props.onLoomScriptsChanged,
    owner: props.card ? { kind: 'card', cardId: props.card.id } : { kind: 'runtime' },
    t: props.t,
    mobilePane: mobilePane === 'explorer' ? 'master' : 'detail',
    onMobilePaneChange: pane => setAssetPane('resources', props.workspaceId, pane === 'master' ? 'explorer' : 'detail'),
  })

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

  const selectedId = explorerView.selectedId

  const selectedNodeResource = useMemo(() => {
    if (!selectedId) return undefined
    return settingResources.find(r => r.id === selectedId || Boolean(findContextNode([r.rootNode], selectedId)))
  }, [selectedId, settingResources])

  const selectedResourceId = props.routeResourceId ?? props.selectedResourceId
    ?? routeTargetResource?.id
    ?? selectedNodeResource?.id
    ?? internalSelectedResourceId
    ?? (settingResources.find(r => cardResourceIds.has(r.id))?.id ?? (unavailableBoundIds.length === 0 ? settingResources[0]?.id : undefined))

  const characterSettingResources = useMemo(() => {
    if (!props.card?.promptResourceIds?.length) return []
    const ids = new Set(props.card.promptResourceIds)
    return settingResources.filter(r => ids.has(r.id))
  }, [props.card?.promptResourceIds, settingResources])

  const targetResources = props.routeResourceId
    ? (routeTargetResource ? [routeTargetResource] : [])
    : characterSettingResources.length > 0 || unavailableBoundIds.length > 0
    ? characterSettingResources
    : settingResources

  const workbenchNodes = useMemo(() => {
    return targetResources.map(readPromptResourceWorkbenchRoot)
  }, [targetResources])

  const selectedNode = findContextNode(workbenchNodes, selectedId)
  const hasDetailSelection = props.view === 'text'
    || (props.view === 'macros' ? Boolean(macroController.selectedRowId) : Boolean(selectedNode))

  const bindingResources = props.resources
  const boundIds = props.card?.promptResourceIds ?? []

  useEffect(() => {
    if (!props.routeAssetId) return
    if (props.routeResourceId) props.onViewChange('settings')
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeResourceId, props.routeAssetId, props.workspaceId])

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
    if (props.routeResourceId) return
    if (selectedId && findContextNode(workbenchNodes, selectedId)) return
    if (workbenchNodes[0]?.id) {
      setSelectedId('resources', props.workspaceId, workbenchNodes[0].id)
    }
  }, [props.routeResourceId, props.workspaceId, selectedId, setSelectedId, workbenchNodes])

  const displayNodes = workbenchNodes

  useEffect(() => {
    setAssetPane('resources', props.workspaceId, props.routeResourceId ? 'detail' : 'explorer')
    macroController.selectRow(undefined)
  }, [props.routeResourceId, props.macroAuthoring?.ownerId])

  function changeView(view: 'settings' | 'macros' | 'text') {
    setAssetPane('resources', props.workspaceId, 'explorer')
    if (view !== 'macros') macroController.selectRow(undefined)
    props.onViewChange(view)
  }

  function handleSelectNode(id: string) {
    setAssetPane('resources', props.workspaceId, 'detail')
    openAssetDetail('resources', props.workspaceId, id)
  }

  function handleSelectResource(resourceId: string) {
    setInternalSelectedResourceId(resourceId)
    props.onSelectResource?.(resourceId)
    const resource = settingResources.find(r => r.id === resourceId)
    if (resource) {
      handleSelectNode(resource.rootNode.id)
    }
  }

  function handleSelectMacro(id: string) {
    macroController.selectRow(id)
    setAssetPane('resources', props.workspaceId, 'detail')
  }

  if (props.routeResourceId && (!routeTargetResource || (props.routeAssetId && !findContextNode([routeTargetResource.rootNode], props.routeAssetId)))) {
    return <p role="alert">{props.t('promptResource.referenceUnavailable', { id: props.routeResourceId })}</p>
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      hasSelection={hasDetailSelection}
      mobilePane={mobilePane}
      onMobilePaneChange={pane => setAssetPane('resources', props.workspaceId, pane)}
      header={(
        <PanelTabs
          activeId={props.view}
          ariaLabel={props.t('context.authoring.views')}
          items={[
            { id: 'settings', label: props.t('context.authoring.settings') },
            { id: 'macros', label: props.t('context.authoring.macros') },
            { id: 'text', label: props.t('rail.textTransform') },
          ]}
          onChange={changeView}
        />
      )}
      toolbar={props.view === 'settings' ? (
        <PromptResourceToolbar
          hideSelect
          resourceKind="setting"
          resources={settingResources}
          selectedResourceId={selectedResourceId}
          t={props.t}
          onBindResources={() => setBindingOpen(true)}
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
      ) : undefined}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={props.view === 'text' ? 'master-detail' : explorerView.viewMode}
      explorer={props.view === 'text' ? <TextTransformExplorer controller={textController} /> : props.view === 'macros' ? (
        <MacroAuthoringExplorer controller={macroController} onAdd={() => setAssetPane('resources', props.workspaceId, 'detail')} onSelect={handleSelectMacro} />
      ) : (
        <div className={styles.resourceExplorer}>
          {unavailableBoundIds.map(id => <p key={id} role="status">{props.t('context.bindings.unavailable', { id })}</p>)}
          <ContextAssetExplorer
            displayNodes={displayNodes}
            expandedIds={explorerView.expandedIds}
            query={searchQuery}
            scrollKey={`resources:${props.workspaceId}`}
            selectedId={selectedId}
            t={props.t}
            virtualized
            workspaceId={props.workspaceId}
            onAddNode={props.onAddNode}
            onAddFolderNode={props.onAddFolderNode}
            onDeleteNode={props.onDeleteNode}
            onDuplicateNode={props.onDuplicateNode}
            onRenameNode={props.onRenameNode}
            onExpandedIdsChange={expandedIds => setExpandedIds('resources', props.workspaceId, expandedIds)}
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
            description={props.t('context.cardBindings.description')}
            open={bindingOpen}
            resources={bindingResources}
            t={props.t}
            title={props.t('context.cardBindings.title')}
            onChange={resourceIds => props.card ? props.onReplaceCardResources(props.card.id, resourceIds) : Promise.resolve()}
            onClose={() => setBindingOpen(false)}
          />
        </div>
      )}
    >
      <div
        className={styles.viewContent}
        id={`${viewId}-macros-content`}
        role="tabpanel"
        aria-labelledby={`${viewId}-macros`}
        hidden={props.view !== 'macros'}
      >
        <MacroAuthoringDetail controller={macroController} />
      </div>
      <div
        className={styles.viewContent}
        id={`${viewId}-text-content`}
        role="tabpanel"
        aria-labelledby={`${viewId}-text`}
        hidden={props.view !== 'text'}
      >
        {props.card ? <TextTransformDetail controller={textController} /> : <p>{props.t('textTransform.noCard')}</p>}
      </div>
      <div
        className={styles.viewContent}
        id={`${viewId}-settings-content`}
        role="tabpanel"
        aria-labelledby={`${viewId}-settings`}
        hidden={props.view !== 'settings'}
      >
      <ContextAssetEditor
          activationEditable={selectedNode?.category === 'setting'}
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
