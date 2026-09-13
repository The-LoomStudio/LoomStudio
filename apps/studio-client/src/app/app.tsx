import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbenchHeader } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbenchHeader } from '../widgets/context-workbench/context-workbench.js'
import { AgentComposer } from '../widgets/agent-composer/agent-composer.js'
import { NarrativeTimeline } from '../widgets/narrative-timeline/narrative-timeline.js'
import { CharacterPanelHeader } from '../widgets/character-panel/character-panel.js'
import { RecentPlayRail } from '../widgets/play-panel/recent-play-rail.js'
import { createClientRendererHost } from '../features/extension-renderers/model/client-renderer-host.js'
import { RendererFocusSurface } from '../features/extension-renderers/ui/renderer-focus-surface.js'
import { RendererSurfaceHost } from '../features/extension-renderers/ui/renderer-surface-host.js'
import { useClientExtensionRuntime } from '../features/extension-renderers/model/use-client-extension-runtime.js'
import { listClientActions } from '../features/extension-renderers/model/client-actions.js'
import { ClientActionIcon } from '../features/extension-renderers/ui/client-action-icon.js'
import { createLoomScriptRendererRuntime, type LoomScriptInputProjection, type LoomScriptRendererContribution } from '../features/loom-scripts/runtime/index.js'
import type { ClientRendererScope } from '../features/extension-renderers/model/client-renderer-host.js'

import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import type { StudioApi } from '../shared/api/studio-api.js'
import { toast } from 'sonner'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore, useStudioPanelStore } from '../pages/studio/model/studio-layout-store.js'
import { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'
import { useStudioUiState } from './use-studio-ui-state.js'
import { useStudioDerivedState } from './use-studio-derived-state.js'
import { StudioResourcePanels } from './studio-resource-panels.js'
import { createStudioPanels } from './studio-panel-registry.js'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const state = useStudioState(props.transportLogger)
  const rendererHost = useMemo(() => createClientRendererHost(), [])
  const clientExtensions = useClientExtensionRuntime({ api: state.clientExtensionApi, rendererHost })
  const uiState = useStudioUiState()
  const timelineRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation()
  const uiScale = useStudioLayoutStore(current => current.uiScale)
  const setUiScale = useStudioLayoutStore(current => current.setUiScale)
  const derived = useStudioDerivedState(state, navigation.route)
  const { assetWorkspaceId, cardsBusy, providerBusy, agentProfileBusy, activePresetId,
    narrativeCharacterName, sourceCardId, canOpenTimelineSource, narrativeCharacterAvatarUrl,
    sessionBusy, agentChatBusy, mutationBusy } = derived
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
    uiState.setVariableView('authoring')
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
  }, [activePresetId, uiState.loomScriptRefreshToken, rendererHost, state.agentChatSession?.id, state.api, state.branch?.id, state.narrativeTimeline?.id, state.statesApi])

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
  const resourcePanels = StudioResourcePanels({ state, uiState, navigation, assetWorkspaceId })
  const panels = createStudioPanels({ state, uiState, navigation, rendererHost, clientExtensions, clientLogs: props.clientLogs, resourcePanels, assetWorkspaceId, cardsBusy, providerBusy, agentProfileBusy, activePresetId, sourceCardId, sessionBusy, openStateSource, uiScale, setUiScale })

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
      agentPanelOpen={uiState.agentPanelOpen}
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
      onToggleAgentPanel={() => uiState.setAgentPanelOpen(prev => !prev)}
      onUndo={() => {
        void state.undoEdit().then(focusHistoryAsset)
      }}
      panelHeaders={{
        character: <CharacterPanelHeader t={state.t} />,
        preset: (
          <PresetWorkbenchHeader
            resources={state.promptResources}
            selectedResourceId={uiState.selectedPresetId}
            onSelectResource={uiState.setSelectedPresetId}
            t={state.t}
            workspaceId={assetWorkspaceId}
          />
        ),
        resource: (
          <ContextWorkbenchHeader
            resources={state.promptResources}
            view={uiState.resourceView}
            t={state.t}
            workspaceId={assetWorkspaceId}
            onViewChange={uiState.setResourceView}
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
            '--loom-composer-height': uiState.composerHeight ? `${uiState.composerHeight}px` : undefined,
            '--loom-composer-mask-depth': uiState.composerHeight ? `${Math.ceil(uiState.composerHeight / 2)}px` : undefined,
          } as CSSProperties}
        >
          <NarrativeTimeline
            anchorNodeId={navigation.nodeAnchorId}
            busy={sessionBusy}
            composerHeight={uiState.composerHeight}
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
            agentPanelOpen={uiState.agentPanelOpen}
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
