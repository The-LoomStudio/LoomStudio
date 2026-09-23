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
    preset: () => (
      <LazyPresetWorkbench
        key={state.endpoint}
        {...contextAssetEditorProps}
        textTransformsApi={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onLoomScriptsChanged={uiState.bumpLoomScriptRefreshToken}
        onSaveMacros={state.updatePresetMacros}
        selectedResourceId={uiState.selectedPresetId}
        onSelectResource={id => {
          uiState.setSelectedPresetId(id)
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('preset', id, resource.rootNode.id)
        }}
        routeResourceId={navigation.route.panel === 'preset' ? navigation.route.resourceId : undefined}
        timelinePromptResourceIds={state.narrativeTimeline?.promptResourceIds}
        settingMounts={state.settingMounts}
        tools={state.agentTools}
        toolMounts={state.presetToolMounts}
        onReplaceToolMounts={state.replacePresetToolMounts}
        onUpdateTool={state.updateAgentTool}
        routeAssetId={navigation.route.panel === 'preset' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'preset' ? navigation.searchQuery : ''}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
    resource: () => (
      <LazyContextWorkbench
        key={state.endpoint}
        {...contextAssetEditorProps}
        routeResourceId={navigation.route.panel === 'resource' ? navigation.route.resourceId : undefined}
        onSelectResource={id => {
          const resource = state.promptResourceDrafts.find(item => item.id === id)
          if (resource) navigation.openResource('resource', id, resource.rootNode.id)
        }}
        textTransformsApi={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onLoomScriptsChanged={uiState.bumpLoomScriptRefreshToken}
        view={uiState.resourceView}
        onViewChange={uiState.setResourceView}
        macroAuthoring={state.selectedCardDetails?.id === assetWorkspaceId ? {
          ownerId: assetWorkspaceId,
          ownerLabel: state.selectedCardDetails.name,
          version: state.selectedCardDetails.version,
          macros: state.selectedCardDetails.macros ?? {},
          onSave: config => state.updateCardMacros({ cardId: assetWorkspaceId, ...config }),
          t: state.t,
        } : undefined}
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
