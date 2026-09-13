import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
type TimelineArchiveClient = Record<string, ClientJsonValue>
import type { CardDirectoryPreview, CardDirectorySaveResult, CardDirectoryCatalog, OpenCardDirectoryResult, CardDirectoryAttachment } from '@loom-studio/shared'
import type { OfficialContentPackage } from '../../entities/official-content.js'
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
  LoomScript,
  LoomScriptMount,
  LoomScriptOwner,
  MutationReceipt,
  UpdateAiCapabilityProfileResult,
  NarrativePage,
  NarrativeTimeline,
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
  ResolvedLoomScriptRendererMount,
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
  TextPipelineInspection,
  TextPipelineOverride,
  TextTransformPhase,
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
  macros?: Record<string, string>
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
  macros?: Record<string, string>
  cardId: string
  expectedVersion?: number
  name?: string
  userName?: string
  description?: string
  preset?: CardPresetInput | string
  opening?: OpeningChatInput | string
  settingLayer?: SettingLayerInput
  media?: CardMedia
  promptResourceIds?: string[]
  stateTemplates?: Array<{
    id: string
    templateVersion: number
    schema: Record<string, ClientJsonValue>
    initial: Record<string, ClientJsonValue>
    componentKey?: string
    targetEntityTypeIds?: string[]
    label?: string
  }>
  stateDefinitionIds?: string[]
  stateEntityTypes?: Array<{ id: string; collectionPath: string; label?: string }>
  timelineStateEntities?: Array<{ typeId: string; entityId: string }>
  timelineComponentMounts?: Array<{
    templateId: string
    templateVersion: number
    componentKey: string
    target:
      | { kind: 'entity'; entity: { typeId: string; entityId: string } }
      | { kind: 'entity-type'; typeId: string }
    initial?: Record<string, ClientJsonValue>
  }>
  stateContributionIds?: string[]
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
  timelineId?: string
}

