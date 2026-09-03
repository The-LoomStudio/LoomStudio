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
import { buildPromptBuildSteps } from '../features/prompt-build/model/build-prompt-build-steps.js'
import { useProviderSettings } from '../features/provider-settings/model/use-provider-settings.js'
import { useAgentProfiles } from '../features/agent-profiles/model/use-agent-profiles.js'
import { useNarrativeRuntime } from '../features/narrative-runtime/model/use-narrative-runtime.js'
import type { ContextAssetNode, PresetToolMount, PresetToolMountInput, PromptResource, PromptResourceArtifact, SettingMount, SettingMountSource } from '../entities/index.js'
import { readEmptyTimelineText } from './utils.js'

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
  const [promptResources, setPromptResources] = useState<PromptResource[]>([])
  const [settingMounts, setSettingMounts] = useState<SettingMount[]>([])
  const [presetToolMounts, setPresetToolMounts] = useState<PresetToolMount[]>([])
  const cardsState = useCards({
    api,
    initialCardName: '',
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
  const activationFacts = useMemo(() => createActivationFacts(activationControl), [activationControl])
  const narrativeRuntime = useNarrativeRuntime({
    activationFacts,
    api,
    initialInput: '我看向柜台后的铃铛。',
    initialNodes: [],
    selectedCard: cardsState.selectedCardDetails,
    selectedCardId: cardsState.selectedCardId,
    selectedAgentProfileId: agentProfiles.selectedAgentProfileId,
    runAgentAction: action => operations.run('agent-chat', action).then(() => undefined),
    runAction: action => operations.run('session', action).then(() => undefined),
    runLatestAction: action => operations.runLatest('session', action).then(() => undefined),
  })

  function applyPromptResourceLibrary(resources: PromptResource[]) {
    setPromptResources(resources)
    contextAssetState.setNodes(normalizeContextAssets(resources.map(resource => resource.rootNode)))
  }

  async function refreshPromptResourceLibrary(): Promise<PromptResource[]> {
    const resources = (await api.promptResources.list()).resources
    applyPromptResourceLibrary(resources)
    return resources
  }

  async function refreshSettingMounts(): Promise<SettingMount[]> {
    const mounts = (await api.promptResources.listSettingMounts()).mounts
    setSettingMounts(mounts)
    return mounts
  }

  async function refreshPresetToolMounts(): Promise<PresetToolMount[]> {
    const mounts = (await api.promptResources.listPresetToolMounts()).mounts
    setPresetToolMounts(mounts)
    return mounts
  }

  async function importExtensionPackageResources(packageId: string) {
    const result = await api.extensions.importResources(packageId)
    await Promise.all([
      refreshPromptResourceLibrary(),
      refreshSettingMounts(),
      refreshPresetToolMounts(),
      agentProfiles.refreshAgentProfiles(),
    ])
    return result
  }

  async function removeExtensionPackageResources(packageId: string) {
    const result = await api.extensions.removeResources(packageId)
    await Promise.all([
      refreshPromptResourceLibrary(),
      refreshSettingMounts(),
      refreshPresetToolMounts(),
      agentProfiles.refreshAgentProfiles(),
      cardsState.refreshCards(),
      cardsState.selectedCardId ? narrativeRuntime.refreshCardTimelines(cardsState.selectedCardId) : Promise.resolve([]),
    ])
    return result
  }

  useEffect(() => {
    editHistory.clear()
    void operations.run('bootstrap', async () => {
      const cards = await cardsState.refreshCards()
      const selectedCardId = cards[0]?.id

      if (selectedCardId) cardsState.setSelectedCardId(selectedCardId)
      await Promise.all([refreshPromptResourceLibrary(), refreshSettingMounts(), refreshPresetToolMounts()])
      await providerSettings.refreshProviderSettings()
      await agentProfiles.refreshAgentProfiles()
      setNetworkSettings(await api.settings.getNetwork())
    })
  }, [observedBridge])

  useEffect(() => {
    if (!cardsState.selectedCardId) return
    void narrativeRuntime.refreshCardTimelines(cardsState.selectedCardId)
  }, [api, cardsState.selectedCardId])

  // 派生计算
  const sessionBusy = operations.isPending('session')
  const canSend = Boolean(((narrativeRuntime.timeline && narrativeRuntime.branch) || cardsState.selectedCardId) && agentProfiles.selectedAgentProfileId)
    && !sessionBusy
    && !operations.isPending('agent-chat')
    && narrativeRuntime.input.trim().length > 0
  const canPreviewPrompt = canSend
  const canSendAgent = Boolean(selectedAgentProfile)
    && narrativeRuntime.agentInput.trim().length > 0
    && !operations.isPending('agent-chat')
    && !sessionBusy
  const emptyTimelineText = readEmptyTimelineText({ timeline: narrativeRuntime.timeline, branch: narrativeRuntime.branch }, t)
  const cardOpeningEntry = cardsState.selectedCardDetails?.opening?.entries?.[0]?.content?.trim()
  const openingDraft = cardsState.selectedCardDetails ? {
    content: cardOpeningEntry && cardOpeningEntry.length > 0
      ? cardOpeningEntry
      : t('timeline.opening.placeholder'),
    isPlaceholder: !cardOpeningEntry || cardOpeningEntry.length === 0,
  } : undefined
  const promptMessages = narrativeRuntime.promptPreview?.messages
  const promptProjection = narrativeRuntime.promptPreview?.projection ?? narrativeRuntime.lastRun?.projection
  const promptBuildTrace = undefined
  const providerPayloadPreview = narrativeRuntime.promptPreview?.providerPayloadPreview
  const promptBuildSteps = buildPromptBuildSteps({
    card: cardsState.selectedCardDetails,
    timeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    nodes: narrativeRuntime.nodes,
    input: narrativeRuntime.input,
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

  async function updateNetworkSettings(next: { proxyMode: NetworkSettings['proxyMode']; proxyUrl?: string }) {
    const updated = await operations.run('settings', () => api.settings.updateNetwork(next))
    if (updated) setNetworkSettings(updated)
  }

  async function updateCardStateConfig(input: {
    stateDefinitionIds: string[]
    timelineStateBindings: NonNullable<NonNullable<typeof cardsState.selectedCardDetails>['timelineStateBindings']>
  }) {
    const card = cardsState.selectedCardDetails
    if (!card) return
    await operations.run('mutation', async () => {
      const result = await api.cards.update({ cardId: card.id, ...input })
      editHistory.record({
        label: 'Update Card State Config',
        changesetId: result.mutation.changesetId,
        anchor: { documentId: card.id },
      })
      await cardsState.refreshCards()
    })
  }

  async function createPromptResource(resourceKind: PromptResource['resourceKind']): Promise<string | undefined> {
    let resourceId: string | undefined
    await operations.run('mutation', async () => {
      const result = await api.promptResources.create({
        resourceKind,
        name: resourceKind === 'preset' ? 'New Preset' : resourceKind === 'setting' ? 'New Setting Layer' : 'New Prompt Resource',
      })
      editHistory.record({
        label: t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      resourceId = result.resource.id
      await refreshPromptResourceLibrary()
    })
    return resourceId
  }

  async function duplicatePromptResource(resourceId: string): Promise<string | undefined> {
    let duplicatedId: string | undefined
    await operations.run('mutation', async () => {
      const result = await api.promptResources.duplicate({ resourceId })
      editHistory.record({
        label: t('history.context.duplicate'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      duplicatedId = result.resource.id
      await Promise.all([refreshPromptResourceLibrary(), refreshSettingMounts(), refreshPresetToolMounts()])
    })
    return duplicatedId
  }

  async function deletePromptResource(resourceId: string): Promise<void> {
    await operations.run('mutation', async () => {
      await api.promptResources.delete(resourceId)
      await Promise.all([refreshPromptResourceLibrary(), refreshSettingMounts(), refreshPresetToolMounts()])
      await Promise.all([
        cardsState.refreshCards(),
        agentProfiles.refreshAgentProfiles(),
        cardsState.selectedCardId ? narrativeRuntime.refreshCardTimelines(cardsState.selectedCardId) : Promise.resolve(),
      ])
    })
  }

  async function replaceSettingMounts(source: SettingMountSource, settingResourceIds: string[]): Promise<void> {
    await operations.run('mutation', async () => {
      const result = await api.promptResources.replaceSettingMounts({ source, settingResourceIds })
      setSettingMounts(current => [
        ...current.filter(mount => mount.source.kind !== source.kind || (source.kind === 'preset' ? mount.source.id !== source.id : mount.source.id !== (source.id ?? 'global'))),
        ...result.mounts,
      ])
      await agentProfiles.refreshAgentProfiles()
    })
  }

  async function replacePresetToolMounts(presetId: string, mounts: PresetToolMountInput[]): Promise<void> {
    await operations.run('mutation', async () => {
      const result = await api.promptResources.replacePresetToolMounts({ presetId, mounts })
      setPresetToolMounts(current => [
        ...current.filter(mount => mount.presetResourceId !== presetId),
        ...result.mounts,
      ])
      await agentProfiles.refreshAgentProfiles()
    })
  }

  async function importPromptResource(file: File): Promise<string | undefined> {
    let resourceId: string | undefined
    await operations.run('mutation', async () => {
      let artifact: PromptResourceArtifact
      try {
        artifact = JSON.parse(await file.text()) as PromptResourceArtifact
      } catch {
        throw new Error('Prompt Resource import must be valid JSON')
      }
      const result = await api.promptResources.import(artifact)
      resourceId = result.resource.id
      editHistory.record({
        label: t('history.context.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.resource.id, subjectId: result.resource.rootNode.id },
      })
      await refreshPromptResourceLibrary()
    })
    return resourceId
  }

  async function exportPromptResource(resourceId: string): Promise<void> {
    const resource = promptResources.find(item => item.id === resourceId)
    if (!resource) return
    const result = await api.promptResources.export(resourceId)
    const blob = new Blob([JSON.stringify(result.artifact, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${sanitizePromptResourceFileName(resource.rootNode.label)}.loomresource.json`
    anchor.click()
    URL.revokeObjectURL(url)
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
    importExtensionPackageResources,
    removeExtensionPackageResources,
    // cards
    cards: cardsState.cards,
    selectedCardId: cardsState.selectedCardId,
    setSelectedCardId: cardsState.setSelectedCardId,
    cardDraft: cardsState.cardDraft,
    setCardDraft: cardsState.setCardDraft,
    selectedCard: cardsState.selectedCard,
    selectedCardDetails: cardsState.selectedCardDetails,
    updateCardMedia: cardsState.updateCardMedia,
    updateCardStateConfig,
    replaceCardPromptResources: cardsState.replaceCardPromptResources,
    importCards: cardsState.importCards,
    exportCard: cardsState.exportCard,
    // narrative
    narrativeTimeline: narrativeRuntime.timeline,
    branch: narrativeRuntime.branch,
    branches: narrativeRuntime.branches,
    cardTimelines: narrativeRuntime.cardTimelines,
    narrativeNodes: narrativeRuntime.nodes,
    editNarrativeNode: narrativeRuntime.editNarrativeNode,
    hasOlderNarrativeNodes: Boolean(narrativeRuntime.olderCursor),
    // agent
    agentMessages: narrativeRuntime.agentMessages,
    narrativeAgentSession: narrativeRuntime.agentSession,
    agentChatSession: narrativeRuntime.agentSession,
    agentChatMessages: narrativeRuntime.agentMessages,
    agentChatInput: narrativeRuntime.agentInput,
    setAgentChatInput: narrativeRuntime.setAgentInput,
    submitAgentTurn: narrativeRuntime.submitAgentTurn,
    // run
    lastRun: narrativeRuntime.lastRun,
    // prompt
    promptPreview: narrativeRuntime.promptPreview, promptMessages, promptProjection, promptBuildSteps,
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
    // state
    operationPending: operations.pending,
    operationError: operations.error,
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
    createPromptResource,
    duplicatePromptResource,
    deletePromptResource,
    importPromptResource,
    exportPromptResource,
    replaceSettingMounts,
    replacePresetToolMounts,
    // derived
    canSend, canSendAgent, canPreviewPrompt, emptyTimelineText, openingDraft,
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

function sanitizePromptResourceFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ') || 'prompt-resource'
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
