import { useStudioState } from './use-studio-state.js'
import { StudioPage } from '../pages/studio/studio-page.js'
import { PresetWorkbench } from '../widgets/preset-workbench/preset-workbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/context-workbench.js'
import { InputDashboard } from '../widgets/input-dashboard/input-dashboard.js'
import { NarrativeCanvas } from '../widgets/narrative-canvas/narrative-canvas.js'
import { ResourcePanel } from '../widgets/resource-panel/resource-panel.js'
import { ApiPanel } from '../widgets/api-panel/api-panel.js'
import { InspectorPanel } from '../widgets/inspector-panel/inspector-panel.js'
import { DemoData } from './demo-data.js'
import styles from './app.module.css'
import '../styles/global.css'

export function App() {
  const state = useStudioState()
  const contextAssetEditorProps = {
    nodes: state.contextAssets,
    onChangeNode: state.updateContextAsset,
    onMoveNode: state.moveContextAsset,
    onAddNode: state.addContextAsset,
    onDuplicateNode: state.duplicateContextAsset,
    onDeleteNode: state.deleteContextAsset,
    onSelectNode: state.setSelectedContextNodeId,
    selectedId: state.selectedContextNodeId,
    t: state.t,
  }

  return (
    <StudioPage
      busy={state.busy}
      customCss={state.customCss}
      editorPanel={(
        <ContextWorkbench
          {...contextAssetEditorProps}
        />
      )}
      error={state.error}
      t={state.t}
      apiPanel={(
        <ApiPanel
          busy={state.busy}
          endpoint={state.endpoint}
          gatewayForm={state.gatewayForm}
          gatewayProfileSummary={state.gatewayProfileSummary}
          locale={state.locale}
          onChangeEndpoint={state.setEndpoint}
          onChangeGatewayForm={state.setGatewayForm}
          onChangeLocale={state.setLocale}
          onCreateGatewayProfile={state.createGatewayProfile}
          t={state.t}
          providerAccounts={state.providerAccounts}
          modelProfiles={state.modelProfiles}
          onDeleteProviderAccount={state.deleteProviderAccount}
          onDeleteModelProfile={state.deleteModelProfile}
          onUpdateModelProfile={state.updateModelProfile}
          onPingModelProfile={state.pingModelProfile}
        />
      )}
      presetPanel={(
        <PresetWorkbench
          {...contextAssetEditorProps}
          agentRuntimeProfiles={state.agentRuntimeProfiles}
          modelProfiles={state.modelProfiles}
          selectedAgentRuntimeProfileId={state.selectedAgentRuntimeProfileId}
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
          cardJson={state.cardJson}
          cardDraft={state.cardDraft}
          cards={state.cards}
          customCss={state.customCss}
          onAppendRendererMessage={state.appendRendererMessage}
          onChangeCardJson={state.setCardJson}
          onChangeCardDraft={state.setCardDraft}
          onChangeCustomCss={state.setCustomCss}
          onCreateCard={state.createCard}
          onCreateRendererSession={state.createRendererSession}
          onCreateSessionFromCard={state.createSessionFromCard}
          onDeleteCard={state.deleteCard}
          onIncrementRendererLove={state.incrementRendererLove}
          onLoadTestCss={() => state.setCustomCss(DemoData.testCustomCss)}
          onOpenRendererWindow={state.openRendererWindow}
          onRefreshCards={() => {
            void state.runAction(state.refreshCards)
          }}
          onResetCss={() => state.setCustomCss(DemoData.customCss)}
          onRevokeRendererSession={state.revokeRendererSession}
          onSelectCard={state.setSelectedCardId}
          onSwitchBranch={state.switchBranch}
          onUpdateCard={state.updateCard}
          rendererEvents={state.rendererEvents}
          rendererSessionId={state.rendererSessionId}
          rendererState={state.rendererState}
          selectedAgentRuntimeProfileId={state.selectedAgentRuntimeProfileId}
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
            activationControl={state.activationControl}
            canPreviewPrompt={state.canPreviewPrompt}
            canSend={state.canSend}
            composerHint={state.composerHint}
            input={state.input}
            onChangeActivationMode={state.setActivationMode}
            onChangeInput={value => {
              state.setInput(value)
            }}
            onPreviewPrompt={() => {
              void state.previewPrompt()
            }}
            onSubmit={state.submitTurn}
            onToggleActivationTag={state.toggleActivationTag}
            previewLabel={state.t('composer.preview')}
            sendLabel={state.t('composer.send')}
            t={state.t}
            textareaDisabled={!state.session || !state.branch || state.busy}
          />
        </div>
      )}
      inspector={(
        <InspectorPanel
          agentTranscript={state.agentTranscript}
          cardSnapshot={state.session?.cardSnapshot ?? state.selectedCard ?? null}
          events={state.renderingEvents}
          mode={state.renderingMode}
          onAllowRawHtml={() => state.setRawHtmlAllowed(true)}
          onCreateRendererSession={state.createRendererSession}
          onOpenRenderer={state.openRendererWindow}
          onSelectChoice={state.selectRenderingChoice}
          onSelectMode={state.setRenderingMode}
          promptBuildSteps={state.promptBuildSteps}
          promptMessages={state.promptMessages ?? null}
          providerPayloadPreview={state.providerPayloadPreview ?? null}
          rawHtmlAllowed={state.rawHtmlAllowed}
          rendererSessionId={state.rendererSessionId}
          runDetails={state.runDetails ?? null}
          sample={state.renderingSample}
          t={state.t}
        />
      )}
    />
  )
}
