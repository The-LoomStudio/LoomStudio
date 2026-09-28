import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbenchHeader } from '../widgets/preset-workbench/preset-workbench-header.js'
import { ContextWorkbenchHeader } from '../widgets/context-workbench/context-workbench-header.js'
import { AgentComposer } from '../widgets/agent-composer/agent-composer.js'
import { NarrativeTimeline } from '../widgets/narrative-timeline/narrative-timeline.js'
import { CharacterPanelHeader } from '../widgets/character-panel/character-panel-header.js'
import { RecentPlayRail } from '../widgets/play-panel/recent-play-rail.js'
import { createClientRendererHost } from '../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererFocusSurface } from '../features/extension-renderers/ui/renderer-focus-surface.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { listClientActions } from '../features/extension-renderers/model/client-actions.js'
import { ClientActionIcon } from '../features/extension-renderers/ui/client-action-icon.js'
import { createLoomScriptRendererRuntime, type LoomScriptInputProjection, type LoomScriptRendererContribution } from '../features/loom-scripts/runtime/index.js'
import type { ClientRendererScope } from '../shared/extension-renderer-runtime/client-renderer-host.js'

import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import { toast } from 'sonner'
import { createRendererNotifications } from '../shared/extension-renderer-runtime/renderer-notifications.js'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore } from '../shared/studio-shell/studio-layout-store.js'
import { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import { useStudioUiState } from './use-studio-ui-state.js'
import { useStudioDerivedState } from './use-studio-derived-state.js'
import { StudioResourcePanels } from './studio-resource-panels.js'
import { ResourceReferenceDialog } from '../features/resource-references/resource-reference-dialog.js'
import { createStudioPanels } from './studio-panel-registry.js'
import { preloadStudioPanel } from './studio-panel-modules.js'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useDisplayProjection, useOpeningDisplayProjection } from '../features/message-content/model/use-display-projection.js'
import styles from './app.module.scss'
import '../styles/global.css'
import { useAppearanceStore } from '../shared/studio-shell/appearance-store.js'
import { applyEffectiveMotion, initializeMotionPreference, useEffectiveMotion } from '../shared/hooks/use-motion-preference.js'

