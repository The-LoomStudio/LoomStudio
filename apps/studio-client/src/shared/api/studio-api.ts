import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { LogLevel, LogPage } from '@loom-studio/logging'
import type { ExtensionEntityRef, ExtensionRecordEntry, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import type {
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  AgentTranscriptPage,
  ApplyStateMutationInput,
  ApplyStateMutationResult,
  AgentToolDefinition,
  AgentSession,
  CardBundleArtifact,
  CardMedia,
  CardPresetInput,
  ContextAssetNode,
  CreateAgentProfileResult,
  CreateAiCapabilityProfileResult,
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
  ExtensionPackageResourceImportResult,
  ExtensionPackageResourceRemovalResult,
  ForkNarrativeBranchResult,
  GetCardResult,
  GetNarrativeTimelineResult,
  GetPromptResourceResult,
  GetStateSnapshotResult,
  GetStateDefinitionResult,
  ImportCardBundleResult,
  InvokeAgentTurnResult,
  ListAgentProfilesResult,
  ListAiCapabilityProfilesResult,
  ListCardsResult,
  ListNarrativeTimelinesResult,
  ListPromptResourcesResult,
  ListPresetToolMountsResult,
  ListProviderProfilesResult,
  ListSettingMountsResult,
  ManagedExtensionModule,
  ManagedExtensionPackage,
  ListStateDefinitionsResult,
  MutationReceipt,
  UpdateAiCapabilityProfileResult,
  NarrativePage,
  OpeningChatInput,
  PreviewAgentTurnResult,
  PreviewCardDeletionResult,
  ProjectionSlotRank,
  PromptCompositionCapabilities,
  PromptResource,
  PromptResourceArtifact,
  PortableExtensionPayloadDraft,
  ListPortableExtensionPayloadsResult,
  GetPortableExtensionPayloadResult,
  MutatePortableExtensionPayloadResult,
  PresetToolMountInput,
  ProviderModelSelection,
  ReplaceSettingMountsResult,
  ReplacePresetToolMountsResult,
  RegisteredAiGatewayProvider,
  SettingLayerInput,
  SettingMountSource,
  StateTarget,
  StateDefinitionDraft,
  UpsertStateDefinitionResult,
  DeleteStateDefinitionResult,
  SwitchNarrativeBranchResult,
  UpdateAgentProfileResult,
  UpdateCardResult,
  UpdatePromptResourceResult,
  UpdateProviderProfileResult,
  HistoryProjectionSnapshot,
  HistorySource,
  RendererDefinition,
  TextExtractor,
  TextExtractorDraft,
  TextTransformRule,
  TextTransformRuleDraft,
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
  stateDefinitionIds?: string[]
  timelineStateBindings?: Array<{ path: string; templateId: string; templateVersion: number; initial?: Record<string, ClientJsonValue> }>
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
  extensions: {
    list(): Promise<{ items: ManagedExtensionPackage[] }>
    enable(packageId: string, moduleId: string): Promise<{ module: ManagedExtensionModule }>
    disable(packageId: string, moduleId: string): Promise<{ module: ManagedExtensionModule }>
    reload(packageId: string, moduleId: string): Promise<{ module: ManagedExtensionModule }>
    uninstall(packageId: string, version?: string): Promise<{ package: ClientJsonValue }>
    importResources(packageId: string): Promise<ExtensionPackageResourceImportResult>
    removeResources(packageId: string): Promise<ExtensionPackageResourceRemovalResult>
    diagnostics(packageId?: string, moduleId?: string): Promise<{ diagnostics: ClientJsonValue[] }>
  }
  extensionRuntime: {
    listRecords(input: { packageId: string; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<{ records: ExtensionRecordEntry[] }>
    getRecord(packageId: string, recordId: string): Promise<{ record: ExtensionRecordEntry | null }>
    call<T = ClientJsonValue>(method: string, params?: ClientJsonValue): Promise<T>
  }
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
  states: {
    get(target: StateTarget): Promise<GetStateSnapshotResult>
    apply(input: ApplyStateMutationInput): Promise<ApplyStateMutationResult>
    listDefinitions(kind?: StateDefinitionDraft['kind']): Promise<ListStateDefinitionsResult>
    getDefinition(definitionId: string): Promise<GetStateDefinitionResult>
    upsertDefinition(input: { definitionId: string; expectedVersion?: number; definition: StateDefinitionDraft }): Promise<UpsertStateDefinitionResult>
    deleteDefinition(input: { definitionId: string; expectedVersion?: number }): Promise<DeleteStateDefinitionResult>
  }
  textTransforms: {
    listRules(): Promise<{ rules: TextTransformRule[] }>
    getRule(ruleId: string): Promise<{ rule: TextTransformRule }>
    upsertRule(input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft }): Promise<{ rule: TextTransformRule; mutation: MutationReceipt }>
    deleteRule(input: { ruleId: string; expectedVersion?: number }): Promise<{ deleted: true; mutation: MutationReceipt }>
    listExtractors(): Promise<{ extractors: TextExtractor[] }>
    getExtractor(extractorId: string): Promise<{ extractor: TextExtractor }>
    upsertExtractor(input: { extractorId: string; expectedVersion?: number; extractor: TextExtractorDraft }): Promise<{ extractor: TextExtractor; mutation: MutationReceipt }>
    deleteExtractor(input: { extractorId: string; expectedVersion?: number }): Promise<{ deleted: true; mutation: MutationReceipt }>
    project(input: { source: HistorySource; phase: 'classify' | 'prompt' | 'display' }): Promise<{ snapshot: HistoryProjectionSnapshot }>
    extract(input: { source: HistorySource; phase?: 'classify' | 'prompt' | 'display'; extractorId: string }): Promise<{ extraction: ClientJsonValue; snapshot: HistoryProjectionSnapshot }>
    listRenderers(): Promise<{ renderers: RendererDefinition[] }>
  }
  cards: {
    get(cardId: string): Promise<GetCardResult>
    list(input?: { cursor?: string; limit?: number }): Promise<ListCardsResult>
    create(input: CreateCardInput): Promise<CreateCardResult>
    update(input: UpdateCardInput): Promise<UpdateCardResult>
    updatePromptResources(input: UpdateCardPromptResourcesInput): Promise<UpdateCardResult>
    previewDeletion(cardId: string): Promise<PreviewCardDeletionResult>
    delete(cardId: string, options?: { includePlayData?: boolean }): Promise<DeleteCardResult>
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
  aiCapabilityProfiles: {
    list(input?: { providerProfileId?: string; capabilityId?: string; cursor?: string; limit?: number }): Promise<ListAiCapabilityProfilesResult>
    create(input: { providerProfileId: string; capabilityId: string; displayName: string; config?: Record<string, ClientJsonValue> }): Promise<CreateAiCapabilityProfileResult>
    update(input: { profileId: string; displayName?: string; config?: Record<string, ClientJsonValue> }): Promise<UpdateAiCapabilityProfileResult>
    delete(profileId: string): Promise<{ deleted: true }>
  }
  providerModels: {
    list(providerProfileId: string): Promise<string[]>
    ping(providerProfileId: string, modelId: string): Promise<string>
  }
  aiGateway: {
    listProviders(): Promise<RegisteredAiGatewayProvider[]>
    invoke(input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>): Promise<AiGatewayInvokeResult>
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
  }
  narratives: {
    create(input: CreateNarrativeTimelineInput): Promise<CreateNarrativeTimelineResult>
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
  portableExtensionPayloads: {
    list(packageId?: string): Promise<ListPortableExtensionPayloadsResult>
    get(payloadId: string): Promise<GetPortableExtensionPayloadResult>
    create(input: { artifactPayloadId?: string; payload: PortableExtensionPayloadDraft }): Promise<MutatePortableExtensionPayloadResult>
    update(input: { payloadId: string; expectedVersion: number; payload: PortableExtensionPayloadDraft }): Promise<MutatePortableExtensionPayloadResult>
    delete(input: { payloadId: string; expectedVersion: number }): Promise<{ deleted: true; mutation: MutationReceipt }>
    replaceCardBindings(input: { cardId: string; expectedVersion: number; payloadIds: string[] }): Promise<UpdateCardResult>
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
    extensions: {
      list: () => bridge.call('extensions.listPackages', {}),
      enable: (packageId, moduleId) => bridge.call('extensions.enableModule', { packageId, moduleId }),
      disable: (packageId, moduleId) => bridge.call('extensions.disableModule', { packageId, moduleId }),
      reload: (packageId, moduleId) => bridge.call('extensions.reloadModule', { packageId, moduleId }),
      uninstall: (packageId, version) => bridge.call('extensions.uninstallPackage', { packageId, ...(version ? { version } : {}) }),
      importResources: packageId => bridge.call('extensions.importPackageResources', { packageId }),
      removeResources: packageId => bridge.call('extensions.removePackageResources', { packageId }),
      diagnostics: (packageId, moduleId) => bridge.call('extensions.getDiagnostics', {
        ...(packageId ? { packageId } : {}),
        ...(moduleId ? { moduleId } : {}),
      }),
    },
    extensionRuntime: {
      listRecords: input => bridge.call('application.listExtensionRecords', input as unknown as ClientJsonValue),
      getRecord: (packageId, recordId) => bridge.call('application.getExtensionRecord', { packageId, recordId }),
      call: (method, params) => bridge.call(method, params),
    },
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
    states: {
      get: target => bridge.call<GetStateSnapshotResult>('application.getStateSnapshot', { target } as unknown as ClientJsonValue),
      apply: input => bridge.call<ApplyStateMutationResult>('application.applyStateMutation', input as unknown as ClientJsonValue),
      listDefinitions: kind => bridge.call<ListStateDefinitionsResult>('application.listStateDefinitions', kind ? { kind } : {}),
      getDefinition: definitionId => bridge.call<GetStateDefinitionResult>('application.getStateDefinition', { definitionId }),
      upsertDefinition: input => bridge.call<UpsertStateDefinitionResult>('application.upsertStateDefinition', input as unknown as ClientJsonValue),
      deleteDefinition: input => bridge.call<DeleteStateDefinitionResult>('application.deleteStateDefinition', input as unknown as ClientJsonValue),
    },
    textTransforms: {
      listRules: () => bridge.call('application.listTextTransformRules', {}),
      getRule: ruleId => bridge.call('application.getTextTransformRule', { ruleId }),
      upsertRule: input => bridge.call('application.upsertTextTransformRule', input as unknown as ClientJsonValue),
      deleteRule: input => bridge.call('application.deleteTextTransformRule', input as unknown as ClientJsonValue),
      listExtractors: () => bridge.call('application.listTextExtractors', {}),
      getExtractor: extractorId => bridge.call('application.getTextExtractor', { extractorId }),
      upsertExtractor: input => bridge.call('application.upsertTextExtractor', input as unknown as ClientJsonValue),
      deleteExtractor: input => bridge.call('application.deleteTextExtractor', input as unknown as ClientJsonValue),
      project: input => bridge.call('application.projectHistory', input as unknown as ClientJsonValue),
      extract: input => bridge.call('application.extractHistory', input as unknown as ClientJsonValue),
      listRenderers: () => bridge.call('application.listRenderers', {}),
    },
    cards: {
      get: cardId => bridge.call<GetCardResult>('application.getCard', { cardId }),
      list: input => bridge.call<ListCardsResult>('application.listCards', (input ?? {}) as unknown as ClientJsonValue),
      create: input => bridge.call<CreateCardResult>('application.createCard', input as unknown as ClientJsonValue),
      update: input => bridge.call<UpdateCardResult>('application.updateCard', input as unknown as ClientJsonValue),
      updatePromptResources: input => bridge.call<UpdateCardResult>('application.updateCardPromptResources', input as unknown as ClientJsonValue),
      previewDeletion: cardId => bridge.call<PreviewCardDeletionResult>('application.previewCardDeletion', { cardId }),
      delete: (cardId, options) => bridge.call<DeleteCardResult>('application.deleteCard', {
        cardId,
        ...(options?.includePlayData ? { includePlayData: true } : {}),
      }),
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
    aiCapabilityProfiles: {
      list: input => bridge.call<ListAiCapabilityProfilesResult>('application.listAiCapabilityProfiles', (input ?? {}) as unknown as ClientJsonValue),
      create: input => bridge.call<CreateAiCapabilityProfileResult>('application.createAiCapabilityProfile', input as unknown as ClientJsonValue),
      update: input => bridge.call<UpdateAiCapabilityProfileResult>('application.updateAiCapabilityProfile', input as unknown as ClientJsonValue),
      delete: profileId => bridge.call('application.deleteAiCapabilityProfile', { profileId }),
    },
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
    aiGateway: {
      listProviders: async () => {
        const result = await bridge.call<{ providers: RegisteredAiGatewayProvider[] }>('ai.providers.list', {})
        return result.providers
      },
      invoke: input => bridge.call<AiGatewayInvokeResult>('ai.invoke', input as unknown as ClientJsonValue),
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
    },
    narratives: {
      create: input => bridge.call<CreateNarrativeTimelineResult>('application.createNarrativeTimeline', input as unknown as ClientJsonValue),
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
    portableExtensionPayloads: {
      list: packageId => bridge.call<ListPortableExtensionPayloadsResult>('application.listPortableExtensionPayloads', packageId ? { packageId } : {}),
      get: payloadId => bridge.call<GetPortableExtensionPayloadResult>('application.getPortableExtensionPayload', { payloadId }),
      create: input => bridge.call<MutatePortableExtensionPayloadResult>('application.createPortableExtensionPayload', input as unknown as ClientJsonValue),
      update: input => bridge.call<MutatePortableExtensionPayloadResult>('application.updatePortableExtensionPayload', input as unknown as ClientJsonValue),
      delete: input => bridge.call<{ deleted: true; mutation: MutationReceipt }>('application.deletePortableExtensionPayload', input as unknown as ClientJsonValue),
      replaceCardBindings: input => bridge.call<UpdateCardResult>('application.replaceCardPortableExtensionPayloads', input as unknown as ClientJsonValue),
    },
  }
}
