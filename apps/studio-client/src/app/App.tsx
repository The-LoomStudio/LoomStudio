import type { Logger, MemoryLogSink } from '@loom-studio/logging'
import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbench } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/context-workbench.js'
import { InputDashboard } from '../widgets/input-dashboard/input-dashboard.js'
import { NarrativeCanvas } from '../widgets/narrative-canvas/narrative-canvas.js'
import { ResourcePanel } from '../widgets/resource-panel/resource-panel.js'
import { ApiPanel } from '../widgets/api-panel/api-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { LogViewer } from '../widgets/log-viewer/log-viewer.js'
import { SettingsPanel } from '../widgets/settings-panel/settings-panel.js'
import { ContextMenuProvider } from '../shared/ui/context-menu/context-menu.js'
import { hasCompleteProviderAccount } from '../features/provider-settings/model/provider-account-status.js'
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

  const studio = (
    <StudioPage
      assetWorkspaceId={assetWorkspaceId}
      apiConfigured={state.providerAccountsLoaded ? hasCompleteProviderAccount(state.providerAccounts) : undefined}
      busy={state.busy}
      canRedo={state.canRedoEdit}
      canUndo={state.canUndoEdit}
      customCss={state.customCss}
      editorPanel={(
        <ContextWorkbench
          {...contextAssetEditorProps}
        />
      )}
      error={state.error}
      onRedo={() => {
        void state.redoEdit()
      }}
      onUndo={() => {
        void state.undoEdit()
      }}
      t={state.t}
      apiPanel={(
        <ApiPanel
          busy={state.busy}
          gatewayForm={state.gatewayForm}
          onChangeGatewayForm={state.setGatewayForm}
          onCreateProviderAccount={state.createProviderAccount}
          onCreateModelProfile={state.createModelProfile}
          t={state.t}
          providerAccounts={state.providerAccounts}
          modelProfiles={state.modelProfiles}
          onDeleteProviderAccount={state.deleteProviderAccount}
          onDeleteModelProfile={state.deleteModelProfile}
        />
      )}
      settingsPanel={<SettingsPanel customCss={state.customCss} locale={state.locale} onChangeCustomCss={state.setCustomCss} onChangeLocale={state.setLocale} t={state.t} />}
      presetPanel={(
        <PresetWorkbench
          {...contextAssetEditorProps}
          agentRuntimeProfiles={state.agentRuntimeProfiles}
          modelProfiles={state.modelProfiles}
          onSelectAgentRuntimeProfile={id => state.setSelectedAgentRuntimeProfileId(id)}
          onCreateAgentRuntimeProfile={state.createAgentRuntimeProfile}
          onUpdateAgentRuntimeProfile={state.updateAgentRuntimeProfile}
          onDeleteAgentRuntimeProfile={state.deleteAgentRuntimeProfile}
        />
      )}
      resourcePanel={(
        <ResourcePanel
          branch={state.branch}
          branches={state.branches}
          busy={state.busy}
          cardDraft={state.cardDraft}
          cards={state.cards}
          onChangeCardDraft={state.setCardDraft}
          onCreateCard={state.createCard}
          onCreateSessionFromCard={state.createSessionFromCard}
          onDeleteCards={state.deleteCards}
          onSelectCard={state.setSelectedCardId}
          onSwitchBranch={state.switchBranch}
          onUpdateCard={state.updateCard}
          selectedCard={state.selectedCard}
          selectedCardId={state.selectedCardId}
          session={state.session}
          t={state.t}
        />
      )}
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
          <InputDashboard
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
      inspector={(
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
      )}
      logsPanel={(
        <LogViewer
          api={state.logsApi}
          clientLogs={props.clientLogs}
          t={state.t}
        />
      )}
    />
  )

  return <ContextMenuProvider label={state.t('menu.label')}>{studio}</ContextMenuProvider>
}
