import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import { LazyContextWorkbench, LazyPresetWorkbench } from './studio-panel-modules.js'

type StudioState = ReturnType<typeof useStudioState>
type StudioUiState = ReturnType<typeof useStudioUiState>
type StudioNavigation = ReturnType<typeof useStudioNavigation>

export function StudioResourcePanels(props: {
  state: StudioState
  uiState: StudioUiState
  navigation: StudioNavigation
  assetWorkspaceId: string
}) {
  const { state, uiState, navigation, assetWorkspaceId } = props
  const contextAssetEditorProps = {
    nodes: state.contextAssets,
    resources: state.promptResourceDrafts,
    extensionInstallations: state.extensionInstallations,
    resourceBindings: { api: state.api.promptResources, endpoint: state.endpoint },
    draftResourceIds: state.draftResourceIds,
    onDiscardDraft: state.discardContextAssetDraft,
    onRetryDraft: state.retryContextAssetDraft,
    onChangeNode: state.previewContextAsset,
    // Terminal editor events rely on the operation reporter; selection-changing commands retain rejection.
    onCommitNode: (...args: Parameters<StudioState['updateContextAsset']>) => {
      void state.updateContextAsset(...args).catch(() => undefined)
    },
    onChangeNodes: (...args: Parameters<StudioState['updateContextAssets']>) => {
      void state.updateContextAssets(...args).catch(() => undefined)
    },
    onMoveNode: (...args: Parameters<StudioState['moveContextAsset']>) => {
      void state.moveContextAsset(...args).catch(() => undefined)
    },
    onRenameNode: (id: string, label: string) => state.updateContextAsset(id, { label }),
    onAddNode: state.addContextAsset,
    onAddFolderNode: state.addContextAssetFolder,
    onAddAnchorNode: state.addContextAssetAnchor,
    onAddMessageBlockNode: state.addContextAssetMessageBlock,
    onAddNodeInZone: state.addContextAssetInZone,
    onDuplicateNode: state.duplicateContextAsset,
    onDeleteNode: state.deleteContextAsset,
    onCreateResource: state.createPromptResource,
    onDuplicateResource: state.duplicatePromptResource,
    onDeleteResource: async (resourceId: string) => {
      await state.deletePromptResource(resourceId)
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
        textTransformsApi={state.textTransformsApi}
        onOpenTextUse={(kind, id) => navigation.openPath(`/studio/text-transforms?${kind === 'rule' ? 'ruleId' : 'extractorId'}=${encodeURIComponent(id)}&temporary=1`)}
        loomScriptsApi={state.api.loomScripts}
        onLoomScriptsChanged={uiState.bumpLoomScriptRefreshToken}
        onSaveMacros={state.updatePresetMacros}
        modelProfiles={state.modelProfiles}
        providerAccounts={state.providerAccounts}
        onSaveModel={state.updatePresetModel}
        selectedResourceId={uiState.selectedPresetId}
        onSelectResource={id => {
          uiState.setSelectedPresetId(id)
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('preset', id, resource.rootNode.id)
        }}
        onOpenSetting={(resourceId, nodeId) => navigation.openResource('resource', resourceId, nodeId)}
        previewApi={state.api.narratives}
        previewTimelineId={state.narrativeTimeline?.id}
        previewBranchId={state.branch?.id}
        routeResourceId={navigation.route.panel === 'agent' ? navigation.route.resourceId : undefined}
        timelinePromptResourceIds={state.narrativeTimeline?.promptResourceIds}
        card={state.selectedCardDetails}
        settingMounts={state.settingMounts}
        tools={state.agentTools}
        toolMounts={state.presetToolMounts}
        onReplaceToolMounts={state.replacePresetToolMounts}
        onReplaceSettingMounts={(source, mounts) => state.replaceSettingMounts(source, mounts, 'mounts')}
        onUpdateTool={state.updateAgentTool}
        routeAssetId={navigation.route.panel === 'agent' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'agent' ? navigation.searchQuery : ''}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
    resource: () => (
      <LazyContextWorkbench
        key={state.endpoint}
        {...contextAssetEditorProps}
        routeResourceId={navigation.route.panel === 'resource' ? navigation.route.resourceId : undefined}
        onSelectResource={(id, replace) => {
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('resource', id, resource.rootNode.id, replace)
        }}
        card={state.selectedCardDetails}
        settingMounts={state.settingMounts}
        onReplaceSettingMounts={state.replaceSettingMounts}
        onReplaceCardResources={state.replaceCardPromptResources}
        routeAssetId={navigation.route.panel === 'resource' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
  }
}
