import { useWorkbenchView } from '../../shared/studio-shell/use-workbench-view.js'
import { ResourceUnavailable } from '../../shared/ui/resource-unavailable/resource-unavailable.js'
import type { ResourceSearchReveal } from '../../shared/lib/search-match.js'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ScanEye, Trash2, X } from 'lucide-react'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { AssetWorkbenchLayout } from '../../shared/ui/asset-workbench-layout/asset-workbench-layout.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import { readPromptResourceWorkbenchRoot } from '../../features/prompt-resources/model/prompt-resource-view.js'
import { ContextAssetEditor, ContextAssetExplorer } from '../../features/prompt-resources/ui/context-asset-workbench.js'
import { findContextAssetNode, findContextAssetPath, findContextAssetByVirtualPath } from '../../features/prompt-resources/model/context-asset-tree.js'
import { PromptResourceToolbar } from '../../features/prompt-resources/ui/prompt-resource-toolbar/prompt-resource-toolbar.js'
import { useResourceTokenSnapshot } from '../../features/prompt-resources/model/use-resource-token-snapshot.js'
import { Dialog, SearchField } from '@loom-studio/ui'
import type { Card, ContextAssetNode, PromptResource, LoreMount, LoreMountSource } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './context-workbench.module.scss'
import { loreRevealExpandedIds, readLoreTreeMeta, resolveLoreScope, resolveLoreTarget } from './lore-target.js'

