import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { LogLevel, LogPage } from '@loom-studio/logging'
import type {
  AgentTranscriptPage,
  AgentToolDefinition,
  AgentSession,
  CardBundleArtifact,
  CardMedia,
  CardPresetInput,
  ContextAssetNode,
  CreateAgentProfileResult,
  CreateAgentSessionResult,
  CreateCardResult,
  CreateNarrativeTimelineResult,
  CreatePromptResourceResult,
  CreateProviderProfileResult,
  DeleteAgentProfileResult,
  DeleteCardResult,
  DeletePromptResourceResult,
  DeleteProviderProfileResult,
  ExportCardBundleResult,
  ExportPromptResourceResult,
  ForkNarrativeBranchResult,
  GetCardResult,
  GetImportBundleResult,
  GetNarrativeTimelineResult,
  GetPromptResourceResult,
  ImportCardBundleResult,
  InvokeAgentTurnResult,
  ListAgentProfilesResult,
  ListCardPromptResourcesResult,
  ListCardsResult,
  ListNarrativeTimelinesResult,
  ListPromptResourcesResult,
  ListPresetToolMountsResult,
  ListProviderProfilesResult,
  ListSettingMountsResult,
  MutationReceipt,
  NarrativePage,
  OpeningChatInput,
  PreviewAgentTurnResult,
  ProjectionSlotRank,
  PromptCompositionCapabilities,
  PromptResource,
  PromptResourceArtifact,
  PresetToolMountInput,
  ProviderModelSelection,
  ReplaceSettingMountsResult,
  ReplacePresetToolMountsResult,
  SettingLayerInput,
  SettingMountSource,
  SwitchNarrativeBranchResult,
  UpdateAgentProfileResult,
  UpdateCardResult,
  UpdatePromptResourceResult,
  UpdateProviderProfileResult,
} from '../../entities/index.js'

export type LogsListInput = {
  cursor?: string
  limit?: number
  levels?: LogLevel[]
  namespacePrefix?: string
  service?: string
  instanceId?: string
  since?: string
  until?: string
}

export type NetworkProxyMode = 'system' | 'direct' | 'manual'

export type NetworkSettings = {
  proxyMode: NetworkProxyMode
  proxyUrl?: string
  systemProxyDetected: boolean
}

// ─── Card DTOs ──────────────────────────────────────────────────────────────

export type CreateCardInput = {
  name: string
  userName?: string
  description?: string
  preset?: CardPresetInput | string
  opening?: OpeningChatInput | string
  settingLayer?: SettingLayerInput
  media?: CardMedia
  promptResourceIds?: string[]
}

export type UpdateCardInput = {
  cardId: string
  name?: string
  userName?: string
  description?: string
  preset?: CardPresetInput | string
  opening?: OpeningChatInput | string
  settingLayer?: SettingLayerInput
  media?: CardMedia
  promptResourceIds?: string[]
}

export type UpdateCardPromptResourcesInput = {
  cardId: string
  promptResourceIds: string[]
}

// ─── Agent Session DTOs ─────────────────────────────────────────────────────

export type CreateAgentSessionInput = {
  agentProfileId: string
  title?: string
}

export type InvokeAgentTurnInput = {
  agentSessionId: string
  input: string
  activationFacts?: Record<string, unknown>
  narrativeTarget?: {
    timelineId: string
    branchId?: string
    commit: boolean
  }
}

export type PreviewAgentTurnInput = InvokeAgentTurnInput

// ─── Provider & Agent Profile DTOs ──────────────────────────────────────────

export type CreateProviderProfileInput = {
  providerExtensionId: string
  displayName: string
  config?: Record<string, unknown>
  enabledModelIds?: string[]
  credential?: Record<string, string>
}

export type UpdateProviderProfileInput = {
  providerProfileId: string
  displayName?: string
  config?: Record<string, unknown>
  enabledModelIds?: string[]
}

export type CreateAgentProfileInput = {
  name: string
  presetId: string
  model: ProviderModelSelection
  toolOverrides?: Record<string, boolean>
}

