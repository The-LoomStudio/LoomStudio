import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbench } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/context-workbench.js'
import { ChatComposer } from '../widgets/chat-composer/chat-composer.js'
import { NarrativeCanvas } from '../widgets/narrative-canvas/narrative-canvas.js'
import { CharacterPanel, CharacterPanelHeader } from '../widgets/character-panel/character-panel.js'
import { ModelPanel } from '../widgets/model-panel/model-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { LogViewer } from '../widgets/log-viewer/log-viewer.js'
import { SettingsPanel } from '../widgets/settings-panel/settings-panel.js'
import { ContextMenuProvider } from '../shared/ui/context-menu/context-menu.js'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
import type { StudioPanelId } from '../pages/studio/model/studio-layout-store.js'
import { useStudioNavigation } from '../pages/studio/model/use-studio-navigation.js'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const state = useStudioState(props.transportLogger)
  const [composerHeight, setComposerHeight] = useState(0)
  const sessionRouteRequestRef = useRef(0)
  const navigation = useStudioNavigation({
    branchId: state.branch?.id,
    selectedCardId: state.selectedCardId,
    sessionId: state.session?.id,
  })
  const assetWorkspaceId = navigation.route.panel === 'preset' || navigation.route.panel === 'resource'
    ? navigation.route.cardId ?? state.selectedCardId ?? 'default'
    : state.selectedCardId ?? 'default'

  useEffect(() => {
    if (navigation.route.panel !== 'preset' && navigation.route.panel !== 'resource') return
    if (navigation.route.cardId) {
      if (navigation.route.cardId !== state.selectedCardId) state.setSelectedCardId(navigation.route.cardId)
      return
    }
    if (state.selectedCardId) navigation.canonicalizePanelCard(state.selectedCardId)
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId])

  useEffect(() => {
    const cardId = navigation.route.panel === 'character' ? navigation.route.cardId : undefined
    if (cardId && !cardId.startsWith('__gallery-mock-') && cardId !== state.selectedCardId) state.setSelectedCardId(cardId)
  }, [navigation.route.cardId, navigation.route.panel, state.selectedCardId, state.setSelectedCardId])

  useEffect(() => {
    if ((navigation.route.panel === 'preset' || navigation.route.panel === 'resource') && navigation.route.assetId) {
      state.setSelectedContextNodeId(navigation.route.assetId)
    }
  }, [navigation.route.assetId, navigation.route.panel, state.setSelectedContextNodeId])

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
    onSelectNode: state.setSelectedContextNodeId,
    t: state.t,
    workspaceId: assetWorkspaceId,
  }
  const panels: Record<StudioPanelId, (active: boolean) => ReactNode> = {
    model: () => (
      <ModelPanel
        busy={state.busy}
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
        busy={state.busy}
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
        onCloseProfile={navigation.closeDetail}
        onOpenProfile={navigation.openCharacter}
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
        searchQuery={navigation.route.panel === 'preset' ? navigation.searchQuery : ''}
        onNavigateAsset={assetId => navigation.openAsset('preset', assetWorkspaceId, assetId)}
        onSearchQueryChange={navigation.setSearchQuery}
      />
    ),
    resource: () => (
      <ContextWorkbench
        {...contextAssetEditorProps}
        routeAssetId={navigation.route.panel === 'resource' ? navigation.route.assetId : undefined}
        searchQuery={navigation.route.panel === 'resource' ? navigation.searchQuery : ''}
        onNavigateAsset={assetId => navigation.openAsset('resource', assetWorkspaceId, assetId)}
        onSearchQueryChange={navigation.setSearchQuery}
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
    settings: () => <SettingsPanel customCss={state.customCss} locale={state.locale} t={state.t} onChangeCustomCss={state.setCustomCss} onChangeLocale={state.setLocale} />,
  }

  const studio = (
    <StudioPage
      activePanel={navigation.activePanel}
      activeAssetId={navigation.route.assetId}
      assetWorkspaceId={assetWorkspaceId}
      modelConfigured={state.providerAccountsLoaded ? hasCompleteProviderAccount(state.providerAccounts) : undefined}
      busy={state.busy}
      canRedo={state.canRedoEdit}
      canUndo={state.canUndoEdit}
      customCss={state.customCss}
      error={state.error}
      onRedo={() => {
        void state.redoEdit()
      }}
      onClosePanel={navigation.closePanel}
      onAssetRouteChange={(layoutId, assetId) => navigation.openAsset(layoutId === 'preset' ? 'preset' : 'resource', assetWorkspaceId, assetId)}
      onTogglePanel={navigation.openPanel}
      onToggleWorkspace={() => navigation.activePanel === null ? navigation.openPanel('character') : navigation.closePanel()}
      onUndo={() => {
        void state.undoEdit()
      }}
      t={state.t}
      panelHeaders={{ character: <CharacterPanelHeader t={state.t} /> }}
      panels={panels}
      canvas={(
        <div
          className={styles.canvasStack}
          style={{ '--loom-composer-height': composerHeight ? `${composerHeight}px` : undefined } as CSSProperties}
        >
          <NarrativeCanvas
            anchorEntryId={navigation.entryAnchorId}
            busy={state.busy}
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
          <ChatComposer
            canPreviewPrompt={state.canPreviewPrompt}
            canSend={state.canSend}
            input={state.input}
            onChangeInput={value => {
              state.setInput(value)
            }}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onHeightChange={setComposerHeight}
            onSubmit={state.submitTurn}
            moreLabel={state.t('composer.more')}
            previewLabel={state.t('composer.preview')}
            retryLabel={state.t('composer.retry')}
            sendLabel={state.t('composer.send')}
            textareaDisabled={state.busy}
          />
        </div>
      )}
    />
  )

  return <ContextMenuProvider label={state.t('menu.label')}>{studio}</ContextMenuProvider>
}
