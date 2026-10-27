import type { UserBackgroundLibrary } from '../features/backgrounds/model/use-user-backgrounds.js'
import type { useExtensionCardContext } from '../features/extension-renderers/model/use-extension-card-context.js'
import type { MemoryLogSink } from '@loom-studio/logging'
import React, { type ReactNode } from 'react'
import { ContentErrorBoundary } from '../shared/ui/content-error-boundary.js'
import { formatEntityReference } from '@loom-studio/shared'
import type { ClientRendererHost } from '../shared/extension-renderer-runtime/client-renderer-host.js'
import type { StudioPanelId } from '../shared/studio-shell/studio-layout-store.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import type { RegisteredClientBackground } from '@loom-studio/extension-sdk'
import type { ThemeController } from '../features/themes/model/theme-controller.js'
import { clientModuleKey } from '../features/extension-renderers/model/client-actions.js'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioUiState } from './use-studio-ui-state.js'
import type { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import {
  LazyCharacterPanel,
  LazyInspectorPanel,
  LazyLogViewer,
  LazyMacroPanel,
  LazyModelPanel,
  LazyMemoryPanel,
  LazyHistoryPanel,
  LazyRecentPlayPanel,
  LazyRendererWorkspacePanel,
  LazySessionsPanel,
  LazySettingsPanel,
  LazyStudioStatePanel,
  LazyTextTransformPanel,
  LazyUserResourcesPanel,
  LazyMyProfilePanel,
} from './studio-panel-modules.js'

type StudioState = ReturnType<typeof useStudioState>
type StudioUiState = ReturnType<typeof useStudioUiState>
type StudioNavigation = ReturnType<typeof useStudioNavigation>

export function createStudioPanels(input: {
  state: StudioState
  extensionCardContext: ReturnType<typeof useExtensionCardContext>
  uiState: StudioUiState
  navigation: StudioNavigation
  rendererHost: ClientRendererHost
  clientExtensions: ReturnType<typeof useClientExtensionRuntime>
  themeController: ThemeController
  clientLogs: MemoryLogSink
  resourcePanels: Record<'preset' | 'resource', (active: boolean, surface?: 'tool') => ReactNode>
  assetWorkspaceId: string
  cardsBusy: boolean
  providerBusy: boolean
  agentPresetBusy: boolean
  activePresetId: string | undefined
  narrativeCharacterName?: string
  sourceCardId?: string
  sessionBusy: boolean
  openStateSource: (scope: 'global' | 'timeline') => void
  openAgentSession: (sessionId: string) => Promise<void>
  onTextTransformsChanged: () => void
  uiScale: number
  setUiScale: (scale: number) => void
  userBackgrounds: UserBackgroundLibrary
  backgrounds: readonly RegisteredClientBackground[]
}): Record<StudioPanelId, (active: boolean, surface?: 'tool') => ReactNode> {
  const { state, uiState, navigation, rendererHost, clientExtensions, clientLogs, resourcePanels, cardsBusy, providerBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, uiScale, setUiScale, backgrounds } = input
  // Shared panels follow the playing Timeline; gallery browsing stays in its own route.
  const currentCardId = state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId
  const currentCard = input.extensionCardContext?.card
    ?? (state.selectedCardDetails?.id === currentCardId ? state.selectedCardDetails : undefined)
  const currentCardName = currentCard?.name ?? state.cards.find(card => card.id === currentCardId)?.name
  const renderHistory = (view: 'timelines' | 'sessions') => (
    <LazySessionsPanel
      view={view}
      activeBranch={state.branch}
      activeTimeline={state.narrativeTimeline}
      agentChatSession={state.agentChatSession}
      allAgentSessions={state.allAgentSessions}
      agentPresets={state.agentPresets}
      api={state.api}
      branches={state.branches}
      cards={state.cards}
      narrativeAgentSession={state.narrativeAgentSession}
      onCreateAgentSession={presetId => state.createAgentSession(presetId, false)}
      selectedCardId={currentCardId}
      requestedSessionId={navigation.toolSearchParams.get('sessionId') ?? undefined}
      requestedSessionView={navigation.toolSearchParams.get('sessionView') === 'summary' ? 'summary' : 'transcript'}
      onSessionUpdated={state.refreshTaskSession}
      selectedCardName={currentCardName}
      t={state.t}
      timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
      onDeleteAgentSession={state.deleteAgentSession}
      onDeleteTimeline={async timelineId => {
        const timeline = state.narrativeTimeline?.id === timelineId
          ? state.narrativeTimeline : state.allTimelines.find(item => item.id === timelineId)
        const deleted = await state.deleteTimeline(timelineId)
        if (deleted && navigation.isCurrent()) navigation.clearDeletedTimeline(timelineId, timeline?.createdFrom?.cardId)
        return deleted
      }}
      onOpenAgentSessionInSidebar={session => {
        void input.openAgentSession(session.id)
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
        if (navigation.isCurrent()) {
          await navigation.openUri(formatEntityReference({ kind: 'entity', type: 'timeline', id: timelineId }))
        }
      }}
    />
  )
  const panels: Record<StudioPanelId, (active: boolean, surface?: 'tool') => ReactNode> = {
    memory: active => active ? <LazyMemoryPanel endpoint={state.endpoint} api={state.api}
      rendererHost={rendererHost} onOpenStoryExtensions={() => { void navigation.openStoryExtensions() }}
      timelineId={navigation.searchParams.get('memoryTimeline') ?? undefined}
      defaultTimelineId={state.narrativeTimeline?.id}
      branchId={navigation.searchParams.get('memoryBranch') ?? undefined}
      view={navigation.searchParams.get('memoryView') === 'workspace' ? 'workspace' : 'plot'}
      onNavigate={target => { void navigation.openMemory(target) }} /> : null,
    model: () => (
      <LazyModelPanel
        selectedProviderId={navigation.toolSearchParams.get('providerProfileId') ?? undefined}
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
        onUpdateTokenMultiplier={(id, multiplier) => state.updateModelProfile(id, { tokenMultiplier: multiplier })}
      />
    ),
    agent: resourcePanels.preset,
    user: active => <LazyMyProfilePanel api={state.api.userProfiles} endpoint={state.endpoint} t={state.t} active={active} resources={<LazyUserResourcesPanel
      backgroundLibrary={input.userBackgrounds}
      onOpenBackground={id => { void navigation.openPath(`/studio/settings?category=appearance&backgroundId=${encodeURIComponent(`user-background/${id}`)}`) }}
      api={state.textTransformsApi}
      endpoint={state.endpoint}
      resources={state.promptResourceDrafts}
      invalidResources={state.invalidPromptResources}
      onRefresh={state.retryPromptResources}
      t={state.t}
      onOpenResource={(resource, nodeId) => {
        void navigation.openResource(resource.resourceKind === 'preset' ? 'agent' : 'resource', resource.id, nodeId)
      }}
      onOpenRule={ruleId => {
        void navigation.openPath(`/studio/text-transforms?ruleId=${encodeURIComponent(ruleId)}`)
      }}
    />} />,
    play: active => panels.character(active),
    recent: () => (
      <LazyHistoryPanel
        tab={navigation.toolSearchParams.get('historyTab') === 'sessions' ? 'sessions'
          : navigation.toolSearchParams.get('historyTab') === 'timelines' ? 'timelines' : 'recent'}
        onTabChange={tab => {
          const params = new URLSearchParams(navigation.toolSearchParams)
          params.set('historyTab', tab)
          params.delete('sessionId')
          params.delete('sessionView')
          void navigation.setToolSearchParams(params)
        }}
        t={state.t}
        history={renderHistory}
        recent={(
          <LazyRecentPlayPanel
            activeTimelineId={state.narrativeTimeline?.id}
            activeSessionId={state.agentChatSession?.id}
            primarySessionId={state.narrativeAgentSession?.id}
            t={state.t}
            cards={state.cards}
            timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
            agentSessions={state.allAgentSessions}
            agentPresets={state.agentPresets}
            onOpenCard={card => {
              if (card.validationError !== undefined) {
                void navigation.openPanel('character', { cardId: card.id })
                return
              }
              void state.selectCardTimeline(card.id).then(activated => {
                if (!navigation.isCurrent()) return
                if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
                else if (activated === null) {
                  void navigation.openCardPreview(card.id)
                }
              })
            }}
            onOpenTimeline={timeline => {
              void state.activateTimeline(timeline.id).then(branchId => {
                if (branchId) navigation.openNarrative(timeline.id, branchId)
              })
            }}
            onOpenAgentSession={session => {
              void input.openAgentSession(session.id)
            }}
          />
        )}
      />
    ),
    sessions: () => renderHistory('timelines'),
    character: active => (
      <LazyCharacterPanel
        active={active}
        busy={cardsBusy || sessionBusy}
        cards={state.cards}
        selectedCard={state.selectedCardDetails ?? state.selectedCard}
        selectedCardId={state.selectedCardId}
        timeline={state.narrativeTimeline}
        macroContext={state.macroContext}
        t={state.t}
        onCreateCard={state.createCard}
        onCreateTimelineFromCard={async (cardId, choice, cardVersion) => {
          const activated = await state.createTimelineFromCard(cardId, choice, cardVersion)
          if (activated && navigation.isCurrent()) {
            state.setSelectedCardId(cardId)
            navigation.openNarrative(activated.timelineId, activated.branchId)
          }
          return Boolean(activated)
        }}
        onDeleteCards={state.deleteCards}
        onPreviewCard={cardId => {
          state.resetToDraftTimeline()
          state.setSelectedCardId(cardId)
          void navigation.openCardPreview(cardId)
        }}
        onPreviewCardDeletion={state.previewCardDeletion}
        onExportCard={state.exportCard}
        onForkCard={state.forkCard}
        directoryApi={state.directoryApi}
        resourceApi={state.api}
        endpoint={state.endpoint}
        onChangeResourceNode={state.previewContextAsset}
        onCommitResourceNode={(id, partial) => { void state.updateContextAsset(id, partial).catch(() => undefined) }}
        onOpenLore={(resource, nodeId) => { void navigation.openResource('resource', resource.id, nodeId) }}
        resourceDirectoryOpen={navigation.searchParams.get('characterView') === 'attachments'}
        resourceDirectorySelectedId={navigation.searchParams.get('cardResourceNode') ?? undefined}
        resourceDirectoryExpandedIds={navigation.searchParams.getAll('cardResourceExpanded')}
        onResourceDirectoryOpenChange={open => {
          const params = new URLSearchParams(navigation.searchParams)
          if (open) params.set('characterView', 'attachments')
          else params.delete('characterView')
          void navigation.setSearchParams(params)
        }}
        onResourceDirectoryStateChange={(selectedId, expandedIds) => {
          const params = new URLSearchParams(navigation.searchParams)
          if (selectedId) params.set('cardResourceNode', selectedId)
          else params.delete('cardResourceNode')
          params.delete('cardResourceExpanded')
          for (const id of expandedIds) params.append('cardResourceExpanded', id)
          void navigation.setSearchParams(params)
        }}
        onRefreshCards={state.refreshCards}
        onImportCards={state.importCards}
        onSelectCard={cardId => {
          if (navigation.route.panel === 'play') {
            const params = new URLSearchParams(navigation.searchParams)
            params.set('characterCard', cardId)
            void navigation.setSearchParams(params)
          } else {
            void navigation.openPanel('character', { cardId })
          }
        }}
        onOpenTimeline={(timeline, cardId) => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId && navigation.isCurrent()) {
              state.setSelectedCardId(cardId)
              navigation.openNarrative(timeline.id, branchId)
            }
          })
        }}
        resources={state.promptResourceDrafts}
        onUpdateCardMedia={state.updateCardMedia}
        onUpdateCardProfile={state.updateCardProfile}
        routeCardId={navigation.route.panel === 'play'
          ? navigation.searchParams.get('characterCard') ?? undefined
          : navigation.route.panel === 'character' ? navigation.route.cardId : undefined}
      />
    ),
    preset: () => null,
    resource: resourcePanels.resource,
    state: () => <LazyStudioStatePanel
      hasTimeline={Boolean(state.narrativeTimeline)}
      variableView={uiState.variableView}
      card={currentCard}
      statesApi={state.statesApi}
      refreshToken={`${state.lastRun?.runId ?? ''}:${state.branch?.stateHeadRevisionId ?? ''}`}
      sourceRefreshToken={`${clientExtensions.configRevision}:${clientExtensions.refreshSequence}`}
      timelineTarget={state.narrativeTimeline && state.branch?.timelineId === state.narrativeTimeline.id
        ? { scope: 'timeline', timelineId: state.narrativeTimeline.id, branchId: state.branch.id } : undefined}
      t={state.t}
      onSaveCard={state.updateCardStateConfig}
      onOpenSource={openStateSource}
      onViewChange={uiState.setVariableView}
      onStateMutated={state.refreshStates}
    />,
    macro: () => {
      const sources: import('../features/state-variables/ui/macro-authoring-panel.js').MacroAuthoringSource[] = []
      
      if (currentCard) {
        const card = currentCard
        sources.push({
          id: card.id,
          kind: 'card',
          label: card.name,
          version: card.version,
          macros: card.macros ?? {},
          macroOptions: card.macroOptions,
          onSave: async input => {
            const updated = await state.updateCardMacros({
              cardId: card.id,
              expectedVersion: input.expectedVersion,
              macros: input.macros,
              macroOptions: input.macroOptions,
            })
            return { version: updated.version, macros: input.macros, macroOptions: input.macroOptions }
          }
        })
      }
      
      const boundIds = new Set(currentCard?.promptResourceIds ?? [])
      if (activePresetId) boundIds.add(activePresetId)
      
      const globalMountIds = new Set(state.loreMounts.filter(m => m.source.id === 'global').map(m => m.loreResourceId))

      for (const resource of state.promptResources) {
        if (boundIds.has(resource.id) || globalMountIds.has(resource.id)) {
          sources.push({
            id: resource.id,
            kind: resource.resourceKind === 'preset' ? 'preset' : 'workspace',
            label: resource.rootNode.label,
            version: resource.version,
            readonly: resource.origin?.kind === 'extension-package' || resource.origin?.kind === 'builtin',
            macros: resource.macros ?? {},
            macroOptions: resource.macroOptions,
            onSave: async input => {
              const updated = await state.updatePresetMacros(resource.id, input)
              return { version: updated.version, macros: input.macros, macroOptions: input.macroOptions }
            }
          })
        }
      }

      return <LazyMacroPanel
        macroTargetKey={state.macroTargetKey}
        macroInspection={state.macroInspection}
        macroInspectionLoading={state.macroInspectionLoading}
        macroInspectionError={state.macroInspectionError}
        macroSelections={state.macroSelections}
        sources={sources}
        t={state.t}
        onSelectSource={state.selectMacroSource}
        onRefresh={state.refreshMacros}
      />
    },
    'text-transform': () => (
      <LazyTextTransformPanel
        initialRuleId={navigation.searchParams.get('ruleId') ?? undefined}
        initialExtractorId={navigation.searchParams.get('extractorId') ?? undefined}
        temporaryTarget={navigation.searchParams.get('temporary') === '1'}
        api={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onRuntimeChanged={input.onTextTransformsChanged}
        rendererHost={rendererHost}
        runtimeScriptContext={{
          workspaceId: 'workspace',
          ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
          ...(activePresetId ? { presetId: activePresetId } : {}),
        }}
        t={state.t}
        cardId={currentCardId}
        getOwnerName={owner => {
          if (owner.kind === 'card') return state.cards.find(c => c.id === owner.cardId)?.name
          if (owner.kind === 'preset') return state.promptResources.find(p => p.id === owner.presetId)?.rootNode.label
          if (owner.kind === 'extension') return owner.packageId
          return undefined
        }}
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
    inspector: active => active ? (
      <LazyInspectorPanel
        agentTranscript={state.agentMessages}
        cardSnapshot={currentCard ?? null}
        promptBuildSteps={state.promptBuildSteps}
        promptBuildTrace={state.promptBuildTrace ?? null}
        promptMessages={state.promptMessages ?? null}
        providerPayloadPreview={state.providerPayloadPreview ?? null}
        tokenEstimate={state.tokenEstimate}
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
    ) : null,
    logs: active => <LazyLogViewer endpoint={state.endpoint} observationApi={state.api} active={active} api={state.logsApi} clientLogs={clientLogs} extensions={clientExtensions.packages} t={state.t}
      searchParams={navigation.searchParams} onSearchParamsChange={params => { void navigation.setSearchParams(params) }} />,
    extensions: (active, surface) => (
      <LazyRendererWorkspacePanel
        key={state.endpoint}
        mode={surface === 'tool' ? 'management' : 'workspace'}
        onOpenWorkspace={() => { void navigation.openExtensionWorkspace() }}
        onCloseWorkspace={() => { void navigation.closeExtensionWorkspace() }}
        searchParams={navigation.toolSearchParams}
        onNavigate={path => { void navigation.openPath(path) }}
        configRevision={clientExtensions.configRevision}
        runtimeError={clientExtensions.error?.message ?? input.extensionCardContext.error}
        extensionRuntime={state.api.extensionRuntime}
        extensionApi={state.api.extensions}
        scriptApi={state.api.loomScripts}
        getScriptOwnerName={owner => {
          if (owner.kind === 'card') return state.cards.find(card => card.id === owner.cardId)?.name
          if (owner.kind === 'preset') return state.promptResources.find(resource => resource.id === owner.presetId)?.rootNode.label
          if (owner.kind === 'extension') return [...clientExtensions.packages, ...clientExtensions.cardPackages].find(pkg => pkg.packageId === owner.packageId)?.displayName
          return undefined
        }}
        onScriptsChanged={uiState.bumpLoomScriptRefreshToken}
        scriptsRefreshToken={uiState.loomScriptRefreshToken}
        onRefreshExtensions={async () => {
          await Promise.all([clientExtensions.refresh(), state.refreshResourceConsumers()])
        }}
        extensionHost={clientExtensions.host}
        host={rendererHost}
        packages={clientExtensions.packages}
        cardPackages={clientExtensions.cardPackages}
        serverDiagnostics={clientExtensions.serverDiagnostics}
        sessionHost={clientExtensions.sessionHost}
        settingScopeContext={{
          ...(input.extensionCardContext.card?.id ? { cardId: input.extensionCardContext.card.id } : {}),
          ...(state.narrativeTimeline?.id ? { timelineId: state.narrativeTimeline.id } : {}),
          ...(state.agentChatSession?.id ? { agentSessionId: state.agentChatSession.id } : {}),
        }}
        t={state.t}
        onDisable={clientExtensions.disable}
        onEnable={clientExtensions.enable}
        onImportResources={state.importExtensionPackageResources}
        onAttachPackage={state.attachCardExtensionPackage}
        embeddedPackageCard={input.extensionCardContext.card}
        onDetachPackage={state.detachCardExtensionPackage}
        onInstallCardPackage={state.installCardPackage}
        onUpdateCardPackage={state.updateCardPackage}
        onUninstallCardPackage={state.uninstallCardPackage}
        onRemoveCardResources={state.removeCardPackageResources}
        installations={state.extensionInstallations}
        timelineParticipation={{
          api: state.api.timelineExtensions,
          packages: [...clientExtensions.packages, ...clientExtensions.cardPackages],
          timeline: state.narrativeTimeline && state.branch ? {
            id: state.narrativeTimeline.id, branchId: state.branch.id,
            title: state.narrativeTimeline.title, cardId: state.narrativeTimeline.createdFrom?.cardId,
          } : undefined,
          refreshToken: clientExtensions.configRevision,
          onChanged: async () => { await Promise.all([state.refreshStates(), state.refreshResourceConsumers()]) },
        }}
        promptResources={state.promptResources}
        onOpenPromptResource={resource => {
          void navigation.openResource(resource.resourceKind === 'preset' ? 'agent' : 'resource', resource.id, resource.rootNode.id)
        }}
        onUpdateResources={state.updateExtensionPackageResources}
        onRemoveResources={state.removeExtensionPackageResources}
        onReload={clientExtensions.reload}
        onUninstall={clientExtensions.uninstall}
      />
    ),
    settings: () => (
      <LazySettingsPanel
        backgroundLibrary={input.userBackgrounds}
        requestedCategory={navigation.toolSearchParams.get('category') === 'appearance' ? 'appearance' : undefined}
        previewBackgroundId={navigation.toolSearchParams.get('backgroundId') ?? undefined}
        themeController={input.themeController}
        busy={!state.startup.ready('network') || state.operationPending.settings.pendingCount > 0}
        customCss={state.customCss}
        locale={state.locale}
        networkSettings={state.networkSettings}
        backgroundCardId={state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId}
        backgrounds={[...input.userBackgrounds.backgrounds.map(item => ({
          id: item.key, personalId: item.id, name: item.name, description: '', image: item.image, source: state.t('appearance.myBackgrounds'),
          group: { id: 'personal', label: state.t('appearance.myBackgrounds') },
        })), ...backgrounds.map(item => {
          const cardId = item.target?.kind === 'card' ? item.target.cardId : undefined
          const packageName = clientExtensions.packages.find(pkg => pkg.packageId === item.packageId)?.displayName ?? item.packageId
          const cardName = cardId ? state.cards.find(card => card.id === cardId)?.name
            ?? (currentCard?.id === cardId ? currentCard.name : cardId) : undefined
          return {
            id: item.key, name: item.name, description: item.description, image: item.image, source: item.source ?? item.packageId,
            group: cardId ? { id: `card/${cardId}`, label: state.t('appearance.cardBackgroundGroup', { name: cardName! }) }
              : { id: `extension/${item.packageId}`, label: state.t('appearance.extensionBackgroundGroup', { name: packageName }) },
            ...(item.target?.kind === 'card' ? { scope: { cardId: item.target.cardId, ownerKey: clientModuleKey(item.packageId, item.moduleId!, item.target) } } : {}),
          }
        })]}
        uiScale={uiScale}
        t={state.t}
        onChangeCustomCss={state.setCustomCss}
        onChangeLocale={state.setLocale}
        onChangeUiScale={setUiScale}
        onUpdateNetworkSettings={state.updateNetworkSettings}
      />
    ),
  }
  for (const id of Object.keys(panels) as StudioPanelId[]) {
    const render = panels[id]
    panels[id] = (active, surface) => <ContentErrorBoundary resetKey={active} fallback={error => <div role="alert">
      <p>{state.t('appError.title')}</p><p>{error.message}</p>
    </div>}><PanelContent render={render} active={active} surface={surface} /></ContentErrorBoundary>
  }
  return panels
}

function PanelContent(props: { render(active: boolean, surface?: 'tool'): ReactNode; active: boolean; surface?: 'tool' }) {
  return props.render(props.active, props.surface)
}
