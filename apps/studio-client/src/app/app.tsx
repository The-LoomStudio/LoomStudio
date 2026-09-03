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
import { StateVariablesPanel } from '../features/state-variables/ui/state-variables-panel.js'
import { TextTransformPanel } from '../features/text-transforms/ui/text-transform-panel.js'
import { createClientRendererHost } from '../features/extension-renderers/model/client-renderer-host.js'
import { RendererFocusSurface } from '../features/extension-renderers/ui/renderer-focus-surface.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { RendererWorkspacePanel } from '../features/extension-renderers/ui/renderer-workspace-panel.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { listClientActions } from '../features/extension-renderers/model/client-actions.js'
import { ClientActionIcon } from '../features/extension-renderers/ui/client-action-icon.js'

import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import { toast } from 'sonner'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore, useStudioPanelStore, type StudioPanelId } from '../pages/studio/model/studio-layout-store.js'
import { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const state = useStudioState(props.transportLogger)
  const rendererHost = useMemo(() => createClientRendererHost(), [])
  const clientExtensions = useClientExtensionRuntime({ api: state.clientExtensionApi, rendererHost })
  const [composerHeight, setComposerHeight] = useState(0)
  const [agentExpanded, setAgentExpanded] = useState(false)
  const [agentExpansionHeight, setAgentExpansionHeight] = useState(320)
  const timelineRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation()
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
  const narrativeCharacterName = state.selectedCard?.name
  const sessionBusy = state.operationPending.session.pendingCount > 0
  const agentChatBusy = state.operationPending['agent-chat'].pendingCount > 0 || sessionBusy
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
    onDeleteResource: state.deletePromptResource,
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
    sessions: () => (
      <SessionsPanel
        activeBranch={state.branch}
        activeTimeline={state.narrativeTimeline}
        agentChatSession={state.agentChatSession}
        agentProfiles={state.agentProfiles}
        branches={state.branches}
        narrativeAgentSession={state.narrativeAgentSession}
        selectedCardName={state.selectedCardDetails?.name ?? state.selectedCard?.name}
        t={state.t}
        timelines={state.cardTimelines}
        onOpenTimeline={timeline => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId) navigation.openNarrative(timeline.id, branchId)
          })
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
        t={state.t}
        onChangeCardDraft={state.setCardDraft}
        onCreateCard={state.createCard}
        onCreateTimelineFromCard={async () => {
          state.resetToDraftTimeline()
          navigation.openNarrative(undefined, undefined)
        }}
        onDeleteCards={state.deleteCards}
        onPreviewCardDeletion={state.previewCardDeletion}
        onExportCard={state.exportCard}
        onImportCards={state.importCards}
        onSelectCard={cardId => {
          state.setSelectedCardId(cardId)
          void state.refreshCardTimelines(cardId).then(timelines => {
            const latest = [...timelines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
            if (latest) {
              void state.activateTimeline(latest.id).then(branchId => {
                if (branchId) navigation.openNarrative(latest.id, branchId)
              })
            } else {
              state.resetToDraftTimeline()
              navigation.openNarrative(undefined, undefined)
            }
          })
        }}
        onOpenTimeline={timeline => {
          void state.activateTimeline(timeline.id).then(branchId => {
            if (branchId) navigation.openNarrative(timeline.id, branchId)
          })
        }}
        onOpenStatePanel={() => useStudioPanelStore.getState().setActivePanel('state')}
        onUpdateCardMedia={state.updateCardMedia}
        onUpdateCard={state.updateCard}
        routeCardId={navigation.route.panel === 'character' ? navigation.route.cardId : undefined}
      />
    ),
    preset: () => (
      <PresetWorkbench
        {...contextAssetEditorProps}
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
        card={state.selectedCardDetails}
        settingMounts={state.settingMounts}
        onReplaceSettingMounts={state.replaceSettingMounts}
        onReplaceCardResources={state.replaceCardPromptResources}
        routeAssetId={navigation.route.panel === 'resource' ? navigation.route.assetId : undefined}
        initialSearchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
      />
    ),
    state: () => (
      <StateVariablesPanel
        api={state.statesApi}
        card={state.selectedCardDetails}
        refreshToken={state.lastRun?.runId}
        timelineTarget={state.narrativeTimeline && state.branch ? {
          scope: 'timeline', timelineId: state.narrativeTimeline.id, branchId: state.branch.id,
        } : undefined}
        onUpdateCardConfig={state.updateCardStateConfig}
      />
    ),
    'text-transform': () => (
      <TextTransformPanel
        api={state.textTransformsApi}
        source={state.narrativeTimeline && state.branch
          ? { kind: 'narrative', timelineId: state.narrativeTimeline.id, branchId: state.branch.id }
          : state.agentChatSession
            ? { kind: 'agent-session', sessionId: state.agentChatSession.id }
            : undefined}
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
      canUndo={state.canUndoEdit}
      customCss={state.customCss}
      onRedo={() => {
        void state.redoEdit().then(focusHistoryAsset)
      }}
      onUndo={() => {
        void state.undoEdit().then(focusHistoryAsset)
      }}
      t={state.t}
      uiScale={uiScale}
      panelHeaders={{
        character: <CharacterPanelHeader t={state.t} />,
        preset: (
          <PresetWorkbenchHeader
            resources={state.promptResources}
            t={state.t}
            workspaceId={assetWorkspaceId}
          />
        ),
        resource: (
          <ContextWorkbenchHeader
            resources={state.promptResources}
            t={state.t}
            workspaceId={assetWorkspaceId}
          />
        ),
      }}
      panels={panels}
      canvas={(
        <div
          className={styles.canvasStack}
          data-agent-expanded={agentExpanded ? 'true' : 'false'}
          style={{
            '--loom-composer-height': composerHeight ? `${composerHeight}px` : undefined,
            '--loom-composer-mask-depth': composerHeight ? `${Math.ceil(composerHeight / 2)}px` : undefined,
            '--loom-agent-expansion-height': agentExpanded ? `${agentExpansionHeight}px` : undefined,
          } as CSSProperties}
        >
          <NarrativeTimeline
            anchorNodeId={navigation.nodeAnchorId}
            busy={sessionBusy}
            composerExpanded={agentExpanded}
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
          {narrativeCharacterName ? (
            <div className={styles.narrativeIdentity} data-loom-component="narrative-character-identity">
              <span aria-hidden="true" className={styles.narrativeIdentityAvatar}>
                {Array.from(narrativeCharacterName.trim())[0]}
              </span>
              <span className={styles.narrativeIdentityName}>{narrativeCharacterName}</span>
            </div>
          ) : null}
          <AgentComposer
            agentBusy={agentChatBusy}
            agentExpansionHeight={agentExpansionHeight}
            agentInput={state.agentChatInput}
            agentMessages={state.agentChatMessages}
            agentProfiles={state.agentProfiles}
            agentSession={state.agentChatSession}
            agentSessionTail={state.agentChatSession ? (
              <RendererSurfaceHost
                host={rendererHost}
                scope={{ kind: 'agent-session', key: state.agentChatSession.id }}
                surface="agent.session.tail"
              />
            ) : undefined}
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
            canPreviewPrompt={state.canPreviewPrompt}
            canSendAgent={state.canSendAgent}
            canSendNarrative={state.canSend}
            narrativeInput={state.input}
            narrativeTextareaDisabled={sessionBusy}
            providerAccounts={state.providerAccounts}
            quickActions={composerQuickActions}
            rendererHost={rendererHost}
            selectedAgentProfileId={state.selectedAgentProfileId}
            t={state.t}
            workspaceOpen={workspaceOpen}
            onChangeAgentInput={state.setAgentChatInput}
            onChangeNarrativeInput={value => {
              state.setInput(value)
            }}
            onHeightChange={setComposerHeight}
            onExpansionHeightChange={setAgentExpansionHeight}
            onExpandedChange={setAgentExpanded}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSelectAgentProfile={state.selectAgentProfile}
            onSubmitAgent={state.submitAgentTurn}
            onSubmitNarrative={async event => {
              const activated = await state.submitTurn(event)
              if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
            }}
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
