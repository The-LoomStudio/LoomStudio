import type { MemoryLogSink } from '@loom-studio/logging'
import type { ReactNode } from 'react'
import type { ClientRendererHost } from '../shared/extension-renderer-runtime/client-renderer-host.js'
import type { StudioPanelId } from '../shared/studio-shell/studio-layout-store.js'
import { useStudioLayoutStore } from '../shared/studio-shell/studio-layout-store.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { toast } from 'sonner'
import type { RegisteredClientBackground } from '@loom-studio/extension-sdk'
import { clientModuleKey } from '../features/extension-renderers/model/client-actions.js'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import {
  LazyCharacterPanel,
  LazyInspectorPanel,
  LazyLogViewer,
  LazyModelPanel,
  LazyPlayPanel,
  LazyRendererWorkspacePanel,
  LazySessionsPanel,
  LazySettingsPanel,
  LazyStudioStatePanel,
  LazyTextTransformPanel,
} from './studio-panel-modules.js'

type StudioState = ReturnType<typeof useStudioState>
type StudioUiState = ReturnType<typeof useStudioUiState>
type StudioNavigation = ReturnType<typeof useStudioNavigation>

export function createStudioPanels(input: {
  state: StudioState
  uiState: StudioUiState
  navigation: StudioNavigation
  rendererHost: ClientRendererHost
  clientExtensions: ReturnType<typeof useClientExtensionRuntime>
  clientLogs: MemoryLogSink
  resourcePanels: Record<'preset' | 'resource', (active: boolean) => ReactNode>
  assetWorkspaceId: string
  cardsBusy: boolean
  providerBusy: boolean
  agentPresetBusy: boolean
  activePresetId: string | undefined
  narrativeCharacterName?: string
  sourceCardId?: string
  sessionBusy: boolean
  openStateSource: (scope: 'global' | 'timeline') => void
  uiScale: number
  setUiScale: (scale: number) => void
  backgrounds: readonly RegisteredClientBackground[]
}): Record<StudioPanelId, (active: boolean) => ReactNode> {
  const { state, uiState, navigation, rendererHost, clientExtensions, clientLogs, resourcePanels, assetWorkspaceId, cardsBusy, providerBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, uiScale, setUiScale, backgrounds } = input
  const panels: Record<StudioPanelId, (active: boolean) => ReactNode> = {
    model: () => (
      <LazyModelPanel
        busy={providerBusy}
        providerAccountDraft={state.providerAccountDraft}
        modelProfiles={state.modelProfiles}
        providerAccounts={state.providerAccounts}
        t={state.t}
        onChangeProviderAccountDraft={state.setProviderAccountDraft}
        onCreateModelProfile={state.createModelProfile}
        onCreateProviderAccount={state.createProviderAccount}
        onDeleteModelProfile={state.deleteModelProfile}
        onDeleteProviderAccount={state.deleteProviderAccount}
        onListProviderModels={state.listProviderModels}
        onUpdateProviderConnection={state.updateProviderConnection}
      />
    ),
    agent: resourcePanels.preset,
    play: active => active ? (
      <LazyPlayPanel
        character={panels.character(true)}
        sessions={panels.sessions(true)}
        t={state.t}
        cards={state.cards}
        timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
        agentSessions={state.agentChatSessions}
        onOpenCard={card => {
          void state.selectCardTimeline(card.id, true).then(activated => {
            if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
          })
        }}
        onOpenTimeline={timeline => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId) navigation.openNarrative(timeline.id, branchId)
          })
        }}
        onOpenAgentSession={session => {
          void state.activateAgentSession(session)
          uiState.setAgentPanelOpen(true)
        }}
      />
    ) : null,
    sessions: () => (
      <LazySessionsPanel
        activeBranch={state.branch}
        activeTimeline={state.narrativeTimeline}
        agentChatSession={state.agentChatSession}
        allAgentSessions={state.allAgentSessions}
        agentPresets={state.agentPresets}
        api={state.api}
        branches={state.branches}
        cards={state.cards}
        narrativeAgentSession={state.narrativeAgentSession}
        selectedCardName={state.selectedCardDetails?.name ?? state.selectedCard?.name}
        t={state.t}
        timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
        onDeleteAgentSession={state.deleteAgentSession}
        onDeleteTimeline={state.deleteTimeline}
        onOpenAgentSessionInSidebar={session => {
          void state.activateAgentSession(session)
          uiState.setAgentPanelOpen(true)
        }}
        onOpenTimeline={timeline => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId) navigation.openNarrative(timeline.id, branchId)
          })
        }}
        onRenameAgentSession={state.renameAgentSession}
        onRenameTimeline={state.renameTimeline}
        onArchiveImported={async timelineId => {
          await state.refreshAllTimelines()
          await state.activateTimeline(timelineId)
        }}
      />
    ),
    character: active => (
      <LazyCharacterPanel
        active={active}
        busy={cardsBusy || sessionBusy}
        cardDraft={state.cardDraft}
        cards={state.cards}
        selectedCard={state.selectedCardDetails ?? state.selectedCard}
        selectedCardId={state.selectedCardId}
        timeline={state.narrativeTimeline}
        timelines={state.cardTimelines}
        macroContext={state.macroContext}
        t={state.t}
        onChangeCardDraft={state.setCardDraft}
        onCreateCard={state.createCard}
        onCreateTimelineFromCard={async () => {
          const activated = await state.createTimelineFromCard()
          if (activated) {
            navigation.openNarrative(activated.timelineId, activated.branchId)
          }
        }}
        onDeleteCards={state.deleteCards}
        onPreviewCardDeletion={state.previewCardDeletion}
        onExportCard={state.exportCard}
        directoryApi={state.directoryApi}
        onRefreshCards={state.refreshCards}
        onImportCards={state.importCards}
        onSelectCard={cardId => {
          void navigation.selectCard(cardId, () => state.selectCardTimeline(cardId))
        }}
        onOpenTimeline={timeline => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId) navigation.openNarrative(timeline.id, branchId)
          })
        }}
        onOpenStatePanel={cardId => {
          if (cardId !== sourceCardId) {
            toast.error(state.t('stateAuthoring.noCard'))
            return
          }
          uiState.setVariableView('authoring')
          navigation.openPanel('state')
        }}
        onOpenResourcePanel={resourceId => {
          const resource = state.promptResources.find(item => item.id === resourceId)
          if (resource) {
            void navigation.openResource(resource.resourceKind === 'preset' ? 'agent' : 'resource', resource.id, resource.rootNode.id)
            return
          }
          navigation.openPanel('resource')
          if (resourceId) {
            useStudioLayoutStore.getState().openAssetDetail('resources', assetWorkspaceId, resourceId)
          }
        }}
        resources={state.promptResources}
        onUpdateCardMedia={state.updateCardMedia}
        onUpdateCard={state.updateCard}
        routeCardId={navigation.route.panel === 'character' ? navigation.route.cardId : undefined}
      />
    ),
    preset: () => null,
    resource: resourcePanels.resource,
    state: () => <LazyStudioStatePanel
      hasTimeline={Boolean(state.narrativeTimeline)}
      variableView={uiState.variableView}
      macroTargetKey={state.macroTargetKey}
      macroInspection={state.macroInspection}
      buildMacroInspection={state.buildMacroInspection}
      macroInspectionLoading={state.macroInspectionLoading}
      macroInspectionError={state.macroInspectionError}
      macroSelections={state.macroSelections}
      card={state.narrativeTimeline && state.selectedCardDetails?.id === sourceCardId ? state.selectedCardDetails : undefined}
      statesApi={state.statesApi}
      refreshToken={state.lastRun?.runId}
      timelineTarget={state.narrativeTimeline && state.branch ? { scope: 'timeline', timelineId: state.narrativeTimeline.id, branchId: state.branch.id } : undefined}
      t={state.t}
      onSaveCard={state.updateCardStateConfig}
      onOpenSource={openStateSource}
      onViewChange={uiState.setVariableView}
      onStateMutated={state.refreshStates}
      onSelectSource={state.selectMacroSource}
      onRefresh={state.refreshMacros}
    />,
    'text-transform': () => (
      <LazyTextTransformPanel
        api={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onRuntimeChanged={uiState.bumpLoomScriptRefreshToken}
        rendererHost={rendererHost}
        runtimeScriptContext={{
          workspaceId: 'workspace',
          ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
          ...(activePresetId ? { presetId: activePresetId } : {}),
        }}
        owner={{ kind: 'runtime' }}
        t={state.t}
        runtimeContexts={[
          ...(state.narrativeTimeline && state.branch ? [{
            id: 'narrative',
            label: state.t('textTransform.runtimeNarrative'),
            source: { kind: 'narrative' as const, timelineId: state.narrativeTimeline.id, branchId: state.branch.id },
            consumerAgentSessionId: state.agentChatSession?.id,
          }] : []),
          ...(state.agentChatSession ? [{
            id: `agent-session:${state.agentChatSession.id}`,
            label: state.t('textTransform.runtimeAgentSession'),
            source: { kind: 'agent-session' as const, sessionId: state.agentChatSession.id },
          }] : []),
        ]}
      />
    ),
    inspector: () => (
      <LazyInspectorPanel
        agentTranscript={state.agentMessages}
        cardSnapshot={state.selectedCardDetails ?? null}
        promptBuildSteps={state.promptBuildSteps}
        promptBuildTrace={state.promptBuildTrace ?? null}
        promptMessages={state.promptMessages ?? null}
        providerPayloadPreview={state.providerPayloadPreview ?? null}
        runDetails={state.lastRun ?? null}
        aiProviders={state.aiProviders}
        aiCapabilityProfiles={state.aiCapabilityProfiles}
        providerAccounts={state.providerAccounts}
        onCreateAiProviderAccount={state.createAiProviderAccount}
        onCreateAiCapabilityProfile={state.createAiCapabilityProfile}
        onUpdateAiProviderAccount={state.updateAiProviderAccount}
        onUpdateAiCapabilityProfile={state.updateAiCapabilityProfile}
        onInvokeAiCapability={state.invokeAiCapability}
        onRefreshAiProviders={state.refreshAiProviders}
        t={state.t}
      />
    ),
    logs: active => <LazyLogViewer active={active} api={state.logsApi} clientLogs={clientLogs} extensions={clientExtensions.packages} t={state.t}
      searchParams={navigation.searchParams} onSearchParamsChange={params => { void navigation.setSearchParams(params) }} />,
    extensions: () => (
      <LazyRendererWorkspacePanel
        key={state.endpoint}
        searchParams={navigation.searchParams}
        onNavigate={path => { void navigation.openPath(path) }}
        configRevision={clientExtensions.configRevision}
        extensionRuntime={state.api.extensionRuntime}
        extensionHost={clientExtensions.host}
        host={rendererHost}
        packages={clientExtensions.packages}
        cardPackages={clientExtensions.cardPackages}
        serverDiagnostics={clientExtensions.serverDiagnostics}
        sessionHost={clientExtensions.sessionHost}
        settingScopeContext={{
          ...(state.selectedCardDetails?.id ? { cardId: state.selectedCardDetails.id } : {}),
          ...(state.narrativeTimeline?.id ? { timelineId: state.narrativeTimeline.id } : {}),
          ...(state.agentChatSession?.id ? { agentSessionId: state.agentChatSession.id } : {}),
        }}
        t={state.t}
        onDisable={clientExtensions.disable}
        onEnable={clientExtensions.enable}
        onImportResources={state.importExtensionPackageResources}
        onAttachPackage={state.attachCardExtensionPackage}
        embeddedPackageCard={state.selectedCardDetails}
        onDetachPackage={state.detachCardExtensionPackage}
        onInstallCardPackage={state.installCardPackage}
        onUpdateCardPackage={state.updateCardPackage}
        onUninstallCardPackage={state.uninstallCardPackage}
        onRemoveCardResources={state.removeCardPackageResources}
        installations={state.extensionInstallations}
        promptResources={state.promptResources}
        onOpenPromptResource={resource => {
          void navigation.openResource(resource.resourceKind === 'preset' ? 'agent' : 'resource', resource.id, resource.rootNode.id)
        }}
        onUpdateResources={state.updateExtensionPackageResources}
        onRemoveResources={state.removeExtensionPackageResources}
        onInstallZip={state.installExtensionPackageZip}
        onReload={clientExtensions.reload}
        onUninstall={clientExtensions.uninstall}
      />
    ),
    settings: () => (
      <LazySettingsPanel
        busy={state.operationPending.settings.pendingCount > 0}
        customCss={state.customCss}
        locale={state.locale}
        networkSettings={state.networkSettings}
        textTransformsApi={state.textTransformsApi}
        onTextTransformsChanged={uiState.bumpLoomScriptRefreshToken}
        backgroundCardId={state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId}
        backgrounds={backgrounds.map(item => ({
          id: item.key, name: item.name, description: item.description, image: item.image, source: item.source ?? item.packageId,
          ...(item.target?.kind === 'card' ? { scope: { cardId: item.target.cardId, ownerKey: clientModuleKey(item.packageId, item.moduleId, item.target) } } : {}),
        }))}
        uiScale={uiScale}
        t={state.t}
        onChangeCustomCss={state.setCustomCss}
        onChangeLocale={state.setLocale}
        onChangeUiScale={setUiScale}
        onUpdateNetworkSettings={state.updateNetworkSettings}
      />
    ),
  }
  return panels
}
