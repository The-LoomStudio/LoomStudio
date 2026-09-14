import { createClientBridge } from '@loom-studio/client-bridge'
import type { Logger } from '@loom-studio/logging'
import { useEffect, useMemo, useState } from 'react'
import { withClientBridgeLogging } from '../shared/api/client-bridge-logging.js'
import { createTranslator, type Locale } from '../shared/i18n/index.js'
import { createStudioApi, type NetworkSettings } from '../shared/api/studio-api.js'
import { useAsyncOperations } from '../shared/hooks/use-async-operations.js'
import { useCards } from '../features/cards/model/use-cards.js'
import { useEditHistory } from '../features/edit-history/model/use-edit-history.js'
import { useContextAssets } from '../features/context-assets/model/use-context-assets.js'
import { normalizeContextAssets } from '../features/context-assets/model/context-asset-normalization.js'
import { findContextAssetNode } from '../features/context-assets/model/context-asset-tree.js'
import { createActivationFacts, toggleActivationTag, type ActivationControlState, type ActivationTag } from '../features/prompt-build/model/activation-control.js'
import { useMacroPreview } from '../features/prompt-build/model/use-macro-preview.js'
import { useMacroSelection } from '../features/prompt-build/model/use-macro-selection.js'
import { useProviderSettings } from '../features/provider-settings/model/use-provider-settings.js'
import { useAgentProfiles } from '../features/agent-profiles/model/use-agent-profiles.js'
import { useNarrativeRuntime } from '../features/narrative-runtime/model/use-narrative-runtime.js'
import { useExtensionResourceCommands } from '../features/extension-renderers/model/use-extension-resource-commands.js'
import { usePromptResourceCommands } from '../features/prompt-resources/model/use-prompt-resource-commands.js'
import { usePromptResourceState } from '../features/prompt-resources/model/use-prompt-resource-state.js'
import type { ContextAssetNode, PromptResource } from '../entities/index.js'
import { useStudioDerivedValues } from './use-studio-derived-values.js'

export type HistoryAssetTarget = {
  assetId: string
  layoutId: 'preset' | 'resources'
}

