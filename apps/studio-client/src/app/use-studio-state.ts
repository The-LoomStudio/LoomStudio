import { createClientBridge, type ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useMemo, useState } from 'react'
import { createTranslator, type Locale } from '../shared/i18n/index.js'
import { createRendererApi } from '../shared/api/renderer-api.js'
import { createStudioApi } from '../shared/api/studio-api.js'
import { useBusyAction } from '../shared/hooks/use-busy-action.js'
import { useCards } from '../features/cards/model/use-cards.js'
import { useContextAssets } from '../features/context-assets/model/use-context-assets.js'
import { normalizeContextAssets } from '../features/context-assets/model/context-asset-normalization.js'
import { createActivationFacts, toggleActivationTag, type ActivationControlState, type ActivationTag } from '../features/prompt-build/model/activation-control.js'
import { buildPromptBuildSteps } from '../features/prompt-build/model/build-prompt-build-steps.js'
import { useRenderingLab } from '../features/rendering-lab/model/use-rendering-lab.js'
import { useRendererSession } from '../features/renderer-poc/model/use-renderer-session.js'
import { useProviderSettings } from '../features/provider-settings/model/use-provider-settings.js'
import { useSessionRuntime } from '../features/session-runtime/model/use-session-runtime.js'
import { DemoData } from './demo-data.js'
import type { PromptWorkspace, PromptWorkspaceArtifact } from '../entities/index.js'
import {
  readComposerHint,
  readEmptyTimelineText,
  readStoredProviderPayloadPreview,
  readStoredPrompt,
  readStoredPromptProjection,
} from './utils.js'

