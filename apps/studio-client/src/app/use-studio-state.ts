import { usePromptResourceWorkspace } from '../features/prompt-resources/model/use-prompt-resource-workspace.js'
import { useAgentTools } from '../features/agent-presets/model/use-agent-tools.js'
import { useUserProfilesQuery } from '../features/user-profiles/model/use-user-profiles-query.js'
import { usePlayerProfileQuery } from '../features/user-profiles/model/use-player-profile-query.js'
import { useNewStoryExtensions } from '../features/extension-renderers/ui/new-story-extensions.js'
import { readStudioLocale, saveStudioLocale } from '../features/onboarding/model/onboarding-preferences.js'
import { createStudioTrpcClient } from '../shared/api/trpc-client.js'
import type { Logger } from '@loom-studio/logging'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createTranslator, loadLocale, type Locale } from '../shared/i18n/index.js'
import { notify } from '../shared/notifications/index.js'
import { createStudioApi, type NetworkSettings } from '../shared/api/studio-api.js'
import { useAsyncOperations } from '../shared/hooks/use-async-operations.js'
import { useCards } from '../features/cards/model/use-cards.js'
import { useEditHistory } from '../features/edit-history/model/use-edit-history.js'
import { findContextAssetNode } from '../features/prompt-resources/model/context-asset-tree.js'
import { createActivationFacts, toggleActivationTag, type ActivationControlState, type ActivationTag } from '../features/prompt-build/model/activation-control.js'
import { useMacroPreview } from '../features/prompt-build/model/use-macro-preview.js'
import { useMacroSelection } from '../features/prompt-build/model/use-macro-selection.js'
import { useProviderSettings } from '../features/provider-settings/model/use-provider-settings.js'
import { useNarrativeRuntime } from '../features/narrative-runtime/model/use-narrative-runtime.js'
import { useExtensionResourceCommands } from '../features/extension-renderers/model/use-extension-resource-commands.js'
import { usePromptResourceCommands } from '../features/prompt-resources/model/use-prompt-resource-commands.js'
import type { ContextAssetNode } from '../entities/index.js'
import { useStudioStartup } from './use-studio-startup.js'
import { useStudioDerivedValues } from './use-studio-derived-values.js'
import { useThemeStore } from '../features/themes/model/theme-store.js'

export type HistoryAssetTarget = {
  assetId: string
  layoutId: 'preset' | 'resources'
}

