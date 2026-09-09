import { useEffect, useId, useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../pages/studio/model/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import {
  findContextNode,
} from '../../features/context-assets/model/projection-order.js'
import {
  type ContextAssetUpdate,
  findRootContextModule,
} from '../../features/context-assets/model/projection-workbench.js'
import { readPromptResourceWorkbenchRoot } from '../../features/context-assets/model/prompt-resource-view.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/context-assets/ui/context-asset-workbench.js'
import { ContextAssetHeader } from '../../features/context-assets/ui/context-asset-header/context-asset-header.js'
import { findContextAssetPath, findContextAssetByVirtualPath } from '../../features/context-assets/model/context-asset-tree.js'
import { STUDIO_PANEL_PRESENTATION } from '../../pages/studio/model/studio-panel-presentation.js'
import { PromptResourceToolbar } from '../../features/context-assets/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { Dialog } from '../../shared/ui/dialog/dialog.js'
import { MacroAuthoringDetail, MacroAuthoringExplorer, type MacroAuthoringPanelProps, useMacroAuthoring } from '../../features/state-variables/ui/macro-authoring-panel.js'
import type { Card, ContextAssetNode, PromptResource, SettingMount, SettingMountSource } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './context-workbench.module.scss'

type ContextWorkbenchProps = {
  view: 'settings' | 'macros'
  onViewChange: (view: 'settings' | 'macros') => void
  macroAuthoring?: MacroAuthoringPanelProps
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
  selectedResourceId?: string
  onSelectResource?: (resourceId: string) => void
  routeAssetId?: string
  initialSearchQuery?: string
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
  const openAssetDetail = useStudioLayoutStore(state => state.openAssetDetail)
  const setSelectedId = useStudioLayoutStore(state => state.setAssetSelectedId)
  const setMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setTextEditorMode = useStudioLayoutStore(state => state.setTextEditorMode)
  const [searchQuery, setSearchQuery] = useState(props.initialSearchQuery ?? '')
  const [scope, setScope] = useState<'character' | 'global'>('character')
  const [bindingOpen, setBindingOpen] = useState(false)
  const [internalSelectedResourceId, setInternalSelectedResourceId] = useState<string>()
  const [mobilePane, setMobilePane] = useState<'explorer' | 'detail'>('explorer')
  const macroController = useMacroAuthoring(props.macroAuthoring)

  const settingResources = useMemo(
    () => props.resources.filter(resource => resource.resourceKind === 'setting'),
    [props.resources],
  )
  const cardResourceIds = useMemo(() => new Set(props.card?.promptResourceIds ?? []), [props.card?.promptResourceIds])
  const globalSettingIds = useMemo(() => new Set(props.settingMounts
    .filter(mount => mount.source.kind === 'manual')
    .map(mount => mount.settingResourceId)), [props.settingMounts])

  const routeTargetResource = useMemo(() => {
    if (!props.routeAssetId) return undefined
    return settingResources.find(r => r.id === props.routeAssetId || Boolean(findContextNode([r.rootNode], props.routeAssetId)))
  }, [props.routeAssetId, settingResources])

  const selectedId = explorerView.selectedId

  const selectedNodeResource = useMemo(() => {
    if (!selectedId) return undefined
    return settingResources.find(r => r.id === selectedId || Boolean(findContextNode([r.rootNode], selectedId)))
  }, [selectedId, settingResources])

  const selectedResourceId = props.selectedResourceId
    ?? routeTargetResource?.id
    ?? selectedNodeResource?.id
    ?? internalSelectedResourceId
    ?? (settingResources.find(r => cardResourceIds.has(r.id))?.id ?? settingResources[0]?.id)

  const characterSettingResources = useMemo(() => {
    if (!props.card?.promptResourceIds?.length) return []
    const ids = new Set(props.card.promptResourceIds)
    return settingResources.filter(r => ids.has(r.id))
  }, [props.card?.promptResourceIds, settingResources])

  const targetResources = characterSettingResources.length > 0
    ? characterSettingResources
    : settingResources

  const workbenchNodes = useMemo(() => {
    return targetResources.map(readPromptResourceWorkbenchRoot)
  }, [targetResources])

  const selectedNode = findContextNode(workbenchNodes, selectedId)

  const bindingResources = settingResources
  const boundIds = props.card?.promptResourceIds ?? []

  useEffect(() => {
    if (!props.routeAssetId) return
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeAssetId, props.workspaceId])

  useEffect(() => {
    setSearchQuery(props.initialSearchQuery ?? '')
  }, [props.initialSearchQuery])

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
    if (selectedId && findContextNode(workbenchNodes, selectedId)) return
    if (workbenchNodes[0]?.id) {
      setSelectedId('resources', props.workspaceId, workbenchNodes[0].id)
    }
  }, [props.workspaceId, selectedId, setSelectedId, workbenchNodes])

  const displayNodes = workbenchNodes

  useEffect(() => {
    setMobilePane('explorer')
    macroController.selectRow(undefined)
  }, [props.macroAuthoring?.ownerId])

  function changeView(view: 'settings' | 'macros') {
    setMobilePane('explorer')
    if (view !== 'macros') macroController.selectRow(undefined)
    props.onViewChange(view)
  }

  function handleSelectNode(id: string) {
    setMobilePane('detail')
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
    setMobilePane('detail')
  }

  return (
    <AssetWorkbenchLayout
      explorerWidth={explorerLayout.explorerWidth}
      mobilePane={mobilePane}
      onMobilePaneChange={setMobilePane}
      onBack={() => setMobilePane('explorer')}
      footer={(
        <nav className="loom-page-tabs" role="tablist" aria-label={props.t('context.authoring.views')}>
          {(['settings', 'macros'] as const).map(view => (
            <button
              key={view}
              id={`${viewId}-${view}`}
              className={`loom-page-tab ${props.view === view ? 'loom-page-tab-active' : ''}`}
              role="tab"
              type="button"
              aria-selected={props.view === view}
              aria-controls={`${viewId}-${view}-content`}
              tabIndex={props.view === view ? 0 : -1}
              onClick={() => changeView(view)}
              onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                const views = ['settings', 'macros'] as const
                const index = views.indexOf(view)
                const next = event.key === 'Home' ? views[0] : event.key === 'End' ? views[views.length - 1]
                  : views[(index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) % views.length]
                changeView(next)
                document.getElementById(`${viewId}-${next}`)?.focus()
              }}
            >
              {props.t(`context.authoring.${view}`)}
            </button>
          ))}
        </nav>
      )}
      toolbar={props.view === 'settings' ? (
        <PromptResourceToolbar
          hideSelect
          resourceKind="setting"
          resources={settingResources}
          selectedResourceId={selectedResourceId}
          t={props.t}
          onCreate={props.onCreateResource}
          onDelete={props.onDeleteResource}
          onDuplicate={props.onDuplicateResource}
          onExport={props.onExportResource}
          onImport={props.onImportResource}
          onSelect={handleSelectResource}
        />
      ) : undefined}
      onExplorerWidthChange={width => setExplorerWidth('resources', width)}
      resizeLabel={props.t('context.resizeExplorer')}
      viewMode={explorerView.viewMode}
      explorer={props.view === 'macros' ? (
        <MacroAuthoringExplorer controller={macroController} onAdd={() => setMobilePane('detail')} onSelect={handleSelectMacro} />
      ) : (
        <div className={styles.resourceExplorer}>
          <button className={styles.bindResourcesButton} type="button" onClick={() => setBindingOpen(true)}>
            <Link2 aria-hidden="true" />
            <span>{props.t('context.cardBindings.action')}</span>
          </button>
          <ContextAssetExplorer
            displayNodes={displayNodes}
            expandedIds={explorerView.expandedIds}
            query={searchQuery}
            selectedId={selectedId}
            t={props.t}
            workspaceId={props.workspaceId}
            onAddNode={props.onAddNode}
            onAddFolderNode={props.onAddFolderNode}
            onDeleteNode={props.onDeleteNode}
            onDuplicateNode={props.onDuplicateNode}
            onExpandedIdsChange={expandedIds => setExpandedIds('resources', props.workspaceId, expandedIds)}
            onMoveNode={(draggedId, targetId, position) => {
              props.onMoveNode(draggedId, targetId, position)
            }}
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
  selectedResourceId?: string
  t: Translator
  workspaceId: string
  onSelectResource?: (resourceId: string) => void
}) {
  const definition = STUDIO_PANEL_PRESENTATION.resource
  const settingResources = useMemo(() => props.resources.filter(r => r.resourceKind === 'setting'), [props.resources])
  const selectedId = useStudioLayoutStore(state => state.assetLayouts.resources.views[props.workspaceId]?.selectedId)
  const selectedResource = settingResources.find(r => r.id === props.selectedResourceId)
    ?? settingResources.find(resource => resource.id === selectedId || Boolean(findContextNode([resource.rootNode], selectedId)))
    ?? settingResources[0]

  return (
    <ContextAssetHeader
      Icon={definition.Icon}
      title={props.t(definition.labelKey)}
      resources={settingResources}
      selectedResourceId={selectedResource?.id}
      t={props.t}
      onSelectResource={resourceId => props.onSelectResource?.(resourceId)}
    />
  )
}