function initializeAppearancePreview() {
  const root = document.documentElement
  if (!root.dataset.loomMaterialPreview) {
    root.dataset.loomMaterialPreview = 'glass'
    root.style.setProperty('--loom-preview-blur', '18px')
    root.style.setProperty('--loom-preview-opacity', '62%')
  }
  if (!root.dataset.loomPreviewBackground) {
    root.dataset.loomPreviewBackground = 'harbor'
    root.style.setProperty('--loom-preview-wallpaper', 'url("/images/banner.png")')
  }
}

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger; extensionLogger: Logger }) {
  initializeAppearancePreview()
  initializeMotionPreference()
  const appearance = useAppearanceStore()
  const state = useStudioState(props.transportLogger)
  const appearanceCardId = state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId
  const appearanceBackground = appearance.scopedBackground && appearance.scopedBackground.cardId === appearanceCardId
    ? appearance.scopedBackground : appearance.background
  const effectiveMotion = useEffectiveMotion()
  useEffect(() => applyEffectiveMotion(effectiveMotion), [effectiveMotion])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.loomMaterialPreview = appearance.material.mode
    root.style.setProperty('--loom-preview-blur', `${appearance.material.blur}px`)
    root.style.setProperty('--loom-preview-opacity', `${appearance.material.opacity}%`)
    root.style.setProperty('--loom-canvas-width', `${appearance.canvasWidth || 720}px`)
    if (appearanceBackground) {
      root.dataset.loomPreviewBackground = appearanceBackground.id
      root.style.setProperty('--loom-preview-wallpaper', `url("${appearanceBackground.image}")`)
    } else {
      delete root.dataset.loomPreviewBackground
      root.style.removeProperty('--loom-preview-wallpaper')
    }
  }, [appearanceBackground, appearance.canvasWidth, appearance.material])
  const rendererHost = useMemo(() => createClientRendererHost(), [])
  const notifications = useMemo(() => createRendererNotifications((owner, input) => {
    toast[input.level ?? 'info'](input.message, { description: owner, duration: 4000 })
  }), [])
  const clientExtensions = useClientExtensionRuntime({ api: state.clientExtensionApi, rendererHost, logger: props.extensionLogger, clientLogs: props.clientLogs, notify: notifications.show })
  const uiState = useStudioUiState()
  const timelineRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation({ endpoint: state.endpoint, api: state.api })
  const [navigationFailure, setNavigationFailure] = useState<{ target: string; message: string }>()
  const narrativeTarget = JSON.stringify([state.endpoint, navigation.route.timelineId, navigation.route.branchId])
  const uiScale = useStudioLayoutStore(current => current.uiScale)
  const setUiScale = useStudioLayoutStore(current => current.setUiScale)
  const composerPinned = useStudioLayoutStore(current => current.composerPinned)
  const toggleComposerPinned = useStudioLayoutStore(current => current.toggleComposerPinned)
  const derived = useStudioDerivedState(state, navigation.route)
  const { assetWorkspaceId, cardsBusy, providerBusy, agentPresetBusy, activePresetId,
    narrativeCharacterName, sourceCardId, canOpenTimelineSource, narrativeCharacterAvatarUrl,
    sessionBusy, agentChatBusy, mutationBusy } = derived
  const contextWorkspaceId = JSON.stringify([state.endpoint, assetWorkspaceId])
  const openingDisplay = useOpeningDisplayProjection({
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    opening: !state.narrativeTimeline && state.selectedCardDetails?.id === state.selectedCardId
      && state.selectedCardId && state.openingDraft && !state.openingDraft.isPlaceholder
      ? { cardId: state.selectedCardId, presetId: activePresetId, text: state.openingDraft.content }
      : undefined,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const narrativeDisplay = useDisplayProjection({
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    source: state.narrativeTimeline && state.branch ? { kind: 'narrative', timelineId: state.narrativeTimeline.id, branchId: state.branch.id } : undefined,
    consumerAgentSessionId: state.agentChatSession?.id,
    entries: state.narrativeNodes.map(node => ({ id: node.id, text: node.body.raw })),
    revision: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const agentDisplay = useDisplayProjection({
    api: state.textTransformsApi,
    endpoint: state.endpoint,
    source: state.agentChatSession ? { kind: 'agent-session', sessionId: state.agentChatSession.id } : undefined,
    entries: state.agentChatMessages.flatMap(message => message.entry.kind === 'message' && typeof message.entry.content === 'string' && message.entry.state !== 'partial'
      ? [{ id: message.id, text: message.entry.content }] : []),
    revision: activePresetId,
    refreshToken: uiState.loomScriptRefreshToken,
  })
  const historyNavigationContext = useRef('')
  historyNavigationContext.current = JSON.stringify([state.endpoint, navigation.locationKey, assetWorkspaceId, state.selectedCardId])
  const narrativeNavigating = !state.bootstrapReady || navigation.targetPending
    || navigation.route.timelineId !== state.narrativeTimeline?.id
    || Boolean(navigation.route.branchId && navigation.route.branchId !== state.branch?.id)
  const composerCommandContext = {
    sourceSurface: 'composer.quick-actions' as const,
    workspaceId: 'workspace',
    ...(appearanceCardId ? { cardId: appearanceCardId } : {}),
    ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
    ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
  }
  const composerQuickActions = listClientActions({
    packages: [...clientExtensions.packages, ...clientExtensions.cardPackages],
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
        target: action.target,
        sourceSurface: 'composer.quick-actions',
      }).then(result => {
        if (result.status === 'failed') toast.error(result.message)
      })
    },
  }))
  const headerActions = listClientActions({
    packages: [...clientExtensions.packages, ...clientExtensions.cardPackages],
    surface: 'stage.header.actions',
    context: composerCommandContext,
  }).map(action => {
    const extensionPackage = clientExtensions.packages.find(item => item.packageId === action.packageId)
    const iconUrl = extensionIconUrl(extensionPackage)
    return (
      <button
        aria-label={action.command.title}
        className={`loom-stage-extension-action${action.packageId === 'official.the-world' ? ' loom-stage-the-world-action' : ''}`}
        key={action.key}
        title={action.command.title}
        type="button"
        onClick={() => {
          void clientExtensions.host.executeCommand({ packageId: action.packageId, moduleId: action.moduleId, commandId: action.command.id, target: action.target, sourceSurface: 'stage.header.actions' }).then(result => {
            if (result.status === 'failed') toast.error(result.message)
          })
        }}
      >
        {action.packageId === 'official.the-world'
          ? <span data-the-world-toggle="" aria-hidden="true" />
          : iconUrl ? <img src={iconUrl} alt="" aria-hidden="true" /> : <ClientActionIcon name={action.command.icon} />}
      </button>
    )
  })

  function focusHistoryAsset(target: Awaited<ReturnType<typeof state.undoEdit>>) {
    if (!target) return
    useStudioLayoutStore.getState().openAssetDetail(target.layoutId, assetWorkspaceId, target.assetId)
  }

  async function applyHistoryAction(action: typeof state.undoEdit) {
    const context = historyNavigationContext.current
    const layouts = useStudioLayoutStore.getState().assetLayouts
    const canNavigate = () => context === historyNavigationContext.current
      && layouts === useStudioLayoutStore.getState().assetLayouts
    const target = await action(canNavigate)
    if (canNavigate()) focusHistoryAsset(target)
  }

  function openStateSource(scope: 'global' | 'timeline') {
    if (scope !== 'timeline' || !canOpenTimelineSource) return
    uiState.setVariableView('authoring')
    navigation.openPanel('state')
  }

  useEffect(() => {
    if (!state.operationError) return
    toast.error(state.operationError.message, {
      id: `operation-error-${state.operationError.sequence}`,
    })
  }, [state.operationError])

  useEffect(() => {
    if (!state.promptResourceError) return
    toast.error(state.promptResourceError.message, { id: 'prompt-resource-query-error' })
  }, [state.promptResourceError])

  useEffect(() => {
    rendererHost.setScopeSnapshot({
      workspace: 'workspace',
      cardId: state.narrativeTimeline?.createdFrom?.cardId ?? state.selectedCardId,
      ...(state.narrativeTimeline ? { timelineId: state.narrativeTimeline.id } : {}),
      ...(state.agentChatSession ? { agentSessionId: state.agentChatSession.id } : {}),
    })
  }, [rendererHost, state.agentChatSession?.id, state.narrativeTimeline?.id, state.narrativeTimeline?.createdFrom?.cardId, state.selectedCardId])

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
      notify: notifications.show,
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
  }, [activePresetId, uiState.loomScriptRefreshToken, rendererHost, notifications, state.agentChatSession?.id, state.api, state.branch?.id, state.narrativeTimeline?.id, state.statesApi])

  useEffect(() => {
    if (!state.bootstrapReady) return
    if (navigation.route.cardId) {
      if (navigation.route.cardId !== state.selectedCardId) state.setSelectedCardId(navigation.route.cardId)
    }
  }, [navigation.route.cardId, state.bootstrapReady])

  useEffect(() => {
    if (navigation.route.panel === 'resource' && navigation.route.resourceId) uiState.setResourceView('settings')
  }, [navigation.route.panel, navigation.route.resourceId])

  useEffect(() => {
    if (!state.bootstrapReady || navigation.route.targetUri !== undefined) return
    setNavigationFailure(undefined)
    const requestId = ++timelineRouteRequestRef.current
    if (!navigation.route.timelineId) {
      if (state.narrativeTimeline) state.resetToDraftTimeline()
      return
    }
    if (navigation.route.timelineId === state.narrativeTimeline?.id && (!navigation.route.branchId || navigation.route.branchId === state.branch?.id)) return

    void state.activateTimeline(navigation.route.timelineId, navigation.route.branchId).then(branchId => {
      if (requestId !== timelineRouteRequestRef.current) return
      if (!branchId) setNavigationFailure({ target: narrativeTarget, message: state.t('navigation.targetUnavailable') })
      else if (branchId !== navigation.route.branchId) navigation.updateNarrativeContext(navigation.route.timelineId!, branchId)
    })
    return () => { timelineRouteRequestRef.current++ }
  }, [narrativeTarget, state.bootstrapReady, navigation.route.targetUri])
  const resourcePanels = StudioResourcePanels({ state, uiState, navigation, assetWorkspaceId })
  const panels = createStudioPanels({ state, uiState, navigation, rendererHost, clientExtensions, clientLogs: props.clientLogs, resourcePanels, assetWorkspaceId, cardsBusy, providerBusy, agentPresetBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, uiScale, setUiScale, backgrounds: clientExtensions.host.backgrounds() })

  const studio = (
    <StudioPage
      navigation={navigation}
      assetWorkspaceId={contextWorkspaceId}
      background={(
        <RendererSurfaceHost
          host={rendererHost}
          scope={{ kind: 'workspace', key: 'workspace' }}
          surface="shell.background"
        />
      )}
      headerActions={headerActions}
      modelConfigured={state.providerAccountsLoaded ? hasCompleteProviderAccount(state.providerAccounts) : undefined}
      busy={mutationBusy}
      canRedo={state.canRedoEdit}
      agentChatBusy={agentChatBusy}
      agentActiveRun={state.agentActiveRun}
      runRecovery={state.runRecovery}
      runRecoveryBusy={state.runRecoveryBusy}
      canRestoreRunInput={state.canRestoreRunInput}
      reconnectAgentRun={state.reconnectAgentRun}
      restoreRunInput={state.restoreRunInput}
      agentChatInput={state.agentChatInput}
      agentChatMessages={state.agentChatMessages}
      agentDisplay={agentDisplay}
      agentChatSession={state.agentChatSession}
      agentChatSessions={state.agentChatSessions}
      agentChatSessionReady={state.agentChatSessionReady}
      agentPanelOpen={uiState.agentPanelOpen}
      agentPresets={state.agentPresets}
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
        void applyHistoryAction(state.redoEdit)
      }}
      onSelectAgentPreset={state.selectAgentPreset}
      onSelectAgentSession={id => { void state.activateAgentSession(id) }}
      onNewAgentSession={state.newAgentSession}
      onRefreshAgentSessions={() => { void state.refreshAgentSessions() }}
      onSubmitAgentChat={state.submitAgentTurn}
      onCancelAgentRun={() => { void state.cancelAgentRun() }}
      onPauseAgentRun={() => { void state.pauseAgentRun() }}
      onResumeAgentRun={() => { void state.resumeAgentRun() }}
      onApproveAgentMutation={(allow, reason) => { void state.approveAgentMutation(allow, reason) }}
      onToggleAgentPanel={() => uiState.setAgentPanelOpen(prev => !prev)}
      onUndo={() => {
        void applyHistoryAction(state.undoEdit)
      }}
      panelHeaderMain={{
        character: <CharacterPanelHeader t={state.t} />,
        agent: (
          <PresetWorkbenchHeader
            resources={state.promptResources}
            selectedResourceId={navigation.route.panel === 'agent' ? navigation.route.resourceId ?? uiState.selectedPresetId : uiState.selectedPresetId}
            onSelectResource={resourceId => {
              uiState.setSelectedPresetId(resourceId)
              const resource = state.promptResources.find(item => item.id === resourceId)
              if (resource) void navigation.openResource('preset', resourceId, resource.rootNode.id)
            }}
            t={state.t}
            workspaceId={contextWorkspaceId}
          />
        ),
        resource: (
          <ContextWorkbenchHeader
            resources={state.promptResources}
            selectedResourceId={navigation.route.panel === 'resource' ? navigation.route.resourceId : undefined}
            view={uiState.resourceView}
            t={state.t}
            workspaceId={contextWorkspaceId}
            onViewChange={uiState.setResourceView}
            onSelectResource={resourceId => {
              const target = state.promptResources.find(r => r.id === resourceId)
              if (target) {
                void navigation.openResource('resource', target.id, target.rootNode.id)
                useStudioLayoutStore.getState().openAssetDetail('resources', contextWorkspaceId, target.rootNode.id)
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
      preloadPanel={preloadStudioPanel}
      providerAccounts={state.providerAccounts}
      rendererHost={rendererHost}
      selectedAgentPresetId={state.selectedAgentPresetId}
      t={state.t}
      uiScale={uiScale}
      canvas={(
        <div
          className={styles.canvasStack}
          style={{
            '--loom-composer-height': uiState.composerHeight ? `${uiState.composerHeight}px` : undefined,
            '--loom-composer-mask-depth': uiState.composerHeight ? `${Math.ceil(uiState.composerHeight / 2)}px` : undefined,
          } as CSSProperties}
        >
          <NarrativeTimeline
            displayProjection={narrativeDisplay}
            key={JSON.stringify([state.endpoint, state.narrativeTimeline?.id, state.branch?.id])}
            anchorNodeId={navigation.nodeAnchorId}
            busy={sessionBusy || narrativeNavigating}
            composerHeight={uiState.composerHeight}
            emptyTimelineText={state.emptyTimelineText}
            openingDraft={state.selectedCardDetails?.id === state.selectedCardId ? state.openingDraft : undefined}
            openingDisplay={openingDisplay}
            getNodeLink={navigation.getNodeLink}
            hasOlder={state.hasOlderNarrativeNodes}
            onEditNode={state.editNarrativeNode}
            onLoadOlder={state.loadOlderNodes}
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
            canRetryNarrativeInput={state.canRetryNarrativeInput && !narrativeNavigating}
            onRetryNarrativeInput={() => { void state.retryNarrativeInput() }}
            runRecovery={state.runRecovery}
            runRecoveryBusy={state.runRecoveryBusy}
            canRestoreRunInput={state.canRestoreRunInput}
            reconnectAgentRun={state.reconnectAgentRun}
            restoreRunInput={state.restoreRunInput}
            agentPanelOpen={uiState.agentPanelOpen}
            canPreviewPrompt={state.canPreviewPrompt}
            canSendNarrative={state.canSend && !narrativeNavigating}
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
            pinned={composerPinned}
            onTogglePinned={toggleComposerPinned}
            quickActions={composerQuickActions}
            t={state.t}
            onChangeNarrativeInput={value => {
              state.setInput(value)
            }}
            onHeightChange={uiState.setComposerHeight}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmitNarrative={async event => {
              const activated = await state.submitTurn(event)
              if (activated) navigation.openNarrative(activated.timelineId, activated.branchId)
            }}
            onToggleAgentPanel={() => uiState.setAgentPanelOpen(prev => !prev)}
          />
        </div>
      )}
    />
  )

  return (
    <>
      {navigation.targetError || navigationFailure?.target === narrativeTarget ? (
        <section role="alert">
          <p>{navigation.targetError ?? navigationFailure?.message}</p>
          <button type="button" onClick={() => {
            setNavigationFailure(undefined)
            void navigation.openNarrative()
          }}>{state.t('navigation.returnToWorkspace')}</button>
        </section>
      ) : studio}
      <ResourceReferenceDialog api={state.api} uri={navigation.referenceUri}
        onClose={() => { void navigation.closeReference() }}
        onNavigate={uri => { void navigation.openUri(uri) }}
        onOpenEditor={target => {
        if (target.panel === 'preset') uiState.setSelectedPresetId(target.resourceId)
        else uiState.setResourceView('settings')
        navigation.openResource(target.panel, target.resourceId, target.nodeId)
        useStudioLayoutStore.getState().openAssetDetail(target.panel === 'preset' ? 'preset' : 'resources', contextWorkspaceId, target.nodeId)
      }} />
      <RendererFocusSurface host={rendererHost} scope={{ kind: 'workspace', key: 'workspace' }} />
      <NotificationToaster label={state.t('notification.label')} />
    </>
  )
}

function extensionIconUrl(extensionPackage: { iconUrl?: string; modules: Array<{ runtimeKind: string; entryUrl?: string }> } | undefined): string | undefined {
  if (extensionPackage?.iconUrl) return extensionPackage.iconUrl
  const entryUrl = extensionPackage?.modules.find(module => module.runtimeKind === 'client')?.entryUrl
  if (!entryUrl) return undefined
  try { return new URL('../../icon.png', entryUrl).href } catch { return undefined }
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