export type InvokeAgentTurnInput = {
  macroSelections?: Record<string, string>
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

export type InspectMacrosInput = {
  cardId?: string
  presetId?: string
  timelineTarget?: { timelineId: string; branchId?: string }
  macroSelections?: Record<string, string>
}

export type LoomScriptMountTarget = LoomScriptOwner

export type StudioApi = {
  macros: {
    inspect(input: InspectMacrosInput): Promise<{ macroInspection: import('@loom-studio/shared').MacroInspection }>
  }
  loomScripts: {
    import(input: { owner: LoomScriptOwner; fileName: string; source: string }): Promise<{ script: LoomScript; mutation: MutationReceipt }>
    update(input: { scriptDocumentId: string; expectedVersion: number; fileName: string; source: string }): Promise<{ script: LoomScript; mutation: MutationReceipt }>
    get(scriptDocumentId: string): Promise<{ script: LoomScript }>
    list(owner?: LoomScriptOwner): Promise<{ scripts: LoomScript[] }>
    export(scriptDocumentId: string): Promise<{ artifact: { format: 'loom.script'; schemaVersion: 1; fileName: string; source: string } }>
    createMount(input: { target: LoomScriptMountTarget; scriptDocumentId: string; orderIndex: number; pinnedDocumentVersion?: number; origin?: Record<string, ClientJsonValue> }): Promise<{ mount: LoomScriptMount; mutation: MutationReceipt }>
    updateMount(input: { mountId: string; expectedVersion: number; enabled: boolean; orderIndex: number; pinnedDocumentVersion?: number; grantedCapabilities: string[] }): Promise<{ mount: LoomScriptMount; mutation: MutationReceipt }>
    listMounts(target?: LoomScriptMountTarget): Promise<{ mounts: LoomScriptMount[] }>
    resolveRendererMounts(input?: { workspaceId?: string; timelineId?: string; presetId?: string }): Promise<{ mounts: ResolvedLoomScriptRendererMount[] }>
  }
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
  officialContent: {
    list(): Promise<{ packages: OfficialContentPackage[] }>
    install(input: { packageId: string; digest: string }): Promise<{ resources: Array<{ id: string; created: boolean }>; mutation?: MutationReceipt }>
    export(input: { packageId: string; digest: string }): Promise<{ fileName: string; base64: string }>
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
    project(input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string }): Promise<{ snapshot: HistoryProjectionSnapshot }>
    getOverride(input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string }): Promise<{ override: TextPipelineOverride | null }>
    upsertOverride(input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; expectedVersion?: number; disabledRuleIds: string[]; orderedRuleIds: string[] }): Promise<{ override: TextPipelineOverride; mutation: MutationReceipt }>
    deleteOverride(input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; expectedVersion?: number }): Promise<{ deleted: true; mutation: MutationReceipt }>
    inspectTextPipeline(input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; traceEntryId?: string }): Promise<TextPipelineInspection>
    extract(input: { source: HistorySource; phase?: TextTransformPhase; extractorId: string; consumerAgentSessionId?: string }): Promise<{ extraction: ClientJsonValue; snapshot: HistoryProjectionSnapshot }>
    listRenderers(): Promise<{ renderers: RendererDefinition[] }>
  }
  directories: {
    importDirectory(directory: string, token: string): Promise<{ cardId: string }>
    previewApply(cardId: string): Promise<CardDirectoryPreview>
    apply(cardId: string, token: string): Promise<{ cardId: string }>
    attachment(directory: string, path: string): Promise<CardDirectoryAttachment>
    list(): Promise<CardDirectoryCatalog>
    scan(): Promise<CardDirectoryCatalog>
    open(directory: string): Promise<OpenCardDirectoryResult>
  }
  cards: {
    get(cardId: string): Promise<GetCardResult>
    list(input?: { cursor?: string; limit?: number }): Promise<ListCardsResult>
    create(input: CreateCardInput): Promise<CreateCardResult>
    update(input: UpdateCardInput): Promise<UpdateCardResult>
    updatePromptResources(input: UpdateCardPromptResourcesInput): Promise<UpdateCardResult>
    previewDeletion(cardId: string): Promise<PreviewCardDeletionResult>
    delete(cardId: string, options?: { includePlayData?: boolean; includePromptResources?: boolean }): Promise<DeleteCardResult>
    export(cardId: string): Promise<ExportCardBundleResult>
    previewDirectory(cardId: string): Promise<CardDirectoryPreview>
    saveDirectory(cardId: string, token: string): Promise<CardDirectorySaveResult>
    recoverDirectory(cardId: string): Promise<{ recovered: boolean }>
  }
  agentSessions: {
    create(input: CreateAgentSessionInput): Promise<CreateAgentSessionResult>
    list(input?: { agentProfileId?: string; timelineId?: string; standalone?: boolean; cursor?: string; limit?: number }): Promise<{ sessions: AgentSession[]; nextCursor?: string }>
    get(agentSessionId: string): Promise<{ session: AgentSession }>
    getTranscript(input: { agentSessionId: string; cursor?: string; limit?: number }): Promise<AgentTranscriptPage>
    invoke(input: InvokeAgentTurnInput): Promise<InvokeAgentTurnResult>
    preview(input: PreviewAgentTurnInput): Promise<PreviewAgentTurnResult>
    delete(agentSessionId: string): Promise<{ deleted: true; mutation: MutationReceipt }>
    update(input: { agentSessionId: string; title?: string }): Promise<{ session: AgentSession; mutation: MutationReceipt }>
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
    exportArchive(timelineId: string): Promise<{ archive: TimelineArchiveClient }>
    importArchive(source: string): Promise<{ timelineId: string; unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }> }>
    fork(input: ForkNarrativeBranchInput): Promise<ForkNarrativeBranchResult>
    switch(input: SwitchNarrativeBranchInput): Promise<SwitchNarrativeBranchResult>
    delete(timelineId: string): Promise<{ deleted: true; mutation: MutationReceipt }>
    update(input: { timelineId: string; title?: string }): Promise<{ timeline: NarrativeTimeline; mutation: MutationReceipt }>
  }
  promptResources: {
    updateMacros(input: { resourceId: string; expectedVersion: number; macros: Record<string, string> }): Promise<UpdatePromptResourceResult>
    get(resourceId: string): Promise<GetPromptResourceResult>
    list(resourceKind?: 'preset' | 'setting'): Promise<ListPromptResourcesResult>
    create(input: CreatePromptResourceInput): Promise<CreatePromptResourceResult>
    duplicate(input: DuplicatePromptResourceInput): Promise<CreatePromptResourceResult>
    delete(resourceId: string): Promise<DeletePromptResourceResult>
    import(artifact: PromptResourceArtifact, name?: string): Promise<CreatePromptResourceResult>
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
  const rpc = {
    call<T>(method: string, params?: unknown): Promise<T> {
      return bridge.call<T>(method, params as ClientJsonValue)
    },
  }

  const providerProfiles: StudioApi['providerProfiles'] = {
    list: input => rpc.call<ListProviderProfilesResult>('application.listProviderProfiles', (input ?? {})),
    create: input => rpc.call<CreateProviderProfileResult>('application.createProviderProfile', input),
    update: input => rpc.call<UpdateProviderProfileResult>('application.updateProviderProfile', input),
    replaceCredential: (providerProfileId, credential) => rpc.call('application.replaceProviderCredential', {
      providerProfileId,
      credential,
    }),
    delete: providerProfileId => rpc.call<DeleteProviderProfileResult>('application.deleteProviderProfile', {
      providerProfileId,
    }),
  }

  return {
    officialContent: {
      list: () => rpc.call('official.listContent', {}),
      install: input => rpc.call('official.installContent', input),
      export: input => rpc.call('official.exportContent', input),
    },
    extensions: {
      list: () => rpc.call('extensions.listPackages', {}),
      enable: (packageId, moduleId) => rpc.call('extensions.enableModule', { packageId, moduleId }),
      disable: (packageId, moduleId) => rpc.call('extensions.disableModule', { packageId, moduleId }),
      reload: (packageId, moduleId) => rpc.call('extensions.reloadModule', { packageId, moduleId }),
      uninstall: (packageId, version) => rpc.call('extensions.uninstallPackage', { packageId, ...(version ? { version } : {}) }),
      importResources: packageId => rpc.call('extensions.importPackageResources', { packageId }),
      removeResources: packageId => rpc.call('extensions.removePackageResources', { packageId }),
      diagnostics: (packageId, moduleId) => rpc.call('extensions.getDiagnostics', {
        ...(packageId ? { packageId } : {}),
        ...(moduleId ? { moduleId } : {}),
      }),
    },
    extensionRuntime: {
      listRecords: input => rpc.call('application.listExtensionRecords', input),
      getRecord: (packageId, recordId) => rpc.call('application.getExtensionRecord', { packageId, recordId }),
      call: (method, params) => rpc.call(method, params),
    },
    settings: {
      getNetwork: () => rpc.call<NetworkSettings>('settings.network.get', {}),
      updateNetwork: input => rpc.call<NetworkSettings>('settings.network.update', input),
    },
    logs: {
      list: input => rpc.call<LogPage>('logs.list', (input ?? {})),
    },
    history: {
      revert: async changesetId => {
        const result = await rpc.call<{ mutation: MutationReceipt }>('application.revertChangeset', { changesetId })
        return result.mutation
      },
    },
    states: {
      get: target => rpc.call<GetStateSnapshotResult>('application.getStateSnapshot', { target }),
      apply: input => rpc.call<ApplyStateMutationResult>('application.applyStateMutation', input),
      listDefinitions: kind => rpc.call<ListStateDefinitionsResult>('application.listStateDefinitions', kind ? { kind } : {}),
      getDefinition: definitionId => rpc.call<GetStateDefinitionResult>('application.getStateDefinition', { definitionId }),
      upsertDefinition: input => rpc.call<UpsertStateDefinitionResult>('application.upsertStateDefinition', input),
      deleteDefinition: input => rpc.call<DeleteStateDefinitionResult>('application.deleteStateDefinition', input),
    },
    macros: {
      inspect: input => rpc.call('application.inspectMacros', input),
    },
    loomScripts: {
      import: input => rpc.call('application.importLoomScript', input),
      update: input => rpc.call('application.updateLoomScript', input),
      get: scriptDocumentId => rpc.call('application.getLoomScript', { scriptDocumentId }),
      list: owner => rpc.call('application.listLoomScripts', owner ? { owner } : {}),
      export: scriptDocumentId => rpc.call('application.exportLoomScript', { scriptDocumentId }),
      createMount: input => rpc.call('application.createLoomScriptMount', input),
      updateMount: input => rpc.call('application.updateLoomScriptMount', input),
      listMounts: target => rpc.call('application.listLoomScriptMounts', target ? { target } : {}),
      resolveRendererMounts: input => rpc.call('application.resolveLoomScriptRendererMounts', (input ?? {})),
    },
    textTransforms: {
      listRules: () => rpc.call('application.listTextTransformRules', {}),
      getRule: ruleId => rpc.call('application.getTextTransformRule', { ruleId }),
      upsertRule: input => rpc.call('application.upsertTextTransformRule', input),
      deleteRule: input => rpc.call('application.deleteTextTransformRule', input),
      listExtractors: () => rpc.call('application.listTextExtractors', {}),
      getExtractor: extractorId => rpc.call('application.getTextExtractor', { extractorId }),
      upsertExtractor: input => rpc.call('application.upsertTextExtractor', input),
      deleteExtractor: input => rpc.call('application.deleteTextExtractor', input),
      getOverride: input => rpc.call('application.getTextPipelineOverride', input),
      upsertOverride: input => rpc.call('application.upsertTextPipelineOverride', input),
      deleteOverride: input => rpc.call('application.deleteTextPipelineOverride', input),
      project: input => rpc.call('application.projectHistory', input),
      inspectTextPipeline: input => rpc.call<TextPipelineInspection>('application.inspectTextPipeline', input),
      extract: input => rpc.call('application.extractHistory', input),
      listRenderers: () => rpc.call('application.listRenderers', {}),
    },
    directories: {
      importDirectory: (directory, token) => rpc.call<{ cardId: string }>('directories.import', { directory, token }),
      previewApply: cardId => rpc.call<CardDirectoryPreview>('directories.previewApply', { cardId }),
      apply: (cardId, token) => rpc.call<{ cardId: string }>('directories.apply', { cardId, token }),
      attachment: (directory, path) => rpc.call<CardDirectoryAttachment>('directories.attachment', { directory, path }),
      list: () => rpc.call<CardDirectoryCatalog>('directories.list'),
      scan: () => rpc.call<CardDirectoryCatalog>('directories.scan'),
      open: directory => rpc.call<OpenCardDirectoryResult>('directories.open', { directory }),
    },
    cards: {
      get: cardId => rpc.call<GetCardResult>('application.getCard', { cardId }),
      list: input => rpc.call<ListCardsResult>('application.listCards', (input ?? {})),
      create: input => rpc.call<CreateCardResult>('application.createCard', input),
      update: input => rpc.call<UpdateCardResult>('application.updateCard', input),
      updatePromptResources: input => rpc.call<UpdateCardResult>('application.updateCardPromptResources', input),
      previewDeletion: cardId => rpc.call<PreviewCardDeletionResult>('application.previewCardDeletion', { cardId }),
      delete: (cardId, options) => rpc.call<DeleteCardResult>('application.deleteCard', {
        cardId,
        ...(options?.includePlayData ? { includePlayData: true } : {}),
        ...(options?.includePromptResources ? { includePromptResources: true } : {}),
      }),
      export: cardId => rpc.call<ExportCardBundleResult>('application.exportCardBundle', { cardId }),
      previewDirectory: cardId => rpc.call<CardDirectoryPreview>('directories.previewCard', { cardId }),
      saveDirectory: (cardId, token) => rpc.call<CardDirectorySaveResult>('directories.saveCard', { cardId, token }),
      recoverDirectory: cardId => rpc.call<{ recovered: boolean }>('directories.recoverCard', { cardId }),
    },
    agentSessions: {
      create: input => rpc.call<CreateAgentSessionResult>('application.createAgentSession', input),
      list: input => rpc.call<{ sessions: AgentSession[]; nextCursor?: string }>('application.listAgentSessions', (input ?? {})),
      get: agentSessionId => rpc.call<{ session: AgentSession }>('application.getAgentSession', { agentSessionId }),
      getTranscript: input => rpc.call<AgentTranscriptPage>('application.getAgentTranscriptPage', input),
      invoke: input => rpc.call<InvokeAgentTurnResult>('application.invokeAgentTurn', input),
      preview: input => rpc.call<PreviewAgentTurnResult>('application.previewAgentTurn', input),
      delete: agentSessionId => rpc.call<{ deleted: true; mutation: MutationReceipt }>('application.deleteAgentSession', { agentSessionId }),
      update: input => rpc.call<{ session: AgentSession; mutation: MutationReceipt }>('application.updateAgentSession', input),
    },
    providerProfiles,
    providerAccounts: providerProfiles,
    aiCapabilityProfiles: {
      list: input => rpc.call<ListAiCapabilityProfilesResult>('application.listAiCapabilityProfiles', (input ?? {})),
      create: input => rpc.call<CreateAiCapabilityProfileResult>('application.createAiCapabilityProfile', input),
      update: input => rpc.call<UpdateAiCapabilityProfileResult>('application.updateAiCapabilityProfile', input),
      delete: profileId => rpc.call('application.deleteAiCapabilityProfile', { profileId }),
    },
    providerModels: {
      list: async providerProfileId => {
        const result = await rpc.call<{ modelIds: string[] }>('application.listProviderModels', { providerProfileId })
        return result.modelIds
      },
      ping: async (providerProfileId, modelId) => {
        const result = await rpc.call<{ text: string }>('application.pingProviderModel', { providerProfileId, modelId })
        return result.text
      },
    },
    aiGateway: {
      listProviders: async () => {
        const result = await rpc.call<{ providers: RegisteredAiGatewayProvider[] }>('ai.providers.list', {})
        return result.providers
      },
      invoke: input => rpc.call<AiGatewayInvokeResult>('ai.invoke', input),
    },
    agentProfiles: {
      list: input => rpc.call<ListAgentProfilesResult>('application.listAgentProfiles', (input ?? {})),
      create: input => rpc.call<CreateAgentProfileResult>('application.createAgentProfile', input),
      update: input => rpc.call<UpdateAgentProfileResult>('application.updateAgentProfile', input),
      delete: agentProfileId => rpc.call<DeleteAgentProfileResult>('application.deleteAgentProfile', { agentProfileId }),
    },
    agentTools: {
      list: () => rpc.call<{ tools: AgentToolDefinition[] }>('application.listAgentTools', {}),
      update: input => rpc.call<{ tool: AgentToolDefinition }>('application.updateAgentTool', input),
    },
    narratives: {
      create: input => rpc.call<CreateNarrativeTimelineResult>('application.createNarrativeTimeline', input),
      get: timelineId => rpc.call<GetNarrativeTimelineResult>('application.getNarrativeTimeline', { timelineId }),
      list: input => rpc.call<ListNarrativeTimelinesResult>('application.listNarrativeTimelines', (input ?? {})),
      getPage: input => rpc.call<NarrativePage>('application.getNarrativePage', input),
      exportArchive: timelineId => rpc.call<{ archive: TimelineArchiveClient }>('application.exportTimelineArchive', { timelineId }),
      importArchive: source => rpc.call<{ timelineId: string; unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }> }>('application.importTimelineArchive', { source }),
      fork: input => rpc.call<ForkNarrativeBranchResult>('application.forkNarrativeBranch', input),
      switch: input => rpc.call<SwitchNarrativeBranchResult>('application.switchNarrativeBranch', input),
      delete: timelineId => rpc.call<{ deleted: true; mutation: MutationReceipt }>('application.deleteNarrativeTimeline', { timelineId }),
      update: input => rpc.call<{ timeline: NarrativeTimeline; mutation: MutationReceipt }>('application.updateNarrativeTimeline', input),
    },
    promptResources: {
      updateMacros: input => rpc.call<UpdatePromptResourceResult>('application.updatePromptResourceMacros', input),
      get: resourceId => rpc.call<GetPromptResourceResult>('application.getPromptResource', { resourceId }),
      list: resourceKind => rpc.call<ListPromptResourcesResult>('application.listPromptResources', resourceKind ? { resourceKind } : {}),
      create: input => rpc.call<CreatePromptResourceResult>('application.createPromptResource', input),
      duplicate: input => rpc.call<CreatePromptResourceResult>('application.duplicatePromptResource', input),
      delete: resourceId => rpc.call<DeletePromptResourceResult>('application.deletePromptResource', { resourceId }),
      import: (artifact, name?: string) => rpc.call<CreatePromptResourceResult>('application.importPromptResource', {
        artifact: artifact,
        ...(name ? { name } : {}),
      }),
      export: resourceId => rpc.call<ExportPromptResourceResult>('application.exportPromptResource', { resourceId }),
      createAsset: input => rpc.call<UpdatePromptResourceResult>('application.createPromptResourceAsset', input),
      updateAsset: input => rpc.call<UpdatePromptResourceResult>('application.updatePromptResourceAsset', input),
      updateAssets: input => rpc.call<UpdatePromptResourceResult>('application.updatePromptResourceAssets', input),
      listSettingMounts: source => rpc.call<ListSettingMountsResult>('application.listSettingMounts', source ? { source } : {}),
      replaceSettingMounts: input => rpc.call<ReplaceSettingMountsResult>('application.replaceSettingMounts', input),
      listPresetToolMounts: input => rpc.call<ListPresetToolMountsResult>('application.listPresetToolMounts', (input ?? {})),
      replacePresetToolMounts: input => rpc.call<ReplacePresetToolMountsResult>('application.replacePresetToolMounts', input),
      moveAsset: input => rpc.call<UpdatePromptResourceResult>('application.movePromptResourceAsset', input),
      deleteAsset: input => rpc.call<UpdatePromptResourceResult>('application.deletePromptResourceAsset', input),
    },
    cardBundles: {
      import: input => rpc.call<ImportCardBundleResult>('application.importCardBundle', input),
    },
    portableExtensionPayloads: {
      list: packageId => rpc.call<ListPortableExtensionPayloadsResult>('application.listPortableExtensionPayloads', packageId ? { packageId } : {}),
      get: payloadId => rpc.call<GetPortableExtensionPayloadResult>('application.getPortableExtensionPayload', { payloadId }),
      create: input => rpc.call<MutatePortableExtensionPayloadResult>('application.createPortableExtensionPayload', input),
      update: input => rpc.call<MutatePortableExtensionPayloadResult>('application.updatePortableExtensionPayload', input),
      delete: input => rpc.call<{ deleted: true; mutation: MutationReceipt }>('application.deletePortableExtensionPayload', input),
      replaceCardBindings: input => rpc.call<UpdateCardResult>('application.replaceCardPortableExtensionPayloads', input),
    },
  }
}