export function useStudioState(transportLogger: Logger) {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const t = useMemo(() => createTranslator(locale), [locale])
  const [endpoint, setEndpoint] = useState('/rpc')
  const [customCss, setCustomCss] = useState('')
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>({
    proxyMode: 'system',
    systemProxyDetected: false,
  })
  const [activationControl, setActivationControl] = useState<ActivationControlState>({
    mode: 'draft',
    tags: [],
  })
  const operations = useAsyncOperations()
  const bridge = useMemo(() => createClientBridge({ endpoint }), [endpoint])
  const observedBridge = useMemo(() => withClientBridgeLogging(bridge, transportLogger), [bridge, transportLogger])
  const api = useMemo(() => createStudioApi(observedBridge), [observedBridge])
  const clientExtensionApi = useMemo(() => ({
    extensions: api.extensions,
    extensionRuntime: api.extensionRuntime,
    states: api.states,
    textTransforms: api.textTransforms,
  }), [api])
  const editHistory = useEditHistory({ revertChangeset: api.history.revert })
  const promptResourceState = usePromptResourceState({ api, endpoint })
  const {
    presetToolMounts,
    promptResources,
    refreshPresetToolMounts,
    refreshPromptResourceLibrary,
    refreshSettingMounts,
    setPresetToolMounts,
    setPromptResources,
    setSettingMounts,
    settingMounts,
  } = promptResourceState
  const cardsState = useCards({
    api,
    initialCardName: '',
    onCardsImported: async () => {
      await refreshPromptResourceLibrary()
    },
    onCardsDeleted: async () => {
      await refreshPromptResourceLibrary()
    },
    recordEdit: editHistory.record,
    runAction: action => operations.run('cards', action).then(() => undefined),
    t,
  })
  const contextAssetState = useContextAssets({
    api,
    onResourceChange: resource => {
      setPromptResources(current => current.map(item => item.id === resource.id ? resource : item))
    },
    recordEdit: editHistory.record,
    runAction: action => operations.run('mutation', action).then(() => undefined),
    resources: promptResources,
    t,
  })
  useEffect(() => {
    contextAssetState.setNodes(normalizeContextAssets(promptResources.map(resource => resource.rootNode)))
  }, [promptResources])
  const providerSettings = useProviderSettings({
    api,
    initialProviderAccountDraft: {
      displayName: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
    },
    runAction: action => operations.run('provider-settings', action).then(() => undefined),
  })
  const agentProfiles = useAgentProfiles({
    api,
    runAction: action => operations.run('agent-profiles', action).then(() => undefined),
  })
  const selectedAgentProfile = agentProfiles.agentProfiles.find(profile => profile.id === agentProfiles.selectedAgentProfileId)
  const macroSelection = useMacroSelection({ endpoint, cardId: cardsState.selectedCardId, presetId: selectedAgentProfile?.presetId })
  const activationFacts = useMemo(() => createActivationFacts(activationControl), [activationControl])
  const narrativeRuntime = useNarrativeRuntime({
    activationFacts,
    getMacroSelections: macroSelection.getSelections,
    api,
    initialInput: '我看向柜台后的铃铛。',
    initialNodes: [],
    selectedCard: cardsState.selectedCardDetails,
    selectedCardId: cardsState.selectedCardId,
    selectedAgentProfileId: agentProfiles.selectedAgentProfileId,
    onSelectAgentProfile: agentProfiles.selectAgentProfile,
    runAgentAction: action => operations.run('agent-chat', action).then(() => undefined),
    runAction: async action => {
      let completed = false
      await operations.run('session', async () => {
        await action()
        completed = true
      })
      return completed
    },
    runLatestAction: action => operations.runLatest('session', action).then(() => undefined),
  })

  function applyPromptResourceLibrary(resources: PromptResource[]) {
    setPromptResources(() => resources)
    contextAssetState.setNodes(normalizeContextAssets(resources.map(resource => resource.rootNode)))
  }

  async function refreshExtensionDependentData(): Promise<void> {
    await Promise.all([
      refreshPromptResourceLibrary(),
      refreshSettingMounts(),
      refreshPresetToolMounts(),
      agentProfiles.refreshAgentProfiles(),
    ])
  }

  const extensionResourceCommands = useExtensionResourceCommands({
    api,
    refreshCards: cardsState.refreshCards,
    refreshCardTimelines: narrativeRuntime.refreshCardTimelines,
    refreshDependentData: refreshExtensionDependentData,
    selectedCardId: cardsState.selectedCardId,
  })

  useEffect(() => {
    editHistory.clear()
    void operations.run('bootstrap', async () => {
      const cards = await cardsState.refreshCards()
      const selectedCardId = cards[0]?.id

      if (selectedCardId) cardsState.setSelectedCardId(selectedCardId)
      await narrativeRuntime.refreshAllAgentSessions()
      await providerSettings.refreshProviderSettings()
      await agentProfiles.refreshAgentProfiles()
      setNetworkSettings(await api.settings.getNetwork())
    })
  }, [observedBridge])

  useEffect(() => {
    if (!cardsState.selectedCardId) return
    void narrativeRuntime.refreshCardTimelines(cardsState.selectedCardId)
  }, [api, cardsState.selectedCardId])

  const macroKey = macroSelection.targetKey(narrativeRuntime.timeline?.id, narrativeRuntime.branch?.id)
  const macroSelections = macroSelection.readSelections(macroKey)
  useEffect(() => {
    macroSelection.activate(macroKey)
  }, [macroKey])
  const macroPreviewState = useMacroPreview({
    api: api.macros,
    branchId: narrativeRuntime.branch?.id,
    cardId: cardsState.selectedCardId,
    cardVersion: cardsState.selectedCardDetails?.version,
    key: macroKey,
    lastRunId: narrativeRuntime.lastRun?.runId,
    presetId: selectedAgentProfile?.presetId,
    resourceRevision: promptResources,
    selections: macroSelections,
    timelineId: narrativeRuntime.timeline?.id,
  })
  const macroPreview = macroPreviewState.preview

  const promptResourceCommands = usePromptResourceCommands({
    api,
    t,
    runMutation: action => operations.run('mutation', action),
    recordEdit: editHistory.record,
    promptResources,
    setPromptResources,
    setSettingMounts,
    setPresetToolMounts,
    invalidatePromptResourceState: promptResourceState.invalidate,
    refreshAgentProfiles: agentProfiles.refreshAgentProfiles,
    refreshCards: cardsState.refreshCards,
    refreshCardTimelines: narrativeRuntime.refreshCardTimelines,
    selectedCardId: cardsState.selectedCardId,
  })

  async function refreshStates() {
    macroPreviewState.refresh()
  }

  const sessionBusy = operations.isPending('session')
  const promptMessages = narrativeRuntime.promptPreview?.messages
  const promptProjection = narrativeRuntime.promptPreview?.projection ?? narrativeRuntime.lastRun?.projection
  const promptBuildTrace = undefined
  const providerPayloadPreview = narrativeRuntime.promptPreview?.providerPayloadPreview
  const derivedValues = useStudioDerivedValues({
    t,
    timeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    selectedCard: cardsState.selectedCardDetails,
    selectedCardDetails: cardsState.selectedCardDetails,
    nodes: narrativeRuntime.nodes,
    narrativeInput: narrativeRuntime.input,
    promptMessages,
    promptProjection,
    activationFacts,
    promptPreviewMacroInspection: narrativeRuntime.promptPreview?.macroInspection,
    lastRunMacroInspection: narrativeRuntime.lastRun?.macroInspection,
    sessionBusy,
    agentSessionReady: narrativeRuntime.agentSessionReady,
    agentInput: narrativeRuntime.agentInput,
    selectedAgentProfile,
    agentChatBusy: operations.isPending('agent-chat'),
    macroPreview,
    macroKey,
    macroContextCard: cardsState.selectedCardDetails,
  })

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

  async function updateNetworkSettings(next: { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string }) {
    const updated = await operations.run('settings', () => api.settings.updateNetwork(next))
    if (updated) setNetworkSettings(updated)
  }

  async function refreshHistoryAnchor(entry: { anchor?: { documentId: string; subjectId?: string } }): Promise<HistoryAssetTarget | undefined> {
    if (!entry.anchor) return
    if (promptResources.some(resource => resource.id === entry.anchor?.documentId)) {
      const result = await api.promptResources.get(entry.anchor.documentId)
      const resources = promptResources.map(resource => resource.id === result.resource.id ? result.resource : resource)
      applyPromptResourceLibrary(resources)
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
    networkSettings,
    updateNetworkSettings,
    // bridge
    endpoint, setEndpoint,
    logsApi: api.logs,
    statesApi: api.states,
    textTransformsApi: api.textTransforms,
    clientExtensionApi,
    ...extensionResourceCommands,
    // cards
    cards: cardsState.cards,
    selectedCardId: cardsState.selectedCardId,
    setSelectedCardId: cardsState.setSelectedCardId,
    cardDraft: cardsState.cardDraft,
    setCardDraft: cardsState.setCardDraft,
    selectedCard: cardsState.selectedCard,
    selectedCardDetails: cardsState.selectedCardDetails,
    updateCardMedia: cardsState.updateCardMedia,
    updateCardStateConfig: cardsState.updateCardStateConfig,
    updateCardMacros: cardsState.updateCardMacros,
    macroInspection: macroPreview.key === macroKey ? macroPreview.inspection : undefined,
    macroInspectionLoading: macroPreview.key !== macroKey || macroPreview.loading,
    macroInspectionError: macroPreview.key === macroKey ? macroPreview.error : undefined,
    macroSelections,
    macroTargetKey: macroKey,
    selectMacroSource: (name: string, sourceId: string | undefined) => macroSelection.selectSource(macroKey, name, sourceId),
    refreshMacros: macroPreviewState.refresh,
    replaceCardPromptResources: cardsState.replaceCardPromptResources,
    importCards: cardsState.importCards,
    exportCard: cardsState.exportCard,
    directoryApi: cardsState.directoryApi,
    // narrative
    narrativeTimeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    branches: narrativeRuntime.branches,
    cardTimelines: narrativeRuntime.cardTimelines,
    allTimelines: narrativeRuntime.allTimelines,
    refreshAllTimelines: narrativeRuntime.refreshAllTimelines,
    narrativeNodes: narrativeRuntime.nodes,
    editNarrativeNode: narrativeRuntime.editNarrativeNode,
    hasOlderNarrativeNodes: Boolean(narrativeRuntime.olderCursor),
    // agent
    agentMessages: narrativeRuntime.agentMessages,
    narrativeAgentSession: narrativeRuntime.agentSession,
    agentChatSession: narrativeRuntime.agentSession,
    agentChatSessions: narrativeRuntime.agentSessions,
    allAgentSessions: narrativeRuntime.allAgentSessions,
    agentChatSessionReady: narrativeRuntime.agentSessionReady,
    agentActiveRun: narrativeRuntime.activeAgentRun,
    cancelAgentRun: narrativeRuntime.cancelAgentRun,
    pauseAgentRun: narrativeRuntime.pauseAgentRun,
    resumeAgentRun: narrativeRuntime.resumeAgentRun,
    agentChatSessionLoading: narrativeRuntime.agentSessionLoading,
    newAgentSession: narrativeRuntime.newAgentSession,
    refreshAgentSessions: narrativeRuntime.refreshAgentSessions,
    refreshAllAgentSessions: narrativeRuntime.refreshAllAgentSessions,
    agentChatMessages: narrativeRuntime.agentMessages,
    agentChatInput: narrativeRuntime.agentInput,
    setAgentChatInput: narrativeRuntime.setAgentInput,
    submitAgentTurn: narrativeRuntime.submitAgentTurn,
    // run
    lastRun: narrativeRuntime.lastRun,
    // prompt
    promptPreview: narrativeRuntime.promptPreview, promptMessages, promptProjection,
    promptBuildTrace,
    providerPayloadPreview,
    activationControl,
    activationFacts,
    setActivationMode: (mode: ActivationControlState['mode']) => setActivationControl(current => ({ ...current, mode })),
    toggleActivationTag: toggleRuntimeTag,
    // gateway
    providerAccountDraft: providerSettings.providerAccountDraft,
    aiProviders: providerSettings.aiProviders,
    aiCapabilityProfiles: providerSettings.aiCapabilityProfiles,
    setProviderAccountDraft: providerSettings.setProviderAccountDraft,
    selectedAgentProfileId: agentProfiles.selectedAgentProfileId,
    selectAgentProfile: agentProfiles.selectAgentProfile,
    // input
    input: narrativeRuntime.input, setInput: narrativeRuntime.setInput,
    // api & runtime
    api,
    // state
    operationPending: operations.pending,
    operationError: operations.error,
    promptResourceError: promptResourceState.error,
    promptResourceLoading: promptResourceState.loading,
    canUndoEdit: editHistory.canUndo,
    canRedoEdit: editHistory.canRedo,
    // custom css
    customCss, setCustomCss,
    // context assets
    promptResources,
    settingMounts,
    presetToolMounts,
    contextAssets: contextAssetState.nodes, setContextAssets: contextAssetState.setNodes,
    previewContextAsset: contextAssetState.previewContextAsset,
    updateContextAsset: contextAssetState.updateContextAsset,
    updateContextAssets: contextAssetState.updateContextAssets,
    moveContextAsset: contextAssetState.moveContextAsset,
    addContextAsset: contextAssetState.addContextAsset,
    addContextAssetFolder: contextAssetState.addContextAssetFolder,
    addContextAssetAnchor: contextAssetState.addContextAssetAnchor,
    addContextAssetMessageBlock: contextAssetState.addContextAssetMessageBlock,
    addContextAssetInZone: contextAssetState.addContextAssetInZone,
    duplicateContextAsset: contextAssetState.duplicateContextAsset,
    deleteContextAsset: contextAssetState.deleteContextAsset,
    ...promptResourceCommands,
    // derived
    ...derivedValues, refreshStates,
    // actions
    undoEdit,
    redoEdit,
    createCard: cardsState.createCard,
    updateCard: cardsState.updateCard,
    deleteCard: cardsState.deleteCard,
    deleteCards: cardsState.deleteCards,
    previewCardDeletion: cardsState.previewCardDeletion,
    createProviderAccount: providerSettings.createProviderAccount,
    createAiProviderAccount: providerSettings.createAiProviderAccount,
    createAiCapabilityProfile: providerSettings.createAiCapabilityProfile,
    updateAiProviderAccount: providerSettings.updateAiProviderAccount,
    updateAiCapabilityProfile: providerSettings.updateAiCapabilityProfile,
    createModelProfile: providerSettings.createModelProfile,
    createTimelineFromCard: narrativeRuntime.createTimelineFromCard,
    resetToDraftTimeline: narrativeRuntime.resetToDraftTimeline,
    activateTimeline: narrativeRuntime.activateTimeline,
    activateAgentSession: narrativeRuntime.activateAgentSession,
    deleteTimeline: narrativeRuntime.deleteTimeline,
    renameTimeline: narrativeRuntime.renameTimeline,
    deleteAgentSession: narrativeRuntime.deleteAgentSession,
    renameAgentSession: narrativeRuntime.renameAgentSession,
    submitTurn: narrativeRuntime.submitTurn,
    previewPrompt: narrativeRuntime.previewPrompt,
    forkFromNode: narrativeRuntime.forkFromNode,
    switchBranch: narrativeRuntime.switchBranch,
    loadOlderNodes: narrativeRuntime.loadOlderNodes,
    refreshCards: cardsState.refreshCards,
    refreshCardTimelines: narrativeRuntime.refreshCardTimelines,
    // provider management
    providerAccounts: providerSettings.providerAccounts,
    providerAccountsLoaded: providerSettings.providerAccountsLoaded,
    modelProfiles: providerSettings.modelProfiles,
    agentProfiles: agentProfiles.agentProfiles,
    agentTools: agentProfiles.tools,
    presets: agentProfiles.presets,
    refreshProviderAccounts: providerSettings.refreshProviderAccounts,
    refreshAiProviders: providerSettings.refreshAiProviders,
    refreshModelProfiles: providerSettings.refreshModelProfiles,
    updateProviderAccount: providerSettings.updateProviderAccount,
    updateProviderConnection: providerSettings.updateProviderConnection,
    deleteProviderAccount: providerSettings.deleteProviderAccount,
    updateModelProfile: providerSettings.updateModelProfile,
    deleteModelProfile: providerSettings.deleteModelProfile,
    listProviderModels: providerSettings.listProviderModels,
    invokeAiCapability: providerSettings.invokeAiCapability,
    pingModelProfile: providerSettings.pingModelProfile,
    createAgentProfile: agentProfiles.createAgentProfile,
    updateAgentProfile: agentProfiles.updateAgentProfile,
    updateAgentTool: agentProfiles.updateAgentTool,
    deleteAgentProfile: agentProfiles.deleteAgentProfile,
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