export type UpdateAgentProfileInput = {
  agentProfileId: string
  name?: string
  presetId?: string
  model?: ProviderModelSelection
  toolOverrides?: Record<string, boolean>
}

// ─── Narrative DTOs ─────────────────────────────────────────────────────────

export type CreateNarrativeTimelineInput = {
  cardId: string
  title?: string
}

export type ForkNarrativeBranchInput = {
  timelineId: string
  fromBranchId: string
  fromNodeId: string
  title?: string
}

export type SwitchNarrativeBranchInput = {
  timelineId: string
  branchId: string
  expectedActiveBranchId?: string
}

// ─── Prompt Resource DTOs ───────────────────────────────────────────────────

export type CreatePromptResourceInput = {
  resourceKind: PromptResource['resourceKind']
  name: string
}

export type DuplicatePromptResourceInput = {
  resourceId: string
  name?: string
}

export type CreatePromptResourceAssetInput = {
  resourceId: string
  targetAssetId?: string
  position?: 'before' | 'after' | 'inside'
  asset: ContextAssetNode
}

export type UpdatePromptResourceAssetInput = {
  resourceId: string
  assetId: string
  body?: string
  capabilities?: PromptCompositionCapabilities
  label?: string
  meta?: string
  enabled?: boolean
  orderList?: string[]
  skeletonPatch?: ContextAssetNode['skeletonPatch']
  slotRanks?: ProjectionSlotRank[]
}

export type UpdatePromptResourceAssetsInput = {
  resourceId: string
  updates: Array<{
    assetId: string
    body?: string
    capabilities?: PromptCompositionCapabilities
    label?: string
    meta?: string
    enabled?: boolean
    orderList?: string[]
    skeletonPatch?: ContextAssetNode['skeletonPatch']
    slotRanks?: ProjectionSlotRank[]
  }>
}

export type MovePromptResourceAssetInput = {
  resourceId: string
  assetId: string
  targetAssetId: string
  position: 'before' | 'after' | 'inside'
}

export type DeletePromptResourceAssetInput = {
  resourceId: string
  assetId: string
}

// ─── Card Bundle DTOs ───────────────────────────────────────────────────────

export type ImportCardBundleInput = {
  sourceArtifact?: {
    format: string
    originalFileName?: string
    importerVersion?: string
    dataBase64: string
    mediaType?: string
  }
  artifact?: CardBundleArtifact
}

// ─── Studio API Interface ───────────────────────────────────────────────────

