import type { MemoryLogSink } from '@loom-studio/logging'
import type { ReactNode } from 'react'
import type { StudioPanelId } from '../pages/studio/model/studio-layout-store.js'
import { useStudioLayoutStore, useStudioPanelStore } from '../pages/studio/model/studio-layout-store.js'
import { ModelPanel } from '../widgets/model-panel/model-panel.js'
import { AgentPanel } from '../widgets/agent-panel/agent-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { LogViewer } from '../widgets/log-viewer/log-viewer.js'
import { SessionsPanel } from '../widgets/sessions-panel/sessions-panel.js'
import { PlayPanel } from '../widgets/play-panel/play-panel.js'
import { CharacterPanel } from '../widgets/character-panel/character-panel.js'
import { TextTransformPanel } from '../features/text-transforms/ui/text-transform-panel.js'
import { RendererWorkspacePanel } from '../features/extension-renderers/ui/renderer-workspace-panel.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { SettingsPanel } from '../widgets/settings-panel/settings-panel.js'
import { StudioStatePanel } from './studio-state-panel.js'
import { toast } from 'sonner'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'

type StudioState = ReturnType<typeof useStudioState>
type StudioUiState = ReturnType<typeof useStudioUiState>
type StudioNavigation = ReturnType<typeof useStudioNavigation>

export function createStudioPanels(input: {
  state: StudioState
  uiState: StudioUiState
  navigation: StudioNavigation
  rendererHost: NonNullable<Parameters<typeof TextTransformPanel>[0]['rendererHost']>
  clientExtensions: ReturnType<typeof useClientExtensionRuntime>
  clientLogs: MemoryLogSink
  resourcePanels: Record<'preset' | 'resource', (active: boolean) => ReactNode>
  assetWorkspaceId: string
  cardsBusy: boolean
  providerBusy: boolean
  agentProfileBusy: boolean
  activePresetId: string | undefined
  narrativeCharacterName?: string
  sourceCardId?: string
  sessionBusy: boolean
  openStateSource: (scope: 'global' | 'timeline') => void
  uiScale: number
  setUiScale: (scale: number) => void
}): Record<StudioPanelId, (active: boolean) => ReactNode> {
  const { state, uiState, navigation, rendererHost, clientExtensions, clientLogs, resourcePanels, assetWorkspaceId, cardsBusy, providerBusy, agentProfileBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, uiScale, setUiScale } = input
  const panels: Record<StudioPanelId, (active: boolean) => ReactNode> = {
    model: () => (
      <ModelPanel
        busy={providerBusy}
        providerAccountDraft={state.providerAccountDraft}
        modelProfiles={state.modelProfiles}
        aiProviders={state.aiProviders}
        aiCapabilityProfiles={state.aiCapabilityProfiles}
        providerAccounts={state.providerAccounts}
        t={state.t}
        onChangeProviderAccountDraft={state.setProviderAccountDraft}
        onCreateModelProfile={state.createModelProfile}
        onCreateProviderAccount={state.createProviderAccount}
        onCreateAiProviderAccount={state.createAiProviderAccount}
        onCreateAiCapabilityProfile={state.createAiCapabilityProfile}
        onUpdateAiProviderAccount={state.updateAiProviderAccount}
        onUpdateAiCapabilityProfile={state.updateAiCapabilityProfile}
        onDeleteModelProfile={state.deleteModelProfile}
        onDeleteProviderAccount={state.deleteProviderAccount}
        onListProviderModels={state.listProviderModels}
        onInvokeAiCapability={state.invokeAiCapability}
        onRefreshAiProviders={state.refreshAiProviders}
        onUpdateProviderConnection={state.updateProviderConnection}
      />
    ),
    agent: () => (
      <AgentPanel
        presets={state.presets}
        agentProfiles={state.agentProfiles}
        tools={state.agentTools}
        toolMounts={state.presetToolMounts}
        busy={agentProfileBusy}
        modelProfiles={state.modelProfiles}
        providerAccounts={state.providerAccounts}
        selectedAgentProfileId={state.selectedAgentProfileId}
        t={state.t}
        onCreate={state.createAgentProfile}
        onDelete={state.deleteAgentProfile}
        onSelect={state.selectAgentProfile}
        onUpdate={state.updateAgentProfile}
      />
    ),
    play: active => active ? (
      <PlayPanel
        character={panels.character(true)}
        sessions={panels.sessions(true)}
        t={state.t}
        cards={state.cards}
        timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
        agentSessions={state.agentChatSessions}
        onOpenCard={card => {
          state.setSelectedCardId(card.id)
          void state.refreshCardTimelines(card.id).then(timelines => {
            const latest = [...timelines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
            if (latest) {
              void state.activateTimeline(latest.id).then(branchId => {
                if (branchId) navigation.openNarrative(latest.id, branchId)
              })
            } else {
              void state.createTimelineFromCard(card.id).then(activated => {
                if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
              })
            }
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
      <SessionsPanel
        activeBranch={state.branch}
        activeTimeline={state.narrativeTimeline}
        agentChatSession={state.agentChatSession}
        allAgentSessions={state.allAgentSessions}
        agentProfiles={state.agentProfiles}
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
      <CharacterPanel
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
          state.setSelectedCardId(cardId)
          void state.refreshCardTimelines(cardId).then(timelines => {
            const latest = [...timelines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
            if (latest) {
              void state.activateTimeline(latest.id)
            } else {
              state.resetToDraftTimeline()
            }
          })
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
          useStudioPanelStore.getState().setActivePanel('state')
        }}
        onOpenResourcePanel={resourceId => {
          useStudioPanelStore.getState().setActivePanel('resource')
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
    preset: resourcePanels.preset,
    resource: resourcePanels.resource,
    state: () => <StudioStatePanel
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
      <TextTransformPanel
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
      <InspectorPanel
        agentTranscript={state.agentMessages}
        cardSnapshot={state.selectedCardDetails ?? null}
        promptBuildSteps={state.promptBuildSteps}
        promptBuildTrace={state.promptBuildTrace ?? null}
        promptMessages={state.promptMessages ?? null}
        providerPayloadPreview={state.providerPayloadPreview ?? null}
        runDetails={state.lastRun ?? null}
        t={state.t}
      />
    ),
    logs: active => <LogViewer active={active} api={state.logsApi} clientLogs={clientLogs} t={state.t} />,
    extensions: () => (
      <RendererWorkspacePanel
        key={state.endpoint}
        officialContent={state.officialContentApi}
        models={state.modelProfiles}
        onCreateAgent={state.createAgentProfile}
        extensionHost={clientExtensions.host}
        host={rendererHost}
        packages={clientExtensions.packages}
        serverDiagnostics={clientExtensions.serverDiagnostics}
        sessionHost={clientExtensions.sessionHost}
        t={state.t}
        onDisable={clientExtensions.disable}
        onEnable={clientExtensions.enable}
        onImportResources={state.importExtensionPackageResources}
        onRemoveResources={state.removeExtensionPackageResources}
        onReload={clientExtensions.reload}
        onUninstall={clientExtensions.uninstall}
      />
    ),
    settings: () => (
      <SettingsPanel
        busy={state.operationPending.settings.pendingCount > 0}
        customCss={state.customCss}
        locale={state.locale}
        networkSettings={state.networkSettings}
        textTransformsApi={state.textTransformsApi}
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
