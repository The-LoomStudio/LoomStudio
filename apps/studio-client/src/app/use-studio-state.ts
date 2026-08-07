import { createClientBridge, type ClientJsonValue } from '@loom-studio/client-bridge'
import type { Logger } from '@loom-studio/logging'
import { useEffect, useMemo, useState } from 'react'
import { withClientBridgeLogging } from '../shared/api/client-bridge-logging.js'
import { createTranslator, type Locale } from '../shared/i18n/index.js'
import { createStudioApi } from '../shared/api/studio-api.js'
import { useAsyncOperations } from '../shared/hooks/use-async-operations.js'
import { useCards } from '../features/cards/model/use-cards.js'
import { useEditHistory } from '../features/edit-history/model/use-edit-history.js'
import { useContextAssets } from '../features/context-assets/model/use-context-assets.js'
import { normalizeContextAssets } from '../features/context-assets/model/context-asset-normalization.js'
import { findContextAssetNode } from '../features/context-assets/model/context-asset-tree.js'
import { createActivationFacts, toggleActivationTag, type ActivationControlState, type ActivationTag } from '../features/prompt-build/model/activation-control.js'
import { buildPromptBuildSteps } from '../features/prompt-build/model/build-prompt-build-steps.js'
import { useProviderSettings } from '../features/provider-settings/model/use-provider-settings.js'
import { useSessionRuntime } from '../features/session-runtime/model/use-session-runtime.js'
import { DemoData } from './demo-data.js'
import type { CardBundleArtifact, ContextAssetNode, PromptResource } from '../entities/index.js'
import {
  readComposerHint,
  readEmptyTimelineText,
  readStoredPromptBuildTrace,
  readStoredProviderPayloadPreview,
  readStoredPrompt,
  readStoredPromptProjection,
} from './utils.js'

export type HistoryAssetTarget = {
  assetId: string
  layoutId: 'preset' | 'resources'
}

