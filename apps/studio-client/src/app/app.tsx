import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbench } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/context-workbench.js'
import { AgentComposer } from '../widgets/agent-composer/agent-composer.js'
import { NarrativeTimeline } from '../widgets/narrative-timeline/narrative-timeline.js'
import { CharacterPanel, CharacterPanelHeader } from '../widgets/character-panel/character-panel.js'
import { ModelPanel } from '../widgets/model-panel/model-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { LogViewer } from '../widgets/log-viewer/log-viewer.js'
import { SettingsPanel } from '../widgets/settings-panel/settings-panel.js'
import { ContextMenuProvider } from '../shared/ui/context-menu/context-menu.js'
import { NotificationToaster } from '../shared/ui/notification-toaster/notification-toaster.js'
import { toast } from 'sonner'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import { useStudioLayoutStore, useStudioPanelStore, type StudioPanelId } from '../pages/studio/model/studio-layout-store.js'
import { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const state = useStudioState(props.transportLogger)
  const [composerHeight, setComposerHeight] = useState(0)
  const [agentExpanded, setAgentExpanded] = useState(false)
  const sessionRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation()
  const workspaceOpen = useStudioPanelStore(current => current.activePanel !== null)
  const uiScale = useStudioLayoutStore(current => current.uiScale)
  const setUiScale = useStudioLayoutStore(current => current.setUiScale)
  const assetWorkspaceId = navigation.route.panel === 'preset' || navigation.route.panel === 'resource'
    ? navigation.route.cardId ?? state.selectedCardId ?? 'default'
    : state.selectedCardId ?? 'default'
  const bootstrapBusy = state.operationPending.bootstrap.pendingCount > 0
  const cardsBusy = bootstrapBusy || state.operationPending.cards.pendingCount > 0
  const providerBusy = bootstrapBusy || state.operationPending['provider-settings'].pendingCount > 0
  const narrativeCharacterName = readNarrativeCharacterName(state.session?.cardSnapshot, state.selectedCard?.name)
  const sessionBusy = state.operationPending.session.pendingCount > 0
  const mutationBusy = state.operationPending.mutation.pendingCount > 0

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
    if (navigation.route.panel !== 'preset' && navigation.route.panel !== 'resource') return
    if (navigation.route.cardId) {
      if (navigation.route.cardId !== state.selectedCardId) state.setSelectedCardId(navigation.route.cardId)
    }
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId])

  useEffect(() => {
    const cardId = navigation.route.panel === 'character' ? navigation.route.cardId : undefined
    if (cardId && !(import.meta.env.DEV && cardId.startsWith('__gallery-mock-')) && cardId !== state.selectedCardId) state.setSelectedCardId(cardId)
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId, state.setSelectedCardId])

  useEffect(() => {
    if (navigation.route.panel !== null || !navigation.route.sessionId) return
    if (navigation.route.sessionId === state.session?.id && (!navigation.route.branchId || navigation.route.branchId === state.branch?.id)) return

    const requestId = ++sessionRouteRequestRef.current
    void state.activateSession(navigation.route.sessionId, navigation.route.branchId).then(branchId => {
      if (requestId !== sessionRouteRequestRef.current) return
      if (!branchId) navigation.openChat(undefined, undefined, true)
      else if (branchId !== navigation.route.branchId) navigation.openChat(navigation.route.sessionId, branchId, true)
    })
  }, [navigation.route.branchId, navigation.route.panel, navigation.route.sessionId, state.branch?.id, state.session?.id])
  const contextAssetEditorProps = {
    nodes: state.contextAssets,
    onChangeNode: state.previewContextAsset,
    onCommitNode: state.updateContextAsset,
    onChangeNodes: state.updateContextAssets,
    onMoveNode: state.moveContextAsset,
    onAddNode: state.addContextAsset,
    onDuplicateNode: state.duplicateContextAsset,
    onDeleteNode: state.deleteContextAsset,
    t: state.t,
    workspaceId: assetWorkspaceId,
  }
  const panels: Record<StudioPanelId, (active: boolean) => ReactNode> = {
    model: () => (
      <ModelPanel
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
      />
    ),
    character: active => (
      <CharacterPanel
        active={active}
        branch={state.branch}
        branches={state.branches}
        busy={cardsBusy || sessionBusy}
        cardDraft={state.cardDraft}
        cards={state.cards}
        selectedCard={state.selectedCard}
        selectedCardId={state.selectedCardId}
        session={state.session}
        t={state.t}
        onChangeCardDraft={state.setCardDraft}
        onCreateCard={state.createCard}
        onCreateSessionFromCard={async () => {
          const activated = await state.createSessionFromCard()
          if (activated) navigation.openChat(activated.sessionId, activated.branchId)
        }}
        onDeleteCards={state.deleteCards}
        onSelectCard={state.setSelectedCardId}
        onSwitchBranch={branch => {
          void state.switchBranch(branch).then(() => {
            if (state.session) navigation.openChat(state.session.id, branch.id)
          })
        }}
        onUpdateCard={state.updateCard}
        routeCardId={navigation.route.panel === 'character' ? navigation.route.cardId : undefined}
      />
    ),
    preset: () => (
      <PresetWorkbench
        {...contextAssetEditorProps}
        agentRuntimeProfiles={state.agentRuntimeProfiles}
        modelProfiles={state.modelProfiles}
        onCreateAgentRuntimeProfile={state.createAgentRuntimeProfile}
        onDeleteAgentRuntimeProfile={state.deleteAgentRuntimeProfile}
        onSelectAgentRuntimeProfile={id => state.setSelectedAgentRuntimeProfileId(id)}
        onUpdateAgentRuntimeProfile={state.updateAgentRuntimeProfile}
        routeAssetId={navigation.route.panel === 'preset' ? navigation.route.assetId : undefined}
        selectedAgentRuntimeProfileId={state.selectedAgentRuntimeProfileId}
        initialSearchQuery={navigation.route.panel === 'preset' ? navigation.searchQuery : ''}
      />
    ),
    resource: () => (
      <ContextWorkbench
        {...contextAssetEditorProps}
        routeAssetId={navigation.route.panel === 'resource' ? navigation.route.assetId : undefined}
        initialSearchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
      />
    ),
    inspector: () => (
      <InspectorPanel
        agentTranscript={state.agentTranscript}
        cardSnapshot={state.session?.cardSnapshot ?? state.selectedCard ?? null}
        promptBuildSteps={state.promptBuildSteps}
        promptBuildTrace={state.promptBuildTrace ?? null}
        promptMessages={state.promptMessages ?? null}
        providerPayloadPreview={state.providerPayloadPreview ?? null}
        runDetails={state.runDetails ?? null}
        t={state.t}
      />
    ),
    logs: active => <LogViewer active={active} api={state.logsApi} clientLogs={props.clientLogs} t={state.t} />,
    settings: () => <SettingsPanel customCss={state.customCss} locale={state.locale} uiScale={uiScale} t={state.t} onChangeCustomCss={state.setCustomCss} onChangeLocale={state.setLocale} onChangeUiScale={setUiScale} />,
  }

  const studio = (
    <StudioPage
      assetWorkspaceId={assetWorkspaceId}
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
      panelHeaders={{ character: <CharacterPanelHeader t={state.t} /> }}
      panels={panels}
      canvas={(
        <div
          className={styles.canvasStack}
          data-agent-expanded={agentExpanded ? 'true' : 'false'}
          style={{
            '--loom-composer-height': composerHeight ? `${composerHeight}px` : undefined,
            '--loom-composer-mask-depth': composerHeight ? `${Math.ceil(composerHeight / 2)}px` : undefined,
          } as CSSProperties}
        >
          <NarrativeTimeline
            anchorEntryId={navigation.entryAnchorId}
            busy={sessionBusy}
            composerExpanded={agentExpanded}
            composerHeight={composerHeight}
            emptyTimelineText={state.emptyTimelineText}
            onEditEntry={state.editTimelineEntry}
            getEntryLink={navigation.getEntryLink}
            onEntryAnchorChange={navigation.setEntryAnchor}
            onForkEntry={entry => {
              void state.forkFromEntry(entry).then(activated => {
                if (activated) navigation.openChat(activated.sessionId, activated.branchId)
              })
            }}
            t={state.t}
            timeline={state.timeline}
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
            canPreviewPrompt={state.canPreviewPrompt}
            canSendNarrative={state.canSend}
            narrativeInput={state.input}
            narrativeTextareaDisabled={sessionBusy}
            workspaceOpen={workspaceOpen}
            t={state.t}
            onChangeNarrativeInput={value => {
              state.setInput(value)
            }}
            onExpandedChange={setAgentExpanded}
            onHeightChange={setComposerHeight}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmitNarrative={state.submitTurn}
          />
        </div>
      )}
    />
  )

  return (
    <ContextMenuProvider label={state.t('menu.label')}>
      {studio}
      <NotificationToaster bottomOffset={composerHeight + 16} label={state.t('notification.label')} />
    </ContextMenuProvider>
  )
}

function readNarrativeCharacterName(cardSnapshot: unknown, fallback?: string): string | undefined {
  if (cardSnapshot && typeof cardSnapshot === 'object' && 'name' in cardSnapshot) {
    const name = Reflect.get(cardSnapshot, 'name')
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return fallback?.trim() || undefined
}