export type StudioApi = {
  settings: {
    getNetwork(): Promise<NetworkSettings>
    updateNetwork(input: { proxyMode: NetworkProxyMode; proxyUrl?: string }): Promise<NetworkSettings>
  }
  logs: {
    list(input?: LogsListInput): Promise<LogPage>
  }
  history: {
    revert(changesetId: string): Promise<MutationReceipt>
  }
  importBundles: {
    get(importBundleId: string): Promise<GetImportBundleResult>
  }
  cards: {
    get(cardId: string): Promise<GetCardResult>
    list(input?: { cursor?: string; limit?: number }): Promise<ListCardsResult>
    create(input: CreateCardInput): Promise<CreateCardResult>
    update(input: UpdateCardInput): Promise<UpdateCardResult>
    updatePromptResources(input: UpdateCardPromptResourcesInput): Promise<UpdateCardResult>
    delete(cardId: string): Promise<DeleteCardResult>
    export(cardId: string): Promise<ExportCardBundleResult>
  }
  agentSessions: {
    create(input: CreateAgentSessionInput): Promise<CreateAgentSessionResult>
    get(agentSessionId: string): Promise<{ session: AgentSession }>
    getTranscript(input: { agentSessionId: string; cursor?: string; limit?: number }): Promise<AgentTranscriptPage>
    invoke(input: InvokeAgentTurnInput): Promise<InvokeAgentTurnResult>
    preview(input: PreviewAgentTurnInput): Promise<PreviewAgentTurnResult>
  }
  providerProfiles: {
    list(input?: { cursor?: string; limit?: number }): Promise<ListProviderProfilesResult>
    create(input: CreateProviderProfileInput): Promise<CreateProviderProfileResult>
    update(input: UpdateProviderProfileInput): Promise<UpdateProviderProfileResult>
    replaceCredential(providerProfileId: string, credential: Record<string, string>): Promise<{ credential: { configured: boolean; updatedAt?: string } }>
    delete(providerProfileId: string): Promise<DeleteProviderProfileResult>
  }
  providerAccounts: StudioApi['providerProfiles']
  providerModels: {
    list(providerProfileId: string): Promise<string[]>
    ping(providerProfileId: string, modelId: string): Promise<string>
  }
  agentProfiles: {
    list(input?: { cursor?: string; limit?: number }): Promise<ListAgentProfilesResult>
    create(input: CreateAgentProfileInput): Promise<CreateAgentProfileResult>
    update(input: UpdateAgentProfileInput): Promise<UpdateAgentProfileResult>
    delete(agentProfileId: string): Promise<DeleteAgentProfileResult>
  }
  agentTools: {
    list(): Promise<{ tools: AgentToolDefinition[] }>
    update(input: { toolId: string; expectedVersion: number; definition: Omit<AgentToolDefinition, 'version' | 'createdAt' | 'updatedAt'> }): Promise<{ tool: AgentToolDefinition }>
    analyze(agentProfileId: string): Promise<{ analysis: ClientJsonValue }>
  }
  narratives: {
    create(input: CreateNarrativeTimelineInput): Promise<CreateNarrativeTimelineResult>
    createFromCard(input: CreateNarrativeTimelineInput): Promise<CreateNarrativeTimelineResult>
    get(timelineId: string): Promise<GetNarrativeTimelineResult>
    list(input?: { createdFromCardId?: string; cursor?: string; limit?: number }): Promise<ListNarrativeTimelinesResult>
    getPage(input: { timelineId: string; branchId?: string; cursor?: string; limit?: number }): Promise<NarrativePage>
    fork(input: ForkNarrativeBranchInput): Promise<ForkNarrativeBranchResult>
    switch(input: SwitchNarrativeBranchInput): Promise<SwitchNarrativeBranchResult>
  }
  promptResources: {
    get(resourceId: string): Promise<GetPromptResourceResult>
    list(resourceKind?: 'preset' | 'setting'): Promise<ListPromptResourcesResult>
    create(input: CreatePromptResourceInput): Promise<CreatePromptResourceResult>
    duplicate(input: DuplicatePromptResourceInput): Promise<CreatePromptResourceResult>
    delete(resourceId: string): Promise<DeletePromptResourceResult>
    import(artifact: PromptResourceArtifact): Promise<CreatePromptResourceResult>
    export(resourceId: string): Promise<ExportPromptResourceResult>
    listForCard(cardId: string): Promise<ListCardPromptResourcesResult>
    updateAsset(input: UpdatePromptResourceAssetInput): Promise<UpdatePromptResourceResult>
    updateAssets(input: UpdatePromptResourceAssetsInput): Promise<UpdatePromptResourceResult>
    listSettingMounts(source?: SettingMountSource): Promise<ListSettingMountsResult>
    replaceSettingMounts(input: { source: SettingMountSource; settingResourceIds: string[] }): Promise<ReplaceSettingMountsResult>
    listPresetToolMounts(input?: { presetId?: string; toolId?: string }): Promise<ListPresetToolMountsResult>
    replacePresetToolMounts(input: { presetId: string; mounts: PresetToolMountInput[] }): Promise<ReplacePresetToolMountsResult>
    createAsset(input: CreatePromptResourceAssetInput): Promise<UpdatePromptResourceResult>
    moveAsset(input: MovePromptResourceAssetInput): Promise<UpdatePromptResourceResult>
    deleteAsset(input: DeletePromptResourceAssetInput): Promise<UpdatePromptResourceResult>
  }
  cardBundles: {
    import(input: ImportCardBundleInput): Promise<ImportCardBundleResult>
  }
}