export function useStudioState(transportLogger: Logger) {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const t = useMemo(() => createTranslator(locale), [locale])
  const [endpoint, setEndpoint] = useState(DemoData.endpoint)
  const [customCss, setCustomCss] = useState(DemoData.customCss)
  const [activationControl, setActivationControl] = useState<ActivationControlState>({
    mode: 'draft',
    tags: [],
  })
  const operations = useAsyncOperations()
  const bridge = useMemo(() => createClientBridge({ endpoint, source: 'studio-client' }), [endpoint])
  const observedBridge = useMemo(() => withClientBridgeLogging(bridge, transportLogger), [bridge, transportLogger])
  const api = useMemo(() => createStudioApi(observedBridge), [observedBridge])
  const editHistory = useEditHistory({ revertChangeset: api.history.revert })
  const [promptResources, setPromptResources] = useState<PromptResource[]>([])
  const cardsState = useCards({
    api,
    initialCardName: DemoData.cardName,
    recordEdit: editHistory.record,
    runAction: action => operations.run('cards', action).then(() => undefined),
    t,
  })
  const contextAssetState = useContextAssets({
    api,
    initialNodes: DemoData.contextAssets,
    onResourceChange: resource => {
      setPromptResources(current => current.map(item => item.id === resource.id ? resource : item))
    },
    recordEdit: editHistory.record,
    runAction: action => operations.run('mutation', action).then(() => undefined),
    resources: promptResources,
    t,
  })
  const providerSettings = useProviderSettings({
    api,
    initialProviderAccountDraft: DemoData.providerAccountDraft,
    runAction: action => operations.run('provider-settings', action).then(() => undefined),
  })
  const activationFacts = useMemo(() => createActivationFacts(activationControl), [activationControl])
  const sessionRuntime = useSessionRuntime({
    activationFacts,
    api,
    initialInput: '我看向柜台后的铃铛。',
    initialTimeline: DemoData.timeline,
    selectedCardId: cardsState.selectedCardId,
    selectedAgentRuntimeProfileId: providerSettings.selectedAgentRuntimeProfileId,
    runAction: action => operations.run('session', action).then(() => undefined),
    runLatestAction: action => operations.runLatest('session', action).then(() => undefined),
    readProjectionOrderProfile: contextAssetState.readProjectionOrderProfile,
  })

  function applyPromptResourceSelection(resources: PromptResource[]) {
    setPromptResources(resources)
    contextAssetState.setNodes(normalizeContextAssets(resources.map(resource => resource.rootNode)))
  }

  useEffect(() => {
    editHistory.clear()
    void operations.run('bootstrap', async () => {
      const cards = await cardsState.refreshCards()
      let selectedCardId = cards[0]?.id

      if (cards.length === 0 && import.meta.env.DEV) {
        const imported = await api.cardBundles.import({
          artifact: createDemoCardBundleArtifact() as unknown as ClientJsonValue,
        })
        selectedCardId = imported.card.id
        await cardsState.refreshCards()
      }

      if (selectedCardId) cardsState.setSelectedCardId(selectedCardId)
      await providerSettings.refreshProviderSettings()
    })
  }, [observedBridge])

  useEffect(() => {
    if (!cardsState.selectedCardId) {
      applyPromptResourceSelection([])
      return
    }

    void operations.runLatest('resources', async context => {
      const result = await api.promptResources.listForCard(cardsState.selectedCardId!)
      if (context.isCurrent()) applyPromptResourceSelection(result.resources)
    })
  }, [api, cardsState.selectedCardId])

  // 派生计算
  const sessionBusy = operations.isPending('session')
  const canSend = Boolean(sessionRuntime.session && sessionRuntime.branch) && !sessionBusy && sessionRuntime.input.trim().length > 0
  const canPreviewPrompt = Boolean(sessionRuntime.session && sessionRuntime.branch) && !sessionBusy && sessionRuntime.input.trim().length > 0
  const composerHint = readComposerHint({
    session: sessionRuntime.session,
    branch: sessionRuntime.branch,
    busy: sessionBusy,
    input: sessionRuntime.input,
  }, t)
  const emptyTimelineText = readEmptyTimelineText({ session: sessionRuntime.session, branch: sessionRuntime.branch }, t)
  const storedPrompt = readStoredPrompt(sessionRuntime.runDetails)
  const storedPromptProjection = readStoredPromptProjection(sessionRuntime.runDetails)
  const promptMessages = sessionRuntime.promptPreview?.messages ?? storedPrompt
  const promptProjection = sessionRuntime.promptPreview?.projection ?? storedPromptProjection
  const promptBuildTrace = sessionRuntime.promptPreview?.promptBuildTrace ?? readStoredPromptBuildTrace(sessionRuntime.runDetails)
  const providerPayloadPreview = sessionRuntime.promptPreview?.providerPayloadPreview ?? readStoredProviderPayloadPreview(sessionRuntime.runDetails)
  const promptBuildSteps = buildPromptBuildSteps({
    session: sessionRuntime.session,
    branch: sessionRuntime.branch,
    timeline: sessionRuntime.timeline,
    input: sessionRuntime.input,
    messages: promptMessages,
    projection: promptProjection,
    activationFacts,
    promptBuildTrace,
  }, t)

  function toggleRuntimeTag(tag: ActivationTag) {
    setActivationControl(current => ({
      ...current,
      tags: toggleActivationTag(current.tags, tag),
    }))
  }

  async function undoEdit() {
    return operations.run('mutation', async () => {
      const entry = await editHistory.undo()
      if (!entry) return
      return refreshHistoryAnchor(entry)
    })
  }

  async function redoEdit() {
    return operations.run('mutation', async () => {
      const entry = await editHistory.redo()
      if (!entry) return
      return refreshHistoryAnchor(entry)
    })
  }

  async function refreshHistoryAnchor(entry: { anchor?: { documentId: string; subjectId?: string } }): Promise<HistoryAssetTarget | undefined> {
    if (!entry.anchor) return
    if (promptResources.some(resource => resource.id === entry.anchor?.documentId)) {
      const result = await api.promptResources.get(entry.anchor.documentId)
      const resources = promptResources.map(resource => resource.id === result.resource.id ? result.resource : resource)
      applyPromptResourceSelection(resources)
      const subjectId = entry.anchor.subjectId
      const contextAssets = resources.map(resource => resource.rootNode)
      return readHistoryAssetTarget(contextAssets, subjectId, readDefaultContextAssetId(resources))
    }

    const cards = await cardsState.refreshCards()
    if (cards.some(card => card.id === entry.anchor?.documentId)) {
      cardsState.setSelectedCardId(entry.anchor.documentId)
    }
  }

  return {
    // i18n
    locale, setLocale, t,
    // bridge
    endpoint, setEndpoint,
    logsApi: api.logs,
    // cards
    cards: cardsState.cards,
    selectedCardId: cardsState.selectedCardId,
    setSelectedCardId: cardsState.setSelectedCardId,
    cardDraft: cardsState.cardDraft,
    setCardDraft: cardsState.setCardDraft,
    selectedCard: cardsState.selectedCard,
    // session
    session: sessionRuntime.session, branch: sessionRuntime.branch, branches: sessionRuntime.branches,
    // timeline
    timeline: sessionRuntime.timeline,
    editTimelineEntry: sessionRuntime.editTimelineEntry,
    // agent
    agentTranscript: sessionRuntime.agentTranscript,
    // run
    runDetails: sessionRuntime.runDetails,
    // prompt
    promptPreview: sessionRuntime.promptPreview, promptMessages, promptProjection, promptBuildSteps,
    promptBuildTrace,
    providerPayloadPreview,
    activationControl,
    activationFacts,
    setActivationMode: (mode: ActivationControlState['mode']) => setActivationControl(current => ({ ...current, mode })),
    toggleActivationTag: toggleRuntimeTag,
    // gateway
    providerAccountDraft: providerSettings.providerAccountDraft,
    setProviderAccountDraft: providerSettings.setProviderAccountDraft,
    selectedAgentRuntimeProfileId: providerSettings.selectedAgentRuntimeProfileId,
    setSelectedAgentRuntimeProfileId: providerSettings.setSelectedAgentRuntimeProfileId,
    // input
    input: sessionRuntime.input, setInput: sessionRuntime.setInput,
    // state
    operationPending: operations.pending,
    operationError: operations.error,
    canUndoEdit: editHistory.canUndo,
    canRedoEdit: editHistory.canRedo,
    // custom css
    customCss, setCustomCss,
    // context assets
    contextAssets: contextAssetState.nodes, setContextAssets: contextAssetState.setNodes,
    previewContextAsset: contextAssetState.previewContextAsset,
    updateContextAsset: contextAssetState.updateContextAsset,
    updateContextAssets: contextAssetState.updateContextAssets,
    moveContextAsset: contextAssetState.moveContextAsset,
    addContextAsset: contextAssetState.addContextAsset,
    duplicateContextAsset: contextAssetState.duplicateContextAsset,
    deleteContextAsset: contextAssetState.deleteContextAsset,
    // derived
    canSend, canPreviewPrompt, composerHint, emptyTimelineText,
    // actions
    undoEdit,
    redoEdit,
    createCard: cardsState.createCard,
    updateCard: cardsState.updateCard,
    deleteCard: cardsState.deleteCard,
    deleteCards: cardsState.deleteCards,
    createProviderAccount: providerSettings.createProviderAccount,
    createModelProfile: providerSettings.createModelProfile,
    createSessionFromCard: sessionRuntime.createSessionFromCard,
    activateSession: sessionRuntime.activateSession,
    submitTurn: sessionRuntime.submitTurn,
    previewPrompt: sessionRuntime.previewPrompt,
    forkFromEntry: sessionRuntime.forkFromEntry,
    switchBranch: sessionRuntime.switchBranch,
    switchBranchById: sessionRuntime.switchBranchById,
    refreshCards: cardsState.refreshCards,
    // provider management
    providerAccounts: providerSettings.providerAccounts,
    providerAccountsLoaded: providerSettings.providerAccountsLoaded,
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

function createDemoCardBundleArtifact(): CardBundleArtifact {
  const card = JSON.parse(DemoData.cardJson) as CardBundleArtifact['card']

  return {
    schemaVersion: 1,
    artifactId: 'studio-demo-card-bundle',
    displayName: 'Studio Demo Card Bundle',
    description: 'Card bundle imported from the built-in Studio demo data.',
    card,
    contextAssets: DemoData.contextAssets,
  }
}

function readDefaultContextAssetId(resources: PromptResource[]): string {
  return resources[0]?.rootNode.id ?? ''
}

export function readHistoryAssetTarget(
  nodes: ContextAssetNode[],
  subjectId?: string,
  fallbackId = '',
): HistoryAssetTarget | undefined {
  const asset = findContextAssetNode(nodes, subjectId ?? '') ?? findContextAssetNode(nodes, fallbackId)
  return asset ? {
    assetId: asset.id,
    layoutId: asset.category === 'preset' ? 'preset' : 'resources',
  } : undefined
}