export function useStudioState() {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const t = useMemo(() => createTranslator(locale), [locale])
  const [endpoint, setEndpoint] = useState(DemoData.endpoint)
  const [customCss, setCustomCss] = useState(DemoData.customCss)
  const [activationControl, setActivationControl] = useState<ActivationControlState>({
    mode: 'draft',
    tags: [],
  })
  const busyAction = useBusyAction()
  const bridge = useMemo(() => createClientBridge({ endpoint, source: 'studio-client' }), [endpoint])
  const api = useMemo(() => createStudioApi(bridge), [bridge])
  const rendererApi = useMemo(() => createRendererApi(bridge), [bridge])
  const [activePromptWorkspaceId, setActivePromptWorkspaceId] = useState<string>()
  const [promptWorkspaces, setPromptWorkspaces] = useState<PromptWorkspace[]>([])
  const [promptWorkspacesLoaded, setPromptWorkspacesLoaded] = useState(false)
  const cardsState = useCards({
    api,
    initialCardJson: DemoData.cardJson,
    runAction: busyAction.runAction,
    t,
  })
  const renderer = useRendererSession({ rendererApi, runAction: busyAction.runAction, t })
  const renderingLab = useRenderingLab({ initialMode: 'inline-artifact', t })
  const contextAssetState = useContextAssets({
    api,
    initialNodes: DemoData.contextAssets,
    initialSelectedId: 'projection-order-profile-main',
    workspaceId: activePromptWorkspaceId,
  })
  const providerSettings = useProviderSettings({
    api,
    initialGatewayForm: DemoData.gatewayForm,
    runAction: busyAction.runAction,
    t,
  })
  const activationFacts = useMemo(() => createActivationFacts(activationControl), [activationControl])
  const sessionRuntime = useSessionRuntime({
    activationFacts,
    api,
    initialInput: '我看向柜台后的铃铛。',
    selectedCardId: cardsState.selectedCardId,
    selectedWorkspaceId: activePromptWorkspaceId,
    selectedAgentRuntimeProfileId: providerSettings.selectedAgentRuntimeProfileId,
    runAction: busyAction.runAction,
    readProjectionOrderProfile: contextAssetState.readProjectionOrderProfile,
  })

  function applyPromptWorkspaceSelection(workspace: PromptWorkspace | undefined) {
    setActivePromptWorkspaceId(workspace?.id)
    contextAssetState.setNodes(workspace ? normalizeContextAssets(workspace.contextAssets) : [])
    contextAssetState.setSelectedId(readDefaultContextAssetId(workspace))
  }

  useEffect(() => {
    void busyAction.runAction(async () => {
      setPromptWorkspacesLoaded(false)
      const listed = await api.promptWorkspaces.list()
      let workspaces = listed.workspaces
      let selectedCardId = workspaces[0]?.cardId

      if (workspaces.length === 0) {
        const imported = await api.promptWorkspaces.import({
          artifact: createDemoPromptWorkspaceArtifact() as unknown as ClientJsonValue,
        })
        workspaces = [imported.workspace]
        selectedCardId = imported.card.id
      }

      setPromptWorkspaces(workspaces)
      if (selectedCardId) cardsState.setSelectedCardId(selectedCardId)
      setPromptWorkspacesLoaded(true)
      applyPromptWorkspaceSelection(workspaces.find(workspace => workspace.cardId === selectedCardId))
      await cardsState.refreshCards()
      await providerSettings.refreshProviderSettings()
    })
  }, [bridge])

  const selectedCardWorkspaceId = useMemo(() => {
    if (!cardsState.selectedCardId) return undefined
    return promptWorkspaces.find(workspace => workspace.cardId === cardsState.selectedCardId)?.id
  }, [cardsState.selectedCardId, promptWorkspaces])

  useEffect(() => {
    if (!promptWorkspacesLoaded) return
    if (!selectedCardWorkspaceId) {
      applyPromptWorkspaceSelection(undefined)
      return
    }

    let cancelled = false
    void api.promptWorkspaces.get(selectedCardWorkspaceId).then(result => {
      if (cancelled) return
      setPromptWorkspaces(current => current.map(workspace => (
        workspace.id === result.workspace.id ? result.workspace : workspace
      )))
      applyPromptWorkspaceSelection(result.workspace)
    }).catch(error => {
      console.error('Failed to load prompt workspace', error)
    })

    return () => {
      cancelled = true
    }
  }, [api, promptWorkspacesLoaded, selectedCardWorkspaceId])

  // 派生计算
  const canSend = Boolean(sessionRuntime.session && sessionRuntime.branch) && !busyAction.busy && sessionRuntime.input.trim().length > 0
  const canPreviewPrompt = Boolean(sessionRuntime.session && sessionRuntime.branch) && !busyAction.busy && sessionRuntime.input.trim().length > 0
  const composerHint = readComposerHint({
    session: sessionRuntime.session,
    branch: sessionRuntime.branch,
    busy: busyAction.busy,
    input: sessionRuntime.input,
  }, t)
  const emptyTimelineText = readEmptyTimelineText({ session: sessionRuntime.session, branch: sessionRuntime.branch }, t)
  const storedPrompt = readStoredPrompt(sessionRuntime.runDetails)
  const storedPromptProjection = readStoredPromptProjection(sessionRuntime.runDetails)
  const promptMessages = sessionRuntime.promptPreview?.messages ?? storedPrompt
  const promptProjection = sessionRuntime.promptPreview?.projection ?? storedPromptProjection
  const providerPayloadPreview = sessionRuntime.promptPreview?.providerPayloadPreview ?? readStoredProviderPayloadPreview(sessionRuntime.runDetails)
  const promptBuildSteps = buildPromptBuildSteps({
    session: sessionRuntime.session,
    branch: sessionRuntime.branch,
    timeline: sessionRuntime.timeline,
    input: sessionRuntime.input,
    messages: promptMessages,
    projection: promptProjection,
    activationFacts,
  }, t)

  function toggleRuntimeTag(tag: ActivationTag) {
    setActivationControl(current => ({
      ...current,
      tags: toggleActivationTag(current.tags, tag),
    }))
  }

  return {
    // i18n
    locale, setLocale, t,
    // bridge
    endpoint, setEndpoint,
    // cards
    cards: cardsState.cards,
    selectedCardId: cardsState.selectedCardId,
    setSelectedCardId: cardsState.setSelectedCardId,
    cardJson: cardsState.cardJson,
    setCardJson: cardsState.setCardJson,
    cardDraft: cardsState.cardDraft,
    setCardDraft: cardsState.setCardDraft,
    selectedCard: cardsState.selectedCard,
    // session
    session: sessionRuntime.session, branch: sessionRuntime.branch, branches: sessionRuntime.branches,
    // timeline
    timeline: sessionRuntime.timeline,
    // agent
    agentTranscript: sessionRuntime.agentTranscript,
    // run
    runDetails: sessionRuntime.runDetails,
    // prompt
    promptPreview: sessionRuntime.promptPreview, promptMessages, promptProjection, promptBuildSteps,
    providerPayloadPreview,
    activePromptWorkspaceId,
    activationControl,
    activationFacts,
    setActivationMode: (mode: ActivationControlState['mode']) => setActivationControl(current => ({ ...current, mode })),
    toggleActivationTag: toggleRuntimeTag,
    // gateway
    gatewayForm: providerSettings.gatewayForm,
    setGatewayForm: providerSettings.setGatewayForm,
    selectedAgentRuntimeProfileId: providerSettings.selectedAgentRuntimeProfileId,
    setSelectedAgentRuntimeProfileId: providerSettings.setSelectedAgentRuntimeProfileId,
    gatewayProfileSummary: providerSettings.gatewayProfileSummary,
    // input
    input: sessionRuntime.input, setInput: sessionRuntime.setInput,
    // state
    busy: busyAction.busy, error: busyAction.error,
    // renderer
    rendererSessionId: renderer.rendererSessionId,
    rendererState: renderer.rendererState,
    rendererEvents: renderer.rendererEvents,
    // custom css
    customCss, setCustomCss,
    // rendering lab
    renderingMode: renderingLab.renderingMode,
    setRenderingMode: renderingLab.setRenderingMode,
    rawHtmlAllowed: renderingLab.rawHtmlAllowed,
    setRawHtmlAllowed: renderingLab.setRawHtmlAllowed,
    renderingEvents: renderingLab.renderingEvents,
    setRenderingEvents: renderingLab.setRenderingEvents,
    selectRenderingChoice: renderingLab.selectRenderingChoice,
    renderingSample: renderingLab.renderingSample,
    // context assets
    contextAssets: contextAssetState.nodes, setContextAssets: contextAssetState.setNodes,
    selectedContextNodeId: contextAssetState.selectedId, setSelectedContextNodeId: contextAssetState.setSelectedId,
    updateContextAsset: contextAssetState.updateContextAsset,
    moveContextAsset: contextAssetState.moveContextAsset,
    addContextAsset: contextAssetState.addContextAsset,
    duplicateContextAsset: contextAssetState.duplicateContextAsset,
    deleteContextAsset: contextAssetState.deleteContextAsset,
    // derived
    canSend, canPreviewPrompt, composerHint, emptyTimelineText,
    // actions
    runAction: busyAction.runAction,
    createCard: cardsState.createCard,
    updateCard: cardsState.updateCard,
    deleteCard: cardsState.deleteCard,
    createGatewayProfile: providerSettings.createGatewayProfile,
    createSessionFromCard: sessionRuntime.createSessionFromCard,
    submitTurn: sessionRuntime.submitTurn,
    previewPrompt: sessionRuntime.previewPrompt,
    forkFromEntry: sessionRuntime.forkFromEntry,
    switchBranch: sessionRuntime.switchBranch,
    switchBranchById: sessionRuntime.switchBranchById,
    refreshCards: cardsState.refreshCards,
    createRendererSession: renderer.createRendererSession,
    revokeRendererSession: renderer.revokeRendererSession,
    incrementRendererLove: renderer.incrementRendererLove,
    appendRendererMessage: renderer.appendRendererMessage,
    openRendererWindow: renderer.openRendererWindow,
    // provider management
    providerAccounts: providerSettings.providerAccounts,
    modelProfiles: providerSettings.modelProfiles,
    agentRuntimeProfiles: providerSettings.agentRuntimeProfiles,
    refreshProviderAccounts: providerSettings.refreshProviderAccounts,
    refreshModelProfiles: providerSettings.refreshModelProfiles,
    refreshAgentRuntimeProfiles: providerSettings.refreshAgentRuntimeProfiles,
    updateProviderAccount: providerSettings.updateProviderAccount,
    deleteProviderAccount: providerSettings.deleteProviderAccount,
    updateModelProfile: providerSettings.updateModelProfile,
    deleteModelProfile: providerSettings.deleteModelProfile,
    pingModelProfile: providerSettings.pingModelProfile,
    createAgentRuntimeProfile: providerSettings.createAgentRuntimeProfile,
    updateAgentRuntimeProfile: providerSettings.updateAgentRuntimeProfile,
    deleteAgentRuntimeProfile: providerSettings.deleteAgentRuntimeProfile,
  }
}

function createDemoPromptWorkspaceArtifact(): PromptWorkspaceArtifact {
  const card = JSON.parse(DemoData.cardJson) as PromptWorkspaceArtifact['card']

  return {
    schemaVersion: 1,
    artifactId: 'studio-demo-live-workspace',
    displayName: 'Studio Demo Live Workspace',
    description: 'Live workspace imported from the built-in Studio demo data.',
    card,
    contextAssets: DemoData.contextAssets,
  }
}

function readDefaultContextAssetId(workspace: PromptWorkspace | undefined): string {
  return workspace?.contextAssets[0]?.id ?? ''
}
