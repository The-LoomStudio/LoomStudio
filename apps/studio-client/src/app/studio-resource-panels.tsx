import type { ResourceSearchReveal } from '../shared/lib/search-match.js'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import { LazyContextWorkbench, LazyPresetWorkbench } from './studio-panel-modules.js'
import { formatEntityReference } from '@loom-studio/shared'

type StudioState = ReturnType<typeof useStudioState>
type StudioUiState = ReturnType<typeof useStudioUiState>
type StudioNavigation = ReturnType<typeof useStudioNavigation>

export function StudioResourcePanels(props: {
  state: StudioState
  currentCard?: StudioState['selectedCardDetails']
  uiState: StudioUiState
  navigation: StudioNavigation
  assetWorkspaceId: string
  globalSearchQuery?: string
  searchMatch?: ResourceSearchReveal
}) {
  const { state, uiState, navigation, assetWorkspaceId } = props
  const contextAssetEditorProps = {
    globalSearchQuery: props.globalSearchQuery,
    resources: state.promptResourceDrafts,
    extensionInstallations: state.extensionInstallations,
    draftResourceIds: state.draftResourceIds,
    onDiscardDraft: state.discardContextAssetDraft,
    onRetryDraft: state.retryContextAssetDraft,
    onChangeNode: state.previewContextAsset,
    onBatchToggleEnabled: async (ids: string[], enabled: boolean) => {
      const failedIds: string[] = []
      const errors: string[] = []
      for (const id of ids) {
        try { await state.updateContextAsset(id, { enabled }) }
        catch (cause) { failedIds.push(id); errors.push(cause instanceof Error ? cause.message : String(cause)) }
      }
      return { failedIds, error: errors.join('\n') }
    },
    // Terminal editor events rely on the operation reporter; selection-changing commands retain rejection.
    onCommitNode: (...args: Parameters<StudioState['updateContextAsset']>) => {
      void state.updateContextAsset(...args).catch(() => undefined)
    },
    onMoveNode: (...args: Parameters<StudioState['moveContextAsset']>) => {
      void state.moveContextAsset(...args).catch(() => undefined)
    },
    onRenameNode: (id: string, label: string) => {
      const targetResource = state.promptResourceDrafts.find(item => item.id === id)
      const targetId = targetResource ? targetResource.rootNode.id : id
      return state.updateContextAsset(targetId, { label })
    },
    onAddNode: state.addContextAsset,
    onAddFolderNode: state.addContextAssetFolder,
    onAddAnchorNode: state.addContextAssetAnchor,
    onAddMessageBlockNode: state.addContextAssetMessageBlock,
    onAddMessageSequenceNode: state.addContextAssetMessageSequence,
    onDuplicateNode: state.duplicateContextAsset,
    onDeleteNode: state.deleteContextAsset,
    onCreateResource: state.createPromptResource,
    onDuplicateResource: state.duplicatePromptResource,
    onDeleteResource: async (resourceId: string) => {
      await state.deletePromptResource(resourceId)
      navigation.clearResourceTarget(resourceId)
      if (uiState.selectedPresetId === resourceId) uiState.setSelectedPresetId(undefined)
    },
    onImportResource: state.importPromptResource,
    onExportResource: state.exportPromptResource,
    onExportResourceZip: state.exportPromptResourceZip,
    onImportResourceZip: state.importPromptResourceZip,
    t: state.t,
    workspaceId: JSON.stringify([state.endpoint, assetWorkspaceId]),
  }

  return {
    preset: (active: boolean) => (
      <LazyPresetWorkbench
        active={active}
        key={state.endpoint}
        {...contextAssetEditorProps}
        resourceBindings={{ api: state.api.promptResources, endpoint: state.endpoint }}
        searchMatch={props.searchMatch}
        textTransformsApi={state.textTransformsApi}
        onOpenTextUse={(kind, id) => navigation.openPath(`/studio/text-transforms?${kind === 'rule' ? 'ruleId' : 'extractorId'}=${encodeURIComponent(id)}&temporary=1`)}
        modelProfiles={state.modelProfiles}
        onCreateModel={state.createModelProfile}
        onListModels={state.listProviderModels}
        providerAccounts={state.providerAccounts}
        onSaveModel={state.updatePresetModel}
        onReturnToLibrary={() => navigation.searchParams.has('toolId') ? navigation.openPath('/studio/agents') : navigation.clearResourceTarget()}
        selectedResourceId={uiState.selectedPresetId}
        onSelectResource={id => {
          if (!navigation.isCurrent()) return
          uiState.setSelectedPresetId(id)
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('preset', id, resource.rootNode.id)
          else void navigation.openUri(formatEntityReference({ kind: 'entity', type: 'resource', id }))
        }}
        onOpenLore={(resourceId, nodeId) => navigation.openResource('resource', resourceId, nodeId)}
        previewApi={state.api.narratives}
        previewTimelineId={state.narrativeTimeline?.id}
        previewBranchId={state.branch?.id}
        routeResourceId={navigation.route.panel === 'agent' ? navigation.route.resourceId : undefined}
        timelinePromptResourceIds={state.narrativeTimeline?.promptResourceIds}
        card={props.currentCard}
        loreMounts={state.loreMounts}
        tools={state.agentTools}
        toolsReady={state.startup.ready('tools')}
        providersReady={state.startup.ready('providers')}
        toolMounts={state.presetToolMounts}
        onReplaceToolMounts={state.replacePresetToolMounts}
        onReplaceLoreMounts={(source, mounts) => state.replaceLoreMounts(source, mounts, 'mounts')}
        onUpdateTool={state.updateAgentTool}
        routeToolId={navigation.route.panel === 'agent' && !navigation.route.resourceId && !navigation.route.assetId ? navigation.searchParams.get('toolId') ?? undefined : undefined}
        routeAssetId={navigation.route.panel === 'agent' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'agent' ? navigation.searchQuery : ''}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
    resource: () => (
      <LazyContextWorkbench
        key={state.endpoint}
        {...contextAssetEditorProps}
        searchMatch={props.searchMatch}
        routeResourceId={navigation.route.panel === 'resource' ? navigation.route.resourceId : undefined}
        onSelectResource={(id, replace) => {
          if (!navigation.isCurrent()) return
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('resource', id, resource.rootNode.id, replace)
          else void navigation.openUri(formatEntityReference({ kind: 'entity', type: 'resource', id }), replace)
        }}
        card={props.currentCard}
        loreMounts={state.loreMounts}
        onReplaceLoreMounts={state.replaceLoreMounts}
        onReplaceCardResources={state.replaceCardPromptResources}
        routeAssetId={navigation.route.panel === 'resource' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
  }
}
