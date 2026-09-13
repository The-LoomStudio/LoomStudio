import { PresetWorkbench } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/context-workbench.js'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'

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
    resources: state.promptResources,
    onChangeNode: state.previewContextAsset,
    onCommitNode: state.updateContextAsset,
    onChangeNodes: state.updateContextAssets,
    onMoveNode: state.moveContextAsset,
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
    t: state.t,
    workspaceId: assetWorkspaceId,
  }

  return {
    preset: () => (
      <PresetWorkbench
        {...contextAssetEditorProps}
        textTransformsApi={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onLoomScriptsChanged={uiState.bumpLoomScriptRefreshToken}
        onSaveMacros={state.updatePresetMacros}
        selectedResourceId={uiState.selectedPresetId}
        onSelectResource={uiState.setSelectedPresetId}
        timelinePromptResourceIds={state.narrativeTimeline?.promptResourceIds}
        settingMounts={state.settingMounts}
        tools={state.agentTools}
        toolMounts={state.presetToolMounts}
        onReplaceToolMounts={state.replacePresetToolMounts}
        onUpdateTool={state.updateAgentTool}
        routeAssetId={navigation.route.panel === 'preset' ? navigation.route.assetId : undefined}
        initialSearchQuery={navigation.route.panel === 'preset' ? navigation.searchQuery : ''}
      />
    ),
    resource: () => (
      <ContextWorkbench
        {...contextAssetEditorProps}
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
        initialSearchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
      />
    ),
  }
}
