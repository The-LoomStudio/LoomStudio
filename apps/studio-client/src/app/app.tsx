import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbench, PresetWorkbenchHeader } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench, ContextWorkbenchHeader } from '../widgets/context-workbench/context-workbench.js'
import { AgentComposer } from '../widgets/agent-composer/agent-composer.js'
import { NarrativeTimeline } from '../widgets/narrative-timeline/narrative-timeline.js'
import { CharacterPanel, CharacterPanelHeader } from '../widgets/character-panel/character-panel.js'
import { ModelPanel } from '../widgets/model-panel/model-panel.js'
import { AgentPanel } from '../widgets/agent-panel/agent-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { LogViewer } from '../widgets/log-viewer/log-viewer.js'
import { SettingsPanel } from '../widgets/settings-panel/settings-panel.js'
import { SessionsPanel } from '../widgets/sessions-panel/sessions-panel.js'
import { PlayPanel } from '../widgets/play-panel/play-panel.js'
import { RecentPlayRail } from '../widgets/play-panel/recent-play-rail.js'
import { StateVariablesPanel } from '../features/state-variables/ui/state-variables-panel.js'
import { StateAuthoringPanel } from '../features/state-variables/ui/state-authoring-panel.js'
import { MacroInspectorPanel } from '../features/state-variables/ui/macro-inspector-panel.js'
import { TextTransformPanel } from '../features/text-transforms/ui/text-transform-panel.js'
import { createClientRendererHost } from '../features/extension-renderers/model/client-renderer-host.js'
import { RendererFocusSurface } from '../features/extension-renderers/ui/renderer-focus-surface.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { RendererWorkspacePanel } from '../features/extension-renderers/ui/renderer-workspace-panel.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { listClientActions } from '../features/extension-renderers/model/client-actions.js'
import { ClientActionIcon } from '../features/extension-renderers/ui/client-action-icon.js'
import { createLoomScriptRendererRuntime, type LoomScriptInputProjection, type LoomScriptRendererContribution } from '../features/loom-scripts/runtime/index.js'
import type { ClientRendererScope } from '../features/extension-renderers/model/client-renderer-host.js'

