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
import type { ReactNode } from 'react'
import styles from './app.module.scss'
import '../styles/global.css'

export function App(props: { clientLogs: MemoryLogSink; transportLogger: Logger }) {
  const state = useStudioState(props.transportLogger)
  const assetWorkspaceId = state.selectedCardId ?? 'default'
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
        onCreateSessionFromCard={state.createSessionFromCard}
        onDeleteCards={state.deleteCards}
        onSelectCard={state.setSelectedCardId}
        onSwitchBranch={state.switchBranch}
        onUpdateCard={state.updateCard}
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
      />
    ),
    resource: () => <ContextWorkbench {...contextAssetEditorProps} />,
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
      onUndo={() => {
        void state.undoEdit()
      }}
      t={state.t}
      panelHeaders={{ character: <CharacterPanelHeader t={state.t} /> }}
      panels={panels}
      canvas={(
        <div className={styles.canvasStack}>
          <NarrativeCanvas
            branch={state.branch}
            branches={state.branches}
            busy={state.busy}
            emptyTimelineText={state.emptyTimelineText}
            onForkEntry={state.forkFromEntry}
            onSwitchBranchById={branchId => {
              void state.switchBranchById(branchId)
            }}
            selectedCard={state.selectedCard}
            session={state.session}
            t={state.t}
            timeline={state.timeline}
          />
          <ChatComposer
            canPreviewPrompt={state.canPreviewPrompt}
            canSend={state.canSend}
            composerHint={state.composerHint}
            input={state.input}
            onChangeInput={value => {
              state.setInput(value)
            }}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmit={state.submitTurn}
            previewLabel={state.t('composer.preview')}
            sendLabel={state.t('composer.send')}
            textareaDisabled={!state.session || !state.branch || state.busy}
          />
        </div>
      )}
    />
  )

  return <ContextMenuProvider label={state.t('menu.label')}>{studio}</ContextMenuProvider>
}