export function createStudioApi(bridge: ClientBridge): StudioApi {
  const providerProfiles: StudioApi['providerProfiles'] = {
    list: input => bridge.call<ListProviderProfilesResult>('application.listProviderProfiles', (input ?? {}) as unknown as ClientJsonValue),
    create: input => bridge.call<CreateProviderProfileResult>('application.createProviderProfile', input as unknown as ClientJsonValue),
    update: input => bridge.call<UpdateProviderProfileResult>('application.updateProviderProfile', input as unknown as ClientJsonValue),
    replaceCredential: (providerProfileId, credential) => bridge.call('application.replaceProviderCredential', {
      providerProfileId,
      credential,
    } as unknown as ClientJsonValue),
    delete: providerProfileId => bridge.call<DeleteProviderProfileResult>('application.deleteProviderProfile', {
      providerProfileId,
    } as unknown as ClientJsonValue),
  }

  return {
    settings: {
      getNetwork: () => bridge.call<NetworkSettings>('settings.network.get', {}),
      updateNetwork: input => bridge.call<NetworkSettings>('settings.network.update', input as unknown as ClientJsonValue),
    },
    logs: {
      list: input => bridge.call<LogPage>('logs.list', (input ?? {}) as unknown as ClientJsonValue),
    },
    history: {
      revert: async changesetId => {
        const result = await bridge.call<{ mutation: MutationReceipt }>('application.revertChangeset', { changesetId })
        return result.mutation
      },
    },
    importBundles: {
      get: importBundleId => bridge.call<GetImportBundleResult>('application.getImportBundle', { importBundleId }),
    },
    cards: {
      get: cardId => bridge.call<GetCardResult>('application.getCard', { cardId }),
      list: input => bridge.call<ListCardsResult>('application.listCards', (input ?? {}) as unknown as ClientJsonValue),
      create: input => bridge.call<CreateCardResult>('application.createCard', input as unknown as ClientJsonValue),
      update: input => bridge.call<UpdateCardResult>('application.updateCard', input as unknown as ClientJsonValue),
      updatePromptResources: input => bridge.call<UpdateCardResult>('application.updateCardPromptResources', input as unknown as ClientJsonValue),
      delete: cardId => bridge.call<DeleteCardResult>('application.deleteCard', { cardId }),
      export: cardId => bridge.call<ExportCardBundleResult>('application.exportCardBundle', { cardId }),
    },
    agentSessions: {
      create: input => bridge.call<CreateAgentSessionResult>('application.createAgentSession', input as unknown as ClientJsonValue),
      get: agentSessionId => bridge.call<{ session: AgentSession }>('application.getAgentSession', { agentSessionId }),
      getTranscript: input => bridge.call<AgentTranscriptPage>('application.getAgentTranscriptPage', input as unknown as ClientJsonValue),
      invoke: input => bridge.call<InvokeAgentTurnResult>('application.invokeAgentTurn', input as unknown as ClientJsonValue),
      preview: input => bridge.call<PreviewAgentTurnResult>('application.previewAgentTurn', input as unknown as ClientJsonValue),
    },
    providerProfiles,
    providerAccounts: providerProfiles,
    providerModels: {
      list: async providerProfileId => {
        const result = await bridge.call<{ modelIds: string[] }>('application.listProviderModels', { providerProfileId })
        return result.modelIds
      },
      ping: async (providerProfileId, modelId) => {
        const result = await bridge.call<{ text: string }>('application.pingProviderModel', { providerProfileId, modelId })
        return result.text
      },
    },
    agentProfiles: {
      list: input => bridge.call<ListAgentProfilesResult>('application.listAgentProfiles', (input ?? {}) as unknown as ClientJsonValue),
      create: input => bridge.call<CreateAgentProfileResult>('application.createAgentProfile', input as unknown as ClientJsonValue),
      update: input => bridge.call<UpdateAgentProfileResult>('application.updateAgentProfile', input as unknown as ClientJsonValue),
      delete: agentProfileId => bridge.call<DeleteAgentProfileResult>('application.deleteAgentProfile', { agentProfileId }),
    },
    agentTools: {
      list: () => bridge.call<{ tools: AgentToolDefinition[] }>('application.listAgentTools', {}),
      update: input => bridge.call<{ tool: AgentToolDefinition }>('application.updateAgentTool', input as unknown as ClientJsonValue),
      analyze: agentProfileId => bridge.call<{ analysis: ClientJsonValue }>('application.analyzeAgentTools', { agentProfileId }),
    },
    narratives: {
      create: input => bridge.call<CreateNarrativeTimelineResult>('application.createNarrativeTimeline', input as unknown as ClientJsonValue),
      createFromCard: input => bridge.call<CreateNarrativeTimelineResult>('application.createNarrativeTimeline', input as unknown as ClientJsonValue),
      get: timelineId => bridge.call<GetNarrativeTimelineResult>('application.getNarrativeTimeline', { timelineId }),
      list: input => bridge.call<ListNarrativeTimelinesResult>('application.listNarrativeTimelines', (input ?? {}) as unknown as ClientJsonValue),
      getPage: input => bridge.call<NarrativePage>('application.getNarrativePage', input as unknown as ClientJsonValue),
      fork: input => bridge.call<ForkNarrativeBranchResult>('application.forkNarrativeBranch', input as unknown as ClientJsonValue),
      switch: input => bridge.call<SwitchNarrativeBranchResult>('application.switchNarrativeBranch', input as unknown as ClientJsonValue),
    },
    promptResources: {
      get: resourceId => bridge.call<GetPromptResourceResult>('application.getPromptResource', { resourceId }),
      list: resourceKind => bridge.call<ListPromptResourcesResult>('application.listPromptResources', resourceKind ? { resourceKind } : {}),
      create: input => bridge.call<CreatePromptResourceResult>('application.createPromptResource', input as unknown as ClientJsonValue),
      duplicate: input => bridge.call<CreatePromptResourceResult>('application.duplicatePromptResource', input as unknown as ClientJsonValue),
      delete: resourceId => bridge.call<DeletePromptResourceResult>('application.deletePromptResource', { resourceId }),
      import: artifact => bridge.call<CreatePromptResourceResult>('application.importPromptResource', { artifact: artifact as unknown as ClientJsonValue }),
      export: resourceId => bridge.call<ExportPromptResourceResult>('application.exportPromptResource', { resourceId }),
      listForCard: cardId => bridge.call<ListCardPromptResourcesResult>('application.listCardPromptResources', { cardId }),
      createAsset: input => bridge.call<UpdatePromptResourceResult>('application.createPromptResourceAsset', input as unknown as ClientJsonValue),
      updateAsset: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAsset', input as unknown as ClientJsonValue),
      updateAssets: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAssets', input as unknown as ClientJsonValue),
      listSettingMounts: source => bridge.call<ListSettingMountsResult>('application.listSettingMounts', source ? { source } as unknown as ClientJsonValue : {}),
      replaceSettingMounts: input => bridge.call<ReplaceSettingMountsResult>('application.replaceSettingMounts', input as unknown as ClientJsonValue),
      listPresetToolMounts: input => bridge.call<ListPresetToolMountsResult>('application.listPresetToolMounts', (input ?? {}) as unknown as ClientJsonValue),
      replacePresetToolMounts: input => bridge.call<ReplacePresetToolMountsResult>('application.replacePresetToolMounts', input as unknown as ClientJsonValue),
      moveAsset: input => bridge.call<UpdatePromptResourceResult>('application.movePromptResourceAsset', input as unknown as ClientJsonValue),
      deleteAsset: input => bridge.call<UpdatePromptResourceResult>('application.deletePromptResourceAsset', input as unknown as ClientJsonValue),
    },
    cardBundles: {
      import: input => bridge.call<ImportCardBundleResult>('application.importCardBundle', input as unknown as ClientJsonValue),
    },
  }
}