import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import { cardMediaUrl, useCardMediaRevision } from '../shared/lib/card-media.js'
import { toast } from 'sonner'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore, useStudioPanelStore, type StudioPanelId } from '../pages/studio/model/studio-layout-store.js'
import { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'
import { buildStudioPanelPath } from '../pages/studio/model/studio-route.js'
import { useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const mediaRevision = useCardMediaRevision()
  const state = useStudioState(props.transportLogger)
  const rendererHost = useMemo(() => createClientRendererHost(), [])
  const clientExtensions = useClientExtensionRuntime({ api: state.clientExtensionApi, rendererHost })
  const [loomScriptRefreshToken, setLoomScriptRefreshToken] = useState(0)
  const [composerHeight, setComposerHeight] = useState(0)
  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string>()
  const timelineRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation()
  const navigate = useNavigate()
  const [resourceView, setResourceView] = useState<'settings' | 'macros' | 'text'>('settings')
  const [variableView, setVariableView] = useState<'state' | 'authoring' | 'preview' | 'build'>('state')
  const uiScale = useStudioLayoutStore(current => current.uiScale)
  const setUiScale = useStudioLayoutStore(current => current.setUiScale)
  const workspaceOpen = useStudioPanelStore(current => current.activePanel !== null)
  const assetWorkspaceId = navigation.route.panel === 'preset' || navigation.route.panel === 'resource'
    ? navigation.route.cardId ?? state.selectedCardId ?? 'default'
    : state.selectedCardId ?? 'default'
  const bootstrapBusy = state.operationPending.bootstrap.pendingCount > 0
  const cardsBusy = bootstrapBusy || state.operationPending.cards.pendingCount > 0
  const providerBusy = bootstrapBusy || state.operationPending['provider-settings'].pendingCount > 0
  const agentProfileBusy = bootstrapBusy || state.operationPending['agent-profiles'].pendingCount > 0
  const activeCardId = state.narrativeTimeline?.createdFrom?.cardId ?? (state.narrativeTimeline ? state.selectedCardId : undefined)
  const activePresetId = state.agentProfiles.find(profile => profile.id === state.selectedAgentProfileId)?.presetId
  const activeCard = activeCardId
    ? (state.cards.find(c => c.id === activeCardId) ?? (state.selectedCard?.id === activeCardId ? state.selectedCard : undefined))
    : undefined
  const narrativeCharacterName = state.narrativeTimeline ? activeCard?.name : undefined
  const sourceCardId = state.narrativeTimeline?.createdFrom?.cardId
  const canOpenTimelineSource = Boolean(sourceCardId && state.cards.some(card => card.id === sourceCardId))
  const narrativeCharacterAvatarUrl = state.narrativeTimeline && activeCard?.media?.avatarAssetId
    ? cardMediaUrl(activeCard.id, 'avatar', activeCard.media.avatarAssetId, mediaRevision)
    : undefined
  const sessionBusy = state.operationPending.session.pendingCount > 0
  const agentChatBusy = state.operationPending['agent-chat'].pendingCount > 0 || sessionBusy || state.agentChatSessionLoading
  const mutationBusy = state.operationPending.mutation.pendingCount > 0
  const composerCommandContext = {
    sourceSurface: 'composer.quick-actions' as const,
    workspaceId: 'workspace',
    ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
    ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
  }
  const composerQuickActions = listClientActions({
    packages: clientExtensions.packages,
    surface: 'composer.quick-actions',
    context: composerCommandContext,
  }).map(action => ({
    id: action.key,
    label: action.command.title,
    ...(action.command.icon ? { icon: <ClientActionIcon name={action.command.icon} /> } : {}),
    onSelect: () => {
      void clientExtensions.host.executeCommand({
        packageId: action.packageId,
        moduleId: action.moduleId,
        commandId: action.command.id,
        sourceSurface: 'composer.quick-actions',
      }).then(result => {
        if (result.status === 'failed') toast.error(result.message)
      })
    },
  }))

  function focusHistoryAsset(target: Awaited<ReturnType<typeof state.undoEdit>>) {
    if (!target) return
    useStudioLayoutStore.getState().openAssetDetail(target.layoutId, assetWorkspaceId, target.assetId)
  }

  function openStateSource(scope: 'global' | 'timeline') {
    if (scope !== 'timeline' || !canOpenTimelineSource) return
    setVariableView('authoring')
    useStudioPanelStore.getState().setActivePanel('state')
  }

  useEffect(() => {
    if (!state.operationError) return
    toast.error(state.operationError.message, {
      id: `operation-error-${state.operationError.sequence}`,
    })
  }, [state.operationError])

  useEffect(() => {
    rendererHost.setScopeSnapshot({
      workspace: 'workspace',
      ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
      ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
    })
  }, [rendererHost, state.agentChatSession?.id, state.narrativeTimeline?.id])

  useEffect(() => {
    let disposed = false
    const runtime = createLoomScriptRendererRuntime({
      rendererHost,
      resolveInputs: (scope, contribution) => resolveLoomScriptInputs({
        api: state.api,
        scope,
        contribution,
        narrative: state.narrativeTimeline && state.branch ? {
          timelineId: state.narrativeTimeline.id,
          branchId: state.branch.id,
          consumerAgentSessionId: state.agentChatSession?.id,
        } : undefined,
        agentSessionId: state.agentChatSession?.id,
      }),
      stateRead: async target => (await state.statesApi.get(target)).snapshot.value,
    })
    void state.api.loomScripts.resolveRendererMounts({
      workspaceId: 'workspace',
      ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
      ...(activePresetId ? { presetId: activePresetId } : {}),
    }).then(result => {
      if (!disposed) runtime.reconcile(result.mounts)
    }).catch(error => {
      if (!disposed) toast.error(error instanceof Error ? error.message : String(error))
    })
    return () => {
      disposed = true
      runtime.dispose()
    }
  }, [activePresetId, loomScriptRefreshToken, rendererHost, state.agentChatSession?.id, state.api, state.branch?.id, state.narrativeTimeline?.id, state.statesApi])

  useEffect(() => {
    if (navigation.route.panel !== 'preset' && navigation.route.panel !== 'resource') return
    if (navigation.route.cardId) {
      if (navigation.route.cardId !== state.selectedCardId) state.setSelectedCardId(navigation.route.cardId)
    }
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId])

  useEffect(() => {
    const cardId = navigation.route.panel === 'character' ? navigation.route.cardId : undefined
    if (cardId && cardId !== state.selectedCardId) state.setSelectedCardId(cardId)
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId, state.setSelectedCardId])

  useEffect(() => {
    if (navigation.route.panel !== null || !navigation.route.timelineId) return
    if (navigation.route.timelineId === state.narrativeTimeline?.id && (!navigation.route.branchId || navigation.route.branchId === state.branch?.id)) return

    const requestId = ++timelineRouteRequestRef.current
    void state.activateTimeline(navigation.route.timelineId, navigation.route.branchId).then(branchId => {
      if (requestId !== timelineRouteRequestRef.current) return
      if (!branchId) navigation.openNarrative(undefined, undefined, true)
      else if (branchId !== navigation.route.branchId) navigation.openNarrative(navigation.route.timelineId, branchId, true)
    })
  }, [navigation.route.branchId, navigation.route.panel, navigation.route.timelineId, state.branch?.id, state.narrativeTimeline?.id])
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
      if (selectedPresetId === resourceId) {
        setSelectedPresetId(undefined)
      }
    },
    onImportResource: state.importPromptResource,
    onExportResource: state.exportPromptResource,
    t: state.t,
    workspaceId: assetWorkspaceId,
  }
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
          setAgentPanelOpen(true)
        }}
      />
    ) : null,
    sessions: () => (
      <SessionsPanel
        activeBranch={state.branch}
        activeTimeline={state.narrativeTimeline}
        agentChatSession={state.agentChatSession}
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
          setAgentPanelOpen(true)
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
          setVariableView('authoring')
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
    preset: () => (
      <PresetWorkbench
        {...contextAssetEditorProps}
        textTransformsApi={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onLoomScriptsChanged={() => setLoomScriptRefreshToken(value => value + 1)}
        onSaveMacros={state.updatePresetMacros}
        selectedResourceId={selectedPresetId}
        onSelectResource={setSelectedPresetId}
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
        onLoomScriptsChanged={() => setLoomScriptRefreshToken(value => value + 1)}
        view={resourceView}
        onViewChange={setResourceView}
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
    state: () => (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      {(variableView === 'state' || variableView === 'authoring') && !state.narrativeTimeline ? (
        <p>{state.t('stateVariables.noTimeline')}</p>
      ) : variableView === 'authoring' ? <StateAuthoringPanel
        key={sourceCardId ?? 'none'}
        card={state.narrativeTimeline && state.selectedCardDetails?.id === sourceCardId ? state.selectedCardDetails : undefined}
        t={state.t}
        onSaveCard={state.updateCardStateConfig}
      /> : variableView === 'state' ? <StateVariablesPanel
        api={state.statesApi}
        t={state.t}
        canOpenTimelineSource={canOpenTimelineSource}
        onOpenSource={openStateSource}
        refreshToken={state.lastRun?.runId}
        timelineTarget={state.narrativeTimeline && state.branch ? {
          scope: 'timeline', timelineId: state.narrativeTimeline.id, branchId: state.branch.id,
        } : undefined}
        onStateMutated={state.refreshStates}
      /> : <MacroInspectorPanel
        key={`${state.macroTargetKey}:${variableView}`}
        inspection={variableView === 'preview' ? state.macroInspection : state.buildMacroInspection}
        loading={variableView === 'preview' && state.macroInspectionLoading}
        error={variableView === 'preview' ? state.macroInspectionError : undefined}
        selections={variableView === 'preview' ? state.macroSelections : {}}
        onSelectSource={state.selectMacroSource}
        onRefresh={state.refreshMacros}
        readOnly={variableView === 'build'}
        t={state.t}
      />}
      </div>
      <div className="loom-page-tabs loom-page-tabs-footer" role="tablist">
        {(['state', 'authoring', 'preview', 'build'] as const).map(view => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={variableView === view}
            className={`loom-page-tab${variableView === view ? ' loom-page-tab-active' : ''}`}
            onClick={() => setVariableView(view)}
          >{view === 'state' ? 'State' : view === 'authoring' ? state.t('stateAuthoring.tab') : state.t(`macroInspector.${view}`)}</button>
        ))}
      </div>
      </div>
    ),
    'text-transform': () => (
      <TextTransformPanel
        api={state.textTransformsApi}
        loomScriptsApi={state.api.loomScripts}
        onRuntimeChanged={() => setLoomScriptRefreshToken(value => value + 1)}
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
    logs: active => <LogViewer active={active} api={state.logsApi} clientLogs={props.clientLogs} t={state.t} />,
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

  const studio = (
    <StudioPage
      assetWorkspaceId={assetWorkspaceId}
      background={(
        <RendererSurfaceHost
          host={rendererHost}
          scope={{ kind: 'workspace', key: 'workspace' }}
          surface="shell.background"
        />
      )}
      modelConfigured={state.providerAccountsLoaded ? hasCompleteProviderAccount(state.providerAccounts) : undefined}
      busy={mutationBusy}
      canRedo={state.canRedoEdit}
      agentChatBusy={agentChatBusy}
      agentChatInput={state.agentChatInput}
      agentChatMessages={state.agentChatMessages}
      agentChatSession={state.agentChatSession}
      agentChatSessions={state.agentChatSessions}
      agentChatSessionReady={state.agentChatSessionReady}
      agentPanelOpen={agentPanelOpen}
      agentProfiles={state.agentProfiles}
      agentSessionTail={state.agentChatSession ? (
        <RendererSurfaceHost
          host={rendererHost}
          scope={{ kind: 'agent-session', key: state.agentChatSession.id }}
          surface="agent.session.tail"
        />
      ) : undefined}
      canUndo={state.canUndoEdit}
      characterAvatarUrl={narrativeCharacterAvatarUrl}
      characterName={narrativeCharacterName}
      customCss={state.customCss}
      onChangeAgentChatInput={state.setAgentChatInput}
      onRedo={() => {
        void state.redoEdit().then(focusHistoryAsset)
      }}
      onSelectAgentProfile={state.selectAgentProfile}
      onSelectAgentSession={id => { void state.activateAgentSession(id) }}
      onNewAgentSession={state.newAgentSession}
      onRefreshAgentSessions={() => { void state.refreshAgentSessions() }}
      onSubmitAgentChat={state.submitAgentTurn}
      onToggleAgentPanel={() => setAgentPanelOpen(prev => !prev)}
      onUndo={() => {
        void state.undoEdit().then(focusHistoryAsset)
      }}
      panelHeaders={{
        character: <CharacterPanelHeader t={state.t} />,
        preset: (
          <PresetWorkbenchHeader
            resources={state.promptResources}
            selectedResourceId={selectedPresetId}
            onSelectResource={setSelectedPresetId}
            t={state.t}
            workspaceId={assetWorkspaceId}
          />
        ),
        resource: (
          <ContextWorkbenchHeader
            resources={state.promptResources}
            view={resourceView}
            t={state.t}
            workspaceId={assetWorkspaceId}
            onViewChange={setResourceView}
            onSelectResource={resourceId => {
              const target = state.promptResources.find(r => r.id === resourceId)
              if (target) {
                useStudioLayoutStore.getState().openAssetDetail('resources', assetWorkspaceId, target.rootNode.id)
              }
            }}
          />
        ),
      }}
      recentSessions={(
        <RecentPlayRail
          cards={state.cards}
          timelines={state.allTimelines.length > 0 ? state.allTimelines : state.cardTimelines}
          t={state.t}
          onOpenTimeline={timeline => {
            void state.activateTimeline(timeline.id).then(branchId => {
              if (branchId) navigation.openNarrative(timeline.id, branchId)
            })
          }}
        />
      )}
      panels={panels}
      providerAccounts={state.providerAccounts}
      rendererHost={rendererHost}
      selectedAgentProfileId={state.selectedAgentProfileId}
      t={state.t}
      uiScale={uiScale}
      canvas={(
        <div
          className={styles.canvasStack}
          style={{
            '--loom-composer-height': composerHeight ? `${composerHeight}px` : undefined,
            '--loom-composer-mask-depth': composerHeight ? `${Math.ceil(composerHeight / 2)}px` : undefined,
          } as CSSProperties}
        >
          <NarrativeTimeline
            anchorNodeId={navigation.nodeAnchorId}
            busy={sessionBusy}
            composerHeight={composerHeight}
            emptyTimelineText={state.emptyTimelineText}
            openingDraft={state.openingDraft}
            getNodeLink={navigation.getNodeLink}
            hasOlder={state.hasOlderNarrativeNodes}
            onEditNode={state.editNarrativeNode}
            onLoadOlder={() => void state.loadOlderNodes()}
            onNodeAnchorChange={navigation.setNodeAnchor}
            onForkNode={node => {
              void state.forkFromNode(node).then(activated => {
                if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
              })
            }}
            rendererHost={rendererHost}
            macroContext={state.macroContext}
            t={state.t}
            timeline={state.narrativeNodes}
            timelineId={state.narrativeTimeline?.id}
            tail={state.narrativeTimeline ? (
              <RendererSurfaceHost
                host={rendererHost}
                scope={{ kind: 'timeline', key: state.narrativeTimeline.id }}
                surface="narrative.timeline.tail"
              />
            ) : undefined}
          />
          <AgentComposer
            agentPanelOpen={agentPanelOpen}
            canPreviewPrompt={state.canPreviewPrompt}
            canSendNarrative={state.canSend}
            composerSheet={(
              <RendererSurfaceHost
                host={rendererHost}
                scope={state.narrativeTimeline
                  ? { kind: 'timeline', key: state.narrativeTimeline.id }
                  : state.agentChatSession
                    ? { kind: 'agent-session', key: state.agentChatSession.id }
                    : { kind: 'workspace', key: 'workspace' }}
                surface="composer.sheet"
              />
            )}
            narrativeInput={state.input}
            narrativeTextareaDisabled={sessionBusy}
            quickActions={composerQuickActions}
            t={state.t}
            onChangeNarrativeInput={value => {
              state.setInput(value)
            }}
            onHeightChange={setComposerHeight}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmitNarrative={async event => {
              const activated = await state.submitTurn(event)
              if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
            }}
            onToggleAgentPanel={() => setAgentPanelOpen(prev => !prev)}
          />
        </div>
      )}
    />
  )

  return (
    <>
      {studio}
      <RendererFocusSurface host={rendererHost} scope={{ kind: 'workspace', key: 'workspace' }} />
      <NotificationToaster label={state.t('notification.label')} />
    </>
  )
}

async function resolveLoomScriptInputs(input: {
  api: StudioApi
  scope: ClientRendererScope
  contribution: LoomScriptRendererContribution
  narrative?: { timelineId: string; branchId: string; consumerAgentSessionId?: string }
  agentSessionId?: string
}): Promise<LoomScriptInputProjection> {
  const source = resolveInspectionSource(input)
  if (!source) return { matches: [], artifacts: [] }
  const inspection = await input.api.textTransforms.inspectTextPipeline({
    source: source.source,
    phase: 'display',
    ...(source.consumerAgentSessionId ? { consumerAgentSessionId: source.consumerAgentSessionId } : {}),
  })
  const entryId = source.entryId
  return {
    matches: inspection.snapshot.matches
      .filter(match => !entryId || match.entryId === entryId)
      .map(match => ({
        matchId: match.matchId,
        ruleId: match.ruleId,
        value: {
          entryId: match.entryId,
          match: match.match,
          captures: match.captures.map(capture => capture ?? null),
          namedCaptures: Object.fromEntries(Object.entries(match.namedCaptures).map(([name, capture]) => [name, capture ?? null])),
        },
        ...(match.displayRange ? { displayRange: match.displayRange } : {}),
      })),
    artifacts: inspection.artifacts.flatMap(artifact => artifact.values
      .filter(value => !entryId || value.sourceEntryId === entryId)
      .map((value, index) => ({
        id: `${artifact.artifactId}:${index}`,
        artifactType: artifact.artifactType,
        sourceEntryId: value.sourceEntryId,
        value: value.value,
      }))),
  }
}

function resolveInspectionSource(input: {
  scope: ClientRendererScope
  narrative?: { timelineId: string; branchId: string; consumerAgentSessionId?: string }
  agentSessionId?: string
}): {
  source: { kind: 'narrative'; timelineId: string; branchId: string } | { kind: 'agent-session'; sessionId: string }
  entryId?: string
  consumerAgentSessionId?: string
} | undefined {
  if (input.scope.entity?.kind === 'narrative-node') {
    if (!input.narrative || input.narrative.timelineId !== input.scope.entity.timelineId) return undefined
    return {
      source: { kind: 'narrative', timelineId: input.narrative.timelineId, branchId: input.narrative.branchId },
      entryId: input.scope.entity.nodeId,
      ...(input.narrative.consumerAgentSessionId ? { consumerAgentSessionId: input.narrative.consumerAgentSessionId } : {}),
    }
  }
  if (input.scope.entity?.kind === 'agent-message') {
    if (input.agentSessionId !== input.scope.entity.agentSessionId) return undefined
    return { source: { kind: 'agent-session', sessionId: input.scope.entity.agentSessionId }, entryId: input.scope.entity.messageId }
  }
  if (input.scope.kind === 'timeline' && input.narrative?.timelineId === input.scope.key) {
    return {
      source: { kind: 'narrative', timelineId: input.narrative.timelineId, branchId: input.narrative.branchId },
      ...(input.narrative.consumerAgentSessionId ? { consumerAgentSessionId: input.narrative.consumerAgentSessionId } : {}),
    }
  }
  if (input.scope.kind === 'agent-session' && input.agentSessionId === input.scope.key) {
    return { source: { kind: 'agent-session', sessionId: input.agentSessionId } }
  }
  return undefined
}