export function useStudioState(transportLogger: Logger, runtimeLogger?: Logger) {
  const [locale, updateLocale] = useState<Locale>(readStudioLocale)
  function setLocale(next: Locale) {
    void operations.runLatest('settings', async ({ isCurrent }) => {
      await loadLocale(next)
      if (!isCurrent()) return
      saveStudioLocale(next)
      updateLocale(next)
    })
  }
  const t = useMemo(() => createTranslator(locale), [locale])
  const [endpoint, setEndpoint] = useState('/trpc')
  const customCss = useThemeStore(state => state.customCss)
  const setCustomCss = useThemeStore(state => state.setCustomCss)
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>({
    proxyMode: 'system',
    systemProxyDetected: false,
  })
  const [activationControl, setActivationControl] = useState<ActivationControlState>({
    mode: 'draft',
    tags: [],
  })
  const operations = useAsyncOperations()
  const trpc = useMemo(() => createStudioTrpcClient({ endpoint, logger: transportLogger }), [endpoint, transportLogger])
  const api = useMemo(() => createStudioApi(trpc), [trpc])
  const userProfilesQuery = useUserProfilesQuery(api.userProfiles, endpoint)
  const userConfig = userProfilesQuery.data?.config
  const selectedUser = userConfig?.profiles.find(profile => profile.id === userConfig.currentProfileId)
  const templateUserIdentity = {
    name: selectedUser?.name.trim() || 'User',
    ...(selectedUser?.avatarAssetId ? { avatarUrl: `/assets/${encodeURIComponent(selectedUser.avatarAssetId)}` } : {}),
  }

  const apiRef = useRef<typeof api | undefined>(api)
  apiRef.current = api
  const clientExtensionApi = useMemo(() => ({
    extensions: api.extensions,
    extensionRuntime: api.extensionRuntime,
    states: api.states,
    timelineExtensions: api.timelineExtensions,
    extensionInstallations: api.extensionInstallations,
    textTransforms: api.textTransforms,
  }), [api])
  const editHistory = useEditHistory({ revertChangeset: api.history.revert })
  const { state: promptResourceState, contextAssetState, presetSelection } = usePromptResourceWorkspace({
    api, endpoint, recordEdit: editHistory.record,
    runAction: action => operations.run('mutation', action).then(() => undefined), t,
  })
  const {
    presetToolMounts,
    promptResources,
    refreshPresetToolMounts,
    refreshPromptResourceLibrary,
    refreshPromptResource,
    refreshLoreMounts,
    setPresetToolMounts,
    setPromptResources,
    setLoreMounts,
    loreMounts,
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
  const providerSettings = useProviderSettings({
    api, endpoint,
    initialProviderAccountDraft: {
      displayName: '',
      baseUrl: '',
      apiKey: '',
    },
    runAction: action => operations.run('provider-settings', action).then(() => undefined),
  })
  const agentTools = useAgentTools({ api, endpoint, runAction: action => operations.run('agent-presets', action).then(() => undefined) })
  const agentPresets = { ...presetSelection, ...agentTools }
  const selectedAgentPreset = agentPresets.agentPresets.find(profile => profile.id === agentPresets.selectedAgentPresetId)
  const activationFacts = useMemo(() => createActivationFacts(activationControl), [activationControl])
  const newStoryExtensions = useNewStoryExtensions(api, t)
  const narrativeRuntime = useNarrativeRuntime({
    chooseStoryExtensions: newStoryExtensions.choose,
    activationFacts,
    getMacroSelections: (timelineId, branchId) => macroSelection.getSelections(timelineId, branchId),
    api,
    storageScope: endpoint,
    initialInput: '',
    initialNodes: [],
    selectedCard: cardsState.selectedCardDetails,
    selectedCardId: cardsState.selectedCardId,
    onSelectCard: cardsState.setSelectedCardId,
    selectedAgentPresetId: agentPresets.selectedAgentPresetId,
    onSelectAgentPreset: agentPresets.selectAgentPreset,
    runAgentAction: action => operations.runReported('agent-chat', action).then(() => undefined),
    runAction: async action => {
      let completed = false
      await operations.runReported('session', async () => {
        await action()
        completed = true
      })
      return completed
    },
    runLatestAction: action => operations.runLatest('session', action).then(() => undefined),
    t,
    logger: runtimeLogger ?? transportLogger,
  })

  const playerProfileQuery = usePlayerProfileQuery(api.states, endpoint,
    narrativeRuntime.timeline && narrativeRuntime.branch
      ? { scope: 'timeline', timelineId: narrativeRuntime.timeline.id, branchId: narrativeRuntime.branch.id } : undefined,
    narrativeRuntime.branch?.stateHeadRevisionId)
  const storyUser = narrativeRuntime.timeline
    ? playerProfileQuery.isSuccess ? playerProfileQuery.data.playerProfile ?? selectedUser : undefined
    : selectedUser
  const userIdentity = {
    name: storyUser?.name.trim() || 'User',
    ...(storyUser?.avatarAssetId ? { avatarUrl: `/assets/${encodeURIComponent(storyUser.avatarAssetId)}` } : {}),
  }
  const agentUserIdentity = narrativeRuntime.agentSession?.timelineId ? userIdentity : templateUserIdentity
  const userMacroValues = useMemo(() => ({ name: storyUser?.name.trim() || 'User', description: storyUser?.description ?? '' }), [storyUser])

  async function refreshResourceConsumers(): Promise<void> {
    await Promise.all([
      refreshPromptResourceLibrary(),
      refreshLoreMounts(),
      refreshPresetToolMounts(),
      agentPresets.refreshAgentTools(),
    ])
  }

  const extensionResourceCommands = useExtensionResourceCommands({
    api,
    refreshCards: cardsState.refreshCards,
    refreshCardTimelines: narrativeRuntime.refreshCardTimelines,
    refreshDependentData: refreshResourceConsumers,
    selectedCardId: cardsState.selectedCardId,
  })

  useEffect(() => {
    apiRef.current = api
    editHistory.clear()
    return () => { if (apiRef.current === api) apiRef.current = undefined }
  }, [api])
  const startup = useStudioStartup({
    source: api,
    cards: cardsState.refreshCards,
    sessions: narrativeRuntime.refreshAllAgentSessions,
    providers: providerSettings.refreshProviderSettings,
    tools: agentPresets.refreshAgentTools,
    network: async () => {
      const settings = await api.settings.getNetwork()
      if (apiRef.current === api) setNetworkSettings(settings)
    },
  })

  const macroSelection = useMacroSelection({
    api: api.macros, endpoint, cardId: cardsState.selectedCardId,
    presetId: narrativeRuntime.primarySession?.agentPresetId, timelineId: narrativeRuntime.timeline?.id,
  })
  const macroKey = macroSelection.targetKey(narrativeRuntime.timeline?.id, narrativeRuntime.branch?.id)
  const macroPreviewKey = `${macroKey}:user:${userConfig?.version ?? 'loading'}`
  const macroSelections = macroSelection.readSelections(macroKey)
  const macroPreviewState = useMacroPreview({
    api: api.macros,
    ready: !userProfilesQuery.isPending && (promptResourceState.resourcesReady || Boolean(promptResourceState.resourcesError)),
    branchId: narrativeRuntime.branch?.id,
    cardId: cardsState.selectedCardId,
    cardVersion: cardsState.selectedCardDetails?.version,
    key: macroPreviewKey,
    lastRunId: narrativeRuntime.lastRun?.runId,
    presetId: narrativeRuntime.primarySession?.agentPresetId,
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
    loreMounts,
    presetToolMounts,
    setPromptResources,
    setLoreMounts,
    setPresetToolMounts,
    invalidatePromptResourceState: promptResourceState.invalidate,
    refreshCards: cardsState.refreshCards,
    refreshCardTimelines: narrativeRuntime.refreshCardTimelines,
    selectedCardId: cardsState.selectedCardId,
  })

  async function refreshStates() {
    macroPreviewState.refresh()
    if (narrativeRuntime.timeline) await playerProfileQuery.refetch()
  }

  const sessionBusy = operations.isPending('session')
  const promptMessages = narrativeRuntime.promptPreview?.messages
  const promptProjection = narrativeRuntime.promptPreview?.projection ?? narrativeRuntime.lastRun?.projection
  const promptBuildTrace = narrativeRuntime.promptPreview?.promptBuildTrace ?? narrativeRuntime.lastRun?.promptBuildTrace
  const providerPayloadPreview = narrativeRuntime.promptPreview?.providerPayloadPreview
  const derivedValues = useStudioDerivedValues({
    t,
    timeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    selectedCard: cardsState.selectedCardDetails,
    selectedCardDetails: cardsState.selectedCardDetails,
    openingChoice: narrativeRuntime.openingChoice,
    nodes: narrativeRuntime.nodes,
    narrativeInput: narrativeRuntime.input,
    promptMessages,
    promptProjection,
    activationFacts,
    sessionBusy,
    agentSessionReady: narrativeRuntime.agentSessionReady,
    agentInput: narrativeRuntime.agentInput,
    selectedAgentPreset,
    primarySession: narrativeRuntime.primarySession,
    agentSession: narrativeRuntime.agentSession,
    agentChatBusy: operations.isPending('agent-chat'),
    macroPreview,
    macroKey: macroPreviewKey,
    user: userMacroValues,
    macroInspection: narrativeRuntime.promptPreview?.macroInspection ?? narrativeRuntime.lastRun?.macroInspection,
    macroContextCard: cardsState.selectedCardDetails,
  })

  function toggleRuntimeTag(tag: ActivationTag) {
    setActivationControl(current => ({
      ...current,
      tags: toggleActivationTag(current.tags, tag),
    }))
  }

  async function undoEdit(canNavigate: () => boolean) {
    return operations.runReported('mutation', async () => {
      const entry = await editHistory.undo()
      if (!entry) return
      return refreshHistoryAnchor(entry, canNavigate)
    })
  }

  async function redoEdit(canNavigate: () => boolean) {
    return operations.runReported('mutation', async () => {
      const entry = await editHistory.redo()
      if (!entry) return
      return refreshHistoryAnchor(entry, canNavigate)
    })
  }

  async function updateNetworkSettings(next: { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string }) {
    if (!startup.ready('network')) return
    const updated = await operations.run('settings', () => api.settings.updateNetwork(next))
    if (updated && apiRef.current === api) {
      setNetworkSettings(updated)
      transportLogger.info('Network settings updated', {
        event: 'network.settings.updated',
        data: { proxyMode: next.proxyMode },
      })
      notify.success(t('notify.success.networkSaved'))
    } else {
      notify.error(t('notify.error.general'))
    }
  }

  async function refreshHistoryAnchor(entry: { anchor?: { documentId: string; subjectId?: string } }, canNavigate: () => boolean): Promise<HistoryAssetTarget | undefined> {
    if (!entry.anchor) return
    if (promptResources.some(resource => resource.id === entry.anchor?.documentId)) {
      const resource = await refreshPromptResource(entry.anchor.documentId)
      if (!resource || !canNavigate()) return
      const resources = [resource]
      const subjectId = entry.anchor.subjectId
      const contextAssets = resources.map(resource => resource.rootNode)
      return readHistoryAssetTarget(contextAssets, subjectId, resources[0]?.rootNode.id ?? '')
    }

    const cards = await cardsState.refreshCards()
    if (canNavigate() && cards.some(card => card.id === entry.anchor?.documentId)) {
      cardsState.setSelectedCardId(entry.anchor.documentId)
    }
  }

  return {
    startup,
    presetResourcesReady: promptResourceState.resourcesReady,
    retryPromptResources: () => Promise.all([refreshPromptResourceLibrary(), refreshLoreMounts(), refreshPresetToolMounts()]),
    // i18n
    locale, setLocale, t, localePending: operations.isPending('settings'),
    networkSettings,
    updateNetworkSettings,
    // bridge
    endpoint, setEndpoint,
    userIdentity,
    agentUserIdentity,
    hasTimelinePlayerProfile: Boolean(playerProfileQuery.isSuccess && playerProfileQuery.data.playerProfile),
    logsApi: api.logs,
    statesApi: api.states,
    textTransformsApi: api.textTransforms,
    clientExtensionApi,
    ...extensionResourceCommands,
    refreshResourceConsumers,
    refreshPromptResource,
    // cards
    cards: cardsState.cards,
    selectedCardId: cardsState.selectedCardId,
    setSelectedCardId: cardsState.setSelectedCardId,
    selectedCard: cardsState.selectedCard,
    selectedCardDetails: cardsState.selectedCardDetails,
    readCardDetails: cardsState.readCardDetails,
    updateCardMedia: cardsState.updateCardMedia,
    updateCardProfile: cardsState.updateCardProfile,
    updateCardStateConfig: cardsState.updateCardStateConfig,
    updateCardExtensionAdoptions: cardsState.updateCardExtensionAdoptions,
    updateCardMacros: cardsState.updateCardMacros,
    macroInspection: macroPreview.key === macroPreviewKey ? macroPreview.inspection : undefined,
    macroInspectionLoading: macroPreview.key !== macroPreviewKey || macroPreview.loading || macroSelection.loading,
    macroInspectionError: macroSelection.readError(macroKey) ?? (macroPreview.key === macroPreviewKey ? macroPreview.error : undefined),
    macroSelections,
    macroTargetKey: macroKey,
    selectMacroSource: (name: string, sourceId: import('@loom-studio/shared').MacroSelection | undefined) => { void macroSelection.selectSource(macroKey, name, sourceId) },
    refreshMacros: () => { void macroSelection.refresh().then(macroPreviewState.refresh) },
    replaceCardPromptResources: async (cardId: string, resourceIds: string[], expectedVersion: number) => {
      await cardsState.replaceCardPromptResources(cardId, resourceIds, expectedVersion)
      await promptResourceState.invalidate({ bindings: true })
    },
    attachCardExtensionPackage: cardsState.attachExtensionPackage,
    detachCardExtensionPackage: cardsState.detachExtensionPackage,
    importCards: cardsState.importCards,
    exportCard: cardsState.exportCard,
    forkCard: cardsState.forkCard,
    directoryApi: cardsState.directoryApi,
    // narrative
    narrativeTimeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    branches: narrativeRuntime.branches,
    cardTimelines: narrativeRuntime.cardTimelines,
    allTimelines: narrativeRuntime.allTimelines,
    refreshAllTimelines: narrativeRuntime.refreshAllTimelines,
    narrativeNodes: narrativeRuntime.displayNodes,
    displayOnlyNarrativeNodeId: narrativeRuntime.displayOnlyNodeId,
    narrativeSwipe: narrativeRuntime.swipe,
    narrativeSwipeBusy: narrativeRuntime.swipeBusy,
    selectNarrativeSwipe: narrativeRuntime.selectSwipe,
    generateNarrativeSwipe: narrativeRuntime.generateSwipe,
    editNarrativeNode: narrativeRuntime.editNarrativeNode,
    deleteNarrativeNode: narrativeRuntime.deleteNarrativeNode,
    hasOlderNarrativeNodes: Boolean(narrativeRuntime.olderCursor),
    // agent
    agentMessages: narrativeRuntime.agentMessages,
    narrativeAgentSession: narrativeRuntime.primarySession,
    narrativeWorkEntries: narrativeRuntime.rootMessages,
    narrativeActiveRun: narrativeRuntime.rootActiveRun,
    narrativeConnecting: narrativeRuntime.rootConnecting,
    narrativeRecovery: narrativeRuntime.rootRecovery,
    reconnectNarrativeRun: narrativeRuntime.reconnectRootRun,
    pauseNarrativeRun: narrativeRuntime.pauseRootRun,
    resumeNarrativeRun: narrativeRuntime.resumeRootRun,
    abandonNarrativeRun: narrativeRuntime.abandonRootRun,
    approveNarrativeMutation: narrativeRuntime.approveRootMutation,
    configureNarrativeSession: narrativeRuntime.configureRoot,
    narrativeInputMode: narrativeRuntime.inputMode,
    setNarrativeInputMode: narrativeRuntime.setInputMode,
    agentChatSession: narrativeRuntime.agentSession,
    agentChatSessions: narrativeRuntime.agentSessions,
    allAgentSessions: narrativeRuntime.allAgentSessions,
    agentChatSessionReady: narrativeRuntime.agentSessionReady,
    agentActiveRun: narrativeRuntime.activeAgentRun,
    runRecovery: narrativeRuntime.runRecovery,
    runRecoveryBusy: narrativeRuntime.runRecoveryBusy,
    canRestoreRunInput: narrativeRuntime.canRestoreRunInput,
    reconnectAgentRun: narrativeRuntime.reconnectAgentRun,
    observeTaskRun: narrativeRuntime.observeTaskRun,
    refreshTaskSession: narrativeRuntime.refreshTaskSession,
    abandonAgentRun: narrativeRuntime.abandonAgentRun,
    restoreRunInput: narrativeRuntime.restoreRunInput,
    retryNarrativeInput: narrativeRuntime.retryNarrativeInput,
    retryDiscussionInput: narrativeRuntime.retryDiscussionInput,
    reviseUserInput: narrativeRuntime.reviseUserInput,
    canRetryNarrativeInput: narrativeRuntime.canRetryNarrativeInput,
    cancelAgentRun: narrativeRuntime.cancelAgentRun,
    pauseAgentRun: narrativeRuntime.pauseAgentRun,
    resumeAgentRun: narrativeRuntime.resumeAgentRun,
    approveAgentMutation: narrativeRuntime.approveAgentMutation,
    agentChatSessionLoading: narrativeRuntime.agentSessionLoading,
    newAgentSession: narrativeRuntime.newAgentSession,
    createAgentSession: (...args: Parameters<typeof narrativeRuntime.createAgentSession>) => {
      if (!promptResourceState.resourcesReady || !promptResourceState.readResources().some(resource => resource.resourceKind === 'preset' && resource.id === args[0])) return Promise.resolve(undefined)
      return narrativeRuntime.createAgentSession(...args)
    },
    setPrimaryAgentSession: narrativeRuntime.setPrimaryAgentSession,
    refreshAgentSessions: narrativeRuntime.refreshAgentSessions,
    refreshAllAgentSessions: narrativeRuntime.refreshAllAgentSessions,
    agentChatMessages: narrativeRuntime.agentMessages,
    agentChatInput: narrativeRuntime.agentInput,
    agentAttachments: narrativeRuntime.agentAttachments,
    narrativeAttachments: narrativeRuntime.narrativeAttachments,
    setAgentChatInput: narrativeRuntime.setAgentInput,
    submitAgentTurn: (event: Parameters<typeof narrativeRuntime.submitAgentTurn>[0]) => {
      if (!narrativeRuntime.agentSession && (!promptResourceState.resourcesReady || !selectedAgentPreset)) { event.preventDefault(); return Promise.resolve() }
      return narrativeRuntime.submitAgentTurn(event)
    },
    // run
    lastRun: narrativeRuntime.lastRun,
    // prompt
    promptPreview: narrativeRuntime.promptPreview, promptMessages, promptProjection,
    promptBuildTrace,
    providerPayloadPreview,
    tokenEstimate: narrativeRuntime.promptPreview?.tokenEstimate,
    activationControl,
    activationFacts,
    setActivationMode: (mode: ActivationControlState['mode']) => setActivationControl(current => ({ ...current, mode })),
    toggleActivationTag: toggleRuntimeTag,
    // gateway
    providerAccountDraft: providerSettings.providerAccountDraft,
    aiProviders: providerSettings.aiProviders,
    aiCapabilityProfiles: providerSettings.aiCapabilityProfiles,
    setProviderAccountDraft: providerSettings.setProviderAccountDraft,
    selectedAgentPresetId: (promptResourceState.resourcesReady ? agentPresets.selectedAgentPresetId : undefined) ?? narrativeRuntime.agentSession?.agentPresetId,
    selectAgentPreset: narrativeRuntime.selectAgentPreset,
    // input
    input: narrativeRuntime.input, setInput: narrativeRuntime.setInput,
    // api & runtime
    api,
    // state
    operationPending: operations.pending,
    operationError: operations.error,
    promptResourceError: promptResourceState.error,
    invalidPromptResources: promptResourceState.invalidPromptResources,
    promptResourceLoading: promptResourceState.loading,
    canUndoEdit: editHistory.canUndo,
    canRedoEdit: editHistory.canRedo,
    // custom css
    customCss, setCustomCss,
    // context assets
    promptResources,
    loreMounts,
    presetToolMounts,
    contextAssets: contextAssetState.nodes,
    promptResourceDrafts: contextAssetState.resources,
    extensionInstallations: promptResourceState.extensionInstallations,
    draftResourceIds: contextAssetState.failedDraftResourceIds,
    discardContextAssetDraft: contextAssetState.discardDraft,
    retryContextAssetDraft: contextAssetState.retryDraft,
    previewContextAsset: contextAssetState.previewContextAsset,
    updateContextAsset: contextAssetState.updateContextAsset,
    updateContextAssets: contextAssetState.updateContextAssets,
    moveContextAsset: contextAssetState.moveContextAsset,
    addContextAsset: contextAssetState.addContextAsset,
    addContextAssetFolder: contextAssetState.addContextAssetFolder,
    addContextAssetAnchor: contextAssetState.addContextAssetAnchor,
    addContextAssetMessageBlock: contextAssetState.addContextAssetMessageBlock,
    addContextAssetMessageSequence: contextAssetState.addContextAssetMessageSequence,
    addContextAssetInZone: contextAssetState.addContextAssetInZone,
    duplicateContextAsset: contextAssetState.duplicateContextAsset,
    deleteContextAsset: contextAssetState.deleteContextAsset,
    ...promptResourceCommands,
    // derived
    ...derivedValues,
    canSend: Boolean(narrativeRuntime.timeline && narrativeRuntime.branch) && (Boolean(narrativeRuntime.input.trim()) || narrativeRuntime.narrativeAttachments.values.length > 0) && narrativeRuntime.narrativeAttachments.ready && !narrativeRuntime.openingChanged && Boolean(narrativeRuntime.primarySession?.agentPresetId),
    canSendAgent: derivedValues.canSendAgent && Boolean(narrativeRuntime.agentSession || (promptResourceState.resourcesReady && selectedAgentPreset)),
    refreshStates,
    // actions
    undoEdit,
    redoEdit,
    createCard: cardsState.createCard,
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
    newStoryExtensionsDialog: newStoryExtensions.dialog,
    openingChoice: narrativeRuntime.openingChoice,
    setOpeningChoice: narrativeRuntime.setOpeningChoice,
    replaceOpening: narrativeRuntime.replaceOpening,
    resetToDraftTimeline: narrativeRuntime.resetToDraftTimeline,
    activateTimeline: narrativeRuntime.activateTimeline,
    selectCardTimeline: narrativeRuntime.selectCardTimeline,
    activateAgentSession: narrativeRuntime.activateAgentSession,
    deleteTimeline: narrativeRuntime.deleteTimeline,
    renameTimeline: narrativeRuntime.renameTimeline,
    deleteAgentSession: narrativeRuntime.deleteAgentSession,
    renameAgentSession: narrativeRuntime.renameAgentSession,
    submitTurn: narrativeRuntime.submitTurn,
    sendDiscussionInput: narrativeRuntime.sendDiscussionInput,
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
    agentPresets: promptResourceState.resourcesReady ? agentPresets.agentPresets : [],
    agentTools: agentPresets.tools,
    presets: agentPresets.agentPresets,
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
    updateAgentTool: agentPresets.updateAgentTool,
  }
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
