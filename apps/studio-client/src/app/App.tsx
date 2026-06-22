import { moveContextAssetNode, updateContextAssetNode } from '../features/context-assets/model/tree-ops.js'
import { useStudioState } from './useStudioState.js'
import { StudioPage } from '../pages/studio/StudioPage.js'
import { PresetWorkbench } from '../widgets/preset-workbench/PresetWorkbench.js'
import { ContextWorkbench } from '../widgets/context-workbench/ContextWorkbench.js'
import { InputDashboard } from '../widgets/input-dashboard/InputDashboard.js'
import { NarrativeCanvas } from '../widgets/narrative-canvas/NarrativeCanvas.js'
import { ResourcePanel } from '../widgets/resource-panel/ResourcePanel.js'
import { ApiPanel } from '../widgets/api-panel/ApiPanel.js'
import { RenderingLab } from '../widgets/rendering-lab/RenderingLab.js'
import { PromptBuildFlow } from '../widgets/prompt-build-flow/PromptBuildFlow.js'
import { JsonBlock } from '../shared/ui/json-block/JsonBlock.js'
import { DemoData } from './demo-data.js'
import styles from './App.module.css'
import '../styles/global.css'

export function App() {
  const state = useStudioState()

  return (
    <StudioPage
      busy={state.busy}
      customCss={state.customCss}
      editorPanel={(
        <ContextWorkbench
          nodes={state.contextAssets}
          onChangeNode={(id, partial) => {
            state.setContextAssets(current => updateContextAssetNode(current, id, partial))
          }}
          onMoveNode={(draggedId, targetId, position) => {
            state.setContextAssets(current => moveContextAssetNode(current, draggedId, targetId, position))
          }}
          onAddNode={state.addContextAsset}
          onDuplicateNode={state.duplicateContextAsset}
          onDeleteNode={state.deleteContextAsset}
          onSelectNode={state.setSelectedContextNodeId}
          selectedId={state.selectedContextNodeId}
          t={state.t}
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
          nodes={state.contextAssets}
          onChangeNode={(id, partial) => {
            state.setContextAssets(current => updateContextAssetNode(current, id, partial))
          }}
          onMoveNode={(draggedId, targetId, position) => {
            state.setContextAssets(current => moveContextAssetNode(current, draggedId, targetId, position))
          }}
          onAddNode={state.addContextAsset}
          onDuplicateNode={state.duplicateContextAsset}
          onDeleteNode={state.deleteContextAsset}
          onSelectNode={state.setSelectedContextNodeId}
          selectedId={state.selectedContextNodeId}
          t={state.t}
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
          cards={state.cards}
          customCss={state.customCss}
          onAppendRendererMessage={state.appendRendererMessage}
          onChangeCardJson={state.setCardJson}
          onChangeCustomCss={state.setCustomCss}
          onCreateCard={state.createCard}
          onCreateRendererSession={state.createRendererSession}
          onCreateSessionFromCard={state.createSessionFromCard}
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
        <aside className={styles.inspector} data-airp-component="overlay-utility-layer">
          <section className={styles.section} data-airp-component="rendering-lab">
            <RenderingLab
              events={state.renderingEvents}
              mode={state.renderingMode}
              onAllowRawHtml={() => state.setRawHtmlAllowed(true)}
              onCreateRendererSession={state.createRendererSession}
              onOpenRenderer={state.openRendererWindow}
              onSelectChoice={choice => state.setRenderingEvents(current => [`${new Date().toLocaleTimeString()} choice: ${choice}`, ...current].slice(0, 5))}
              onSelectMode={mode => state.setRenderingMode(mode)}
              rawHtmlAllowed={state.rawHtmlAllowed}
              rendererSessionId={state.rendererSessionId}
              sample={state.renderingSample}
              t={state.t}
            />
          </section>
          <section className={styles.section}>
            <h2>{state.t('inspector.cardSnapshot')}</h2>
            <JsonBlock value={state.session?.cardSnapshot ?? state.selectedCard ?? null} />
          </section>
          <section className={styles.section}>
            <h2>{state.t('inspector.run')}</h2>
            <JsonBlock value={state.runDetails ?? null} />
          </section>
          <section className={styles.section}>
            <h2>{state.t('inspector.agentTranscript')}</h2>
            <JsonBlock value={state.agentTranscript} />
          </section>
          <section className={styles.section}>
            <h2>{state.t('inspector.promptBuildFlow')}</h2>
            <PromptBuildFlow steps={state.promptBuildSteps} />
          </section>
          <section className={styles.section}>
            <h2>{state.t('inspector.prompt')}</h2>
            <JsonBlock value={state.promptMessages ?? null} />
          </section>
        </aside>
      )}
    />
  )
}