type ContextWorkbenchProps = {
  extensionInstallations?: import('../../entities/index.js').ListExtensionInstallationsResult['installations']
  card?: Card
  resources: PromptResource[]
  loreMounts: LoreMount[]
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
  onDuplicateNode: (id: string) => Promise<string | undefined>
  onDeleteNode: (id: string, selectedId?: string) => Promise<string | undefined>
  onCreateResource: (resourceKind: PromptResource['resourceKind']) => Promise<string | undefined>
  onDuplicateResource: (resourceId: string) => Promise<string | undefined>
  onDeleteResource: (resourceId: string) => Promise<void>
  onImportResource: (file: File) => Promise<string | undefined>
  onExportResource: (resourceId: string) => Promise<void>
  onExportResourceZip?: (resourceId: string) => Promise<void>
  onImportResourceZip?: (file: File) => Promise<string | undefined>
  onReplaceLoreMounts: (source: LoreMountSource, loreResourceIds: string[]) => Promise<void>
  onReplaceCardResources: (cardId: string, resourceIds: string[], expectedVersion: number) => Promise<void>
  selectedResourceId?: string
  onSelectResource?: (resourceId: string, replace?: boolean) => void
  routeAssetId?: string
  routeResourceId?: string
  globalSearchQuery?: string
  searchMatch?: ResourceSearchReveal
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
  const [pendingDelete, setPendingDelete] = useState<PromptResource>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string>()
  const [bindingOpen, setBindingOpen] = useState(false)
  const [internalSelectedResourceId, setInternalSelectedResourceId] = useState<string>()
  const [temporarySelection, setTemporarySelection] = useState<{
    resourceId: string; nodeId: string; routeAssetId?: string; requestId?: number
  }>()
  const [temporaryExpansion, setTemporaryExpansion] = useState<{ key: string; ids: string[] }>()
  const revealedRoute = useRef<string | undefined>(undefined)
  const mobilePane = useStudioLayoutStore(state => state.assetPanes.resources[props.workspaceId] ?? 'explorer')

  const loreResources = useMemo(
    () => props.resources.filter(resource => resource.resourceKind === 'lore'),
    [props.resources],
  )
  const cardResourceIds = useMemo(() => new Set(props.card?.promptResourceIds ?? []), [props.card?.promptResourceIds])
  const unavailableBoundIds = [...cardResourceIds].filter(id => !props.resources.some(resource => resource.id === id))
  const routeTargetResource = useMemo(() => {
    if (props.routeResourceId) return loreResources.find(resource => resource.id === props.routeResourceId)
    if (!props.routeAssetId) return undefined
    return loreResources.find(r => r.id === props.routeAssetId || Boolean(findContextAssetNode([r.rootNode], props.routeAssetId)))
  }, [props.routeResourceId, props.routeAssetId, loreResources])

  const [scopeFilter, setScopeFilter] = useWorkbenchView<'current' | 'global'>('lore.scope', 'current', ['current', 'global'])

  const globalMountIds = useMemo(() => new Set(
    props.loreMounts
      .filter(m => m.source.id === 'global')
      .map(m => m.loreResourceId)
  ), [props.loreMounts])

  const collection = useMemo(() => resolveLoreScope(
    loreResources, globalMountIds, cardResourceIds, props.extensionInstallations ?? [], scopeFilter,
  ), [loreResources, globalMountIds, cardResourceIds, props.extensionInstallations, scopeFilter])
  const target = resolveLoreTarget(collection, loreResources, props.routeResourceId)
  const targetResources = target.resources
  const revealKey = JSON.stringify([props.routeResourceId, props.routeAssetId, props.searchMatch?.requestId])
  const temporaryExpandedIds = temporaryExpansion?.key === revealKey ? temporaryExpansion.ids
    : target.target ? loreRevealExpandedIds(target.target.rootNode, props.routeAssetId) : []
  const requestedSelectedId = target.temporary
    ? (temporarySelection && temporarySelection.resourceId === props.routeResourceId
      && temporarySelection.routeAssetId === props.routeAssetId
      && temporarySelection.requestId === props.searchMatch?.requestId
      ? temporarySelection.nodeId : props.routeAssetId ?? target.target!.rootNode.id)
    : explorerView.selectedId
  const selectedNodeResource = requestedSelectedId ? targetResources.find(r => r.id === requestedSelectedId || Boolean(findContextAssetNode([r.rootNode], requestedSelectedId))) : undefined
  const selectedResource = selectedNodeResource
    ?? targetResources.find(resource => resource.id === (props.routeResourceId ?? props.selectedResourceId ?? internalSelectedResourceId))
    ?? targetResources[0]
  const selectedResourceId = selectedResource?.id
  const selectedId = selectedNodeResource && requestedSelectedId !== selectedNodeResource.id
    ? requestedSelectedId : selectedResource?.rootNode.id
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

      const isGlobalInstallation = isExtension && installation?.target.kind === 'global'
      const isGlobal = globalMountIds.has(resource.id) || isGlobalInstallation || isBuiltin
      const isCurrent = cardResourceIds.has(resource.id)
      const scopeBadge = isGlobal && isCurrent ? props.t('context.scope.globalAndCurrent') : isGlobal ? props.t('context.scope.globalDefault') : isCurrent ? props.t('context.scope.currentCard') : undefined
      const meta = [scopeBadge, originLabel].filter(Boolean).join(' · ')

      const root = readPromptResourceWorkbenchRoot(resource)
      const children = (root.children ?? []) as ContextAssetNode[]

      return {
        ...root,
        id: resource.rootNode.id,
        label: resource.rootNode.label,
        kind: 'folder',
        category: 'lore-root',
        meta: target.temporary ? undefined : meta,
        children,
      }
    })
  }, [targetResources, target.temporary, globalMountIds, cardResourceIds, props.extensionInstallations, props.t])

  const workbenchNodes = displayNodes
  const selectedNode = findContextAssetNode(workbenchNodes, selectedId)
  const selectedLoreResource = targetResources.find(r => r.id === selectedId)
  const hasDetailSelection = Boolean(selectedNode || selectedLoreResource)

  const bindingResources = props.resources
  const readonlyGlobalIds = useMemo(() => {
    if (scopeFilter === 'current') return new Set<string>()
    const ids = new Set<string>()
    for (const res of loreResources) {
      const origin = res.origin
      const isExtension = origin?.kind === 'extension-package'
      const installation = origin?.kind === 'extension-package'
        ? props.extensionInstallations?.find(inst => inst.id === origin.installationId && inst.packageId === origin.packageId)
        : undefined
      if ((isExtension && installation?.target.kind === 'global') || origin?.kind === 'builtin') {
        ids.add(res.id)
      }
    }
    return ids
  }, [scopeFilter, loreResources, props.extensionInstallations])

  const boundIds = useMemo(() => {
    if (scopeFilter === 'current') return props.card?.promptResourceIds ?? []
    return [...new Set([...globalMountIds, ...readonlyGlobalIds])]
  }, [scopeFilter, globalMountIds, readonlyGlobalIds, props.card?.promptResourceIds])

  useEffect(() => {
    if (!props.routeAssetId || target.temporary) return
    openAssetDetail('resources', props.workspaceId, props.routeAssetId)
  }, [openAssetDetail, props.routeResourceId, props.routeAssetId, props.searchMatch?.requestId, target.temporary, props.workspaceId])

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
    if (explorerView.selectedId !== selectedId) setSelectedId('resources', props.workspaceId, selectedId)
  }, [target.temporary, target.unavailable, props.workspaceId, explorerView.selectedId, selectedId, setSelectedId])

  useEffect(() => {
    if (!target.temporary) return
    const previous = useStudioLayoutStore.getState().assetPanes.resources[props.workspaceId] ?? 'explorer'
    setAssetPane('resources', props.workspaceId, 'detail')
    return () => setAssetPane('resources', props.workspaceId, previous)
  }, [target.temporary, props.workspaceId, setAssetPane])

  useEffect(() => {
    if (!target.temporary) setTemporaryExpansion(undefined)
  }, [target.temporary])

  useEffect(() => {
    if (!props.routeResourceId) { revealedRoute.current = undefined; return }
    if (target.temporary || !target.target || revealedRoute.current === revealKey) return
    revealedRoute.current = revealKey
    const previous = useStudioLayoutStore.getState().assetLayouts.resources.views[props.workspaceId]?.expandedIds ?? []
    setExpandedIds('resources', props.workspaceId, [...new Set([...previous, ...loreRevealExpandedIds(target.target.rootNode, props.routeAssetId)])])
  }, [props.routeResourceId, props.routeAssetId, revealKey, target.temporary, target.target, props.workspaceId, setExpandedIds])

  function handleSelectNode(id: string) {
    setAssetPane('resources', props.workspaceId, 'detail')
    if (target.temporary) {
      setTemporarySelection({
        resourceId: props.routeResourceId!, nodeId: id,
        routeAssetId: props.routeAssetId, requestId: props.searchMatch?.requestId,
      })
      const pathNodes = findContextAssetPath(target.target ? [target.target.rootNode] : workbenchNodes, id)
      if (pathNodes.length > 1) {
        const expanded = new Set(temporaryExpandedIds)
        for (const p of pathNodes.slice(0, -1)) expanded.add(p.id)
        setTemporaryExpansion({ key: revealKey, ids: [...expanded] })
      }
    } else {
      openAssetDetail('resources', props.workspaceId, id)
      const pathNodes = findContextAssetPath(workbenchNodes, id)
      if (pathNodes.length > 1) {
        const expanded = new Set(explorerView.expandedIds ?? [])
        let changed = false
        for (const pathNode of pathNodes.slice(0, -1)) {
          if (!expanded.has(pathNode.id)) {
            expanded.add(pathNode.id)
            changed = true
          }
        }
        if (changed) {
          setExpandedIds('resources', props.workspaceId, [...expanded])
        }
      }
    }
  }

  async function handleDeleteResource(resourceId: string) {
    await props.onDeleteResource(resourceId)
    setInternalSelectedResourceId(current => current === resourceId ? undefined : current)
  }

  function handleSelectResource(resourceId: string) {
    setInternalSelectedResourceId(resourceId)
    if (props.onSelectResource) {
      props.onSelectResource(resourceId, target.temporary)
      return
    }
    const resource = loreResources.find(r => r.id === resourceId)
    if (resource) {
      handleSelectNode(resource.rootNode.id)
    }
  }

  if (props.routeResourceId && (target.unavailable || (props.routeAssetId && !findContextAssetNode([routeTargetResource!.rootNode], props.routeAssetId)))) {
    return <ResourceUnavailable message={props.t('promptResource.referenceUnavailable')} />
  }

  return (
    <>
    <AssetWorkbenchLayout
      deferHiddenDetail
      explorerWidth={explorerLayout.explorerWidth}
      hasSelection={hasDetailSelection}
      mobilePane={mobilePane}
      onMobilePaneChange={pane => setAssetPane('resources', props.workspaceId, pane)}
      header={(
        <div className={styles.header}>
        <PanelTabs
          activeId={scopeFilter}
          ariaLabel={props.t('context.authoring.views')}
          items={[
            { id: 'current', label: props.t('context.scope.currentCharacter') },
            { id: 'global', label: props.t('context.scope.global') },
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
          resourceKind="lore"
          resources={targetResources}
          selectedResourceId={selectedResourceId}
          t={props.t}
          bindResourcesLabel={props.t(scopeFilter === 'global' ? 'context.globalBindings.action' : 'context.cardBindings.action')}
          onBindResources={scopeFilter === 'global' || props.card ? () => setBindingOpen(true) : undefined}
          onCreate={props.onCreateResource}
          draftResourceIds={props.draftResourceIds}
          onDiscardDraft={props.onDiscardDraft}
          onRetryDraft={props.onRetryDraft}
          onDelete={handleDeleteResource}
          onDuplicate={props.onDuplicateResource}
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
            highlightQuery={props.globalSearchQuery}
            tokenSnapshot={tokenSnapshot}
            formatMeta={readLoreTreeMeta}
            revealId={props.routeResourceId ? props.routeAssetId ?? target.target?.rootNode.id : undefined}
            renderLabelSuffix={node => target.temporary && node.id === target.target?.rootNode.id
              ? <span className={styles.temporaryIndicator} tabIndex={0} role="img" aria-label={props.t('promptResource.temporaryHint')}>
                  <ScanEye size={14} aria-hidden="true" />
                  <span className={styles.temporaryHint} aria-hidden="true">{props.t('promptResource.temporaryHint')}</span>
                </span> : null}
            key={target.temporary ? `temporary:${props.routeResourceId}` : 'collection'}
            displayNodes={displayNodes}
            expandedIds={target.temporary ? temporaryExpandedIds : explorerView.expandedIds}
            query={searchQuery}
            scrollKey={`resources:${props.workspaceId}:${target.temporary ? props.routeResourceId : scopeFilter}`}
            selectedId={selectedId}
            t={props.t}
            virtualized
            workspaceId={props.workspaceId}
            onAddNode={props.onAddNode}
            onAddFolderNode={props.onAddFolderNode}
            onDeleteNode={async (id, currentSelectedId) => {
              const resource = loreResources.find(item => item.rootNode.id === id)
              if (!resource) return props.onDeleteNode(id, currentSelectedId)
              setDeleteError(undefined)
              setPendingDelete(resource)
              return currentSelectedId
            }}
            onBatchToggleEnabled={props.onBatchToggleEnabled}
            onDuplicateNode={props.onDuplicateNode}
            onRenameNode={props.onRenameNode}
            onExpandedIdsChange={expandedIds => target.temporary ? setTemporaryExpansion({ key: revealKey, ids: expandedIds }) : setExpandedIds('resources', props.workspaceId, expandedIds)}
            onMoveNode={(draggedId, targetId, position) => {
              props.onMoveNode(draggedId, targetId, position)
            }}
            onQueryChange={props.onSearchQueryChange}
            onSelectId={id => {
              if (id) handleSelectNode(id)
              else setSelectedId('resources', props.workspaceId, undefined)
            }}
            onToggleEnabled={(id, enabled) => {
              props.onCommitNode(id, { enabled })
            }}
          />
          <ResourceBindingDialog
            boundIds={boundIds}
            readonlyIds={readonlyGlobalIds}
            extensionInstallations={props.extensionInstallations}
            description={props.t(scopeFilter === 'global' ? 'context.globalBindings.description' : 'context.cardBindings.description')}
            open={bindingOpen}
            resources={bindingResources}
            t={props.t}
            title={props.t(scopeFilter === 'global' ? 'context.globalBindings.title' : 'context.cardBindings.title')}
            onChange={resourceIds => scopeFilter === 'global'
              ? props.onReplaceLoreMounts({ kind: 'manual', id: 'global' }, resourceIds.filter(id => !readonlyGlobalIds.has(id)))
              : props.onReplaceCardResources(props.card!.id, resourceIds, props.card!.version)}
            onClose={() => setBindingOpen(false)}
          />
        </div>
      )}
    >
      <div
        className={styles.viewContent}
        id={`${viewId}-lore-content`}
        role="tabpanel"
        aria-labelledby={`${viewId}-lore`}
      >
        <ContextAssetEditor
          activationEditable={selectedNode?.category === 'lore'}
          presets={props.resources.filter(resource => resource.resourceKind === 'preset')}
          editorMode={textEditorMode}
          metadataOpen={metadataOpen}
          node={selectedNode}
          revealMatch={props.searchMatch?.resourceId === selectedNodeResource?.id && props.searchMatch?.nodeId === selectedNode?.id
            ? props.searchMatch : undefined}
          pathNodes={findContextAssetPath(workbenchNodes, selectedNode?.id)}
          t={props.t}
          onChangeNode={props.onChangeNode}
          onCommitNode={props.onCommitNode}
          onEditorModeChange={setTextEditorMode}
          onMetadataOpenChange={setMetadataOpen}
        />
      </div>
    </AssetWorkbenchLayout>
    <Dialog
      open={Boolean(pendingDelete)}
      role="alertdialog"
      title={props.t('promptResource.deleteConfirmTitle')}
      description={props.t('promptResource.deleteConfirmBody', { name: pendingDelete?.rootNode.label ?? '' })}
      dismissible={!deleting}
      onClose={() => setPendingDelete(undefined)}
      actions={<>
        <button type="button" disabled={deleting} onClick={() => setPendingDelete(undefined)}>{props.t('promptResource.cancel')}</button>
        <button type="button" disabled={deleting} onClick={async () => {
          if (!pendingDelete) return
          setDeleting(true)
          setDeleteError(undefined)
          try {
            await handleDeleteResource(pendingDelete.id)
            setPendingDelete(undefined)
          } catch (error) {
            setDeleteError(error instanceof Error ? error.message : String(error))
          } finally {
            setDeleting(false)
          }
        }}>{props.t('promptResource.confirmDelete')}</button>
      </>}
    >
      {deleteError ? <p role="alert">{deleteError}</p> : null}
    </Dialog>
    </>
  )
}

function ResourceBindingDialog(props: {
  boundIds: string[]
  readonlyIds?: ReadonlySet<string>
  extensionInstallations?: import('../../entities/index.js').ListExtensionInstallationsResult['installations']
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
  const available = props.resources.filter(resource => resource.resourceKind === 'lore' && !props.boundIds.includes(resource.id)
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
        <div className={styles.globalLoreOptions}>
          {bound.map(({ id, resource }) => {
            const isReadonly = Boolean(props.readonlyIds?.has(id))
            const origin = resource?.origin
            const isBuiltin = origin?.kind === 'builtin'
            const isExtension = origin?.kind === 'extension-package'
            const installation = origin?.kind === 'extension-package'
              ? props.extensionInstallations?.find(inst => inst.id === origin.installationId && inst.packageId === origin.packageId)
              : undefined
            const originLabel = isBuiltin
              ? props.t('promptResource.official')
              : isExtension
                ? (installation?.packageId ?? origin.packageId ?? props.t('directory.extensionContribution'))
                : undefined

            if (isReadonly) {
              return (
                <span key={id} className={styles.globalLorePillReadonly} title={originLabel}>
                  <span>{resource?.rootNode.label ?? props.t('context.bindings.unavailable', { id })}</span>
                  {originLabel ? <small className={styles.pillBadge}>{originLabel}</small> : null}
                </span>
              )
            }

            return (
              <button
                aria-label={props.t('context.bindings.remove', { id })}
                className={styles.globalLorePill}
                disabled={pending}
                key={id}
                type="button"
                onClick={() => void change(props.boundIds.filter(candidate => candidate !== id))}
              >
                <span>{resource?.rootNode.label ?? props.t('context.bindings.unavailable', { id })}</span>
                <X aria-hidden="true" size={12} />
              </button>
            )
          })}
        </div>
        {bound.some(item => !item.resource && !props.readonlyIds?.has(item.id)) ? (
          <button
            className={styles.removeUnavailableButton}
            disabled={pending}
            type="button"
            onClick={() => void change(bound.filter(item => item.resource || props.readonlyIds?.has(item.id)).map(item => item.id))}
          >
            <Trash2 aria-hidden="true" size={14} />
            {props.t('context.bindings.removeUnavailable')}
          </button>
        ) : null}
        <SearchField
          autoFocus
          aria-label={props.t('context.bindings.search')}
          clearLabel={props.t('context.search.clear')}
          disabled={pending}
          placeholder={props.t('context.bindings.searchPlaceholder')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onClear={() => setQuery('')}
        />
        <div className={styles.bindingResults}>
          {available.length === 0 ? (
            <span className={styles.bindingEmpty}>{props.t('context.bindings.noResults')}</span>
          ) : (
            available.map(resource => {
              const origin = resource.origin
              const isBuiltin = origin?.kind === 'builtin'
              const isExtension = origin?.kind === 'extension-package'
              const badgeLabel = isBuiltin
                ? props.t('promptResource.official')
                : isExtension
                  ? origin.packageId
                  : resource.resourceKind

              return (
                <button
                  className={styles.bindingItem}
                  disabled={pending}
                  key={resource.id}
                  type="button"
                  onClick={() => void change([...props.boundIds, resource.id])}
                >
                  <strong className={styles.bindingItemLabel}>{resource.rootNode.label}</strong>
                  <small className={styles.bindingItemBadge}>{badgeLabel}</small>
                </button>
              )
            })
          )}
        </div>
      </div>
    </Dialog>
  )
}
