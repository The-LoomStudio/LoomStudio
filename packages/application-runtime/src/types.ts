import type {
  AgentTranscriptEntry,
  AgentTranscriptPage,
  AgentSession,
  AgentStore,
} from '@loom-studio/agent-store'
import type { DocumentStore } from '@loom-studio/document-store'
import type { AiGatewayCapabilityRegistry, ProviderAdapterRegistry } from '@loom-studio/ai-gateway'
import type { DataActorRef, SqliteDataEngine } from '@loom-studio/data-engine'
import type {
  ExtensionAgentToolContribution,
  ExtensionEntityRef,
  ExtensionPromptResourceContribution,
  ExtensionRecordEntry,
  ExtensionStorageScope,
} from '@loom-studio/extension-sdk'
export type { ExtensionEntityRef, ExtensionRecordEntry, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import type { Logger } from '@loom-studio/logging'
import type {
  NarrativeBranch,
  NarrativeNode,
  NarrativePage,
  NarrativeStore,
  NarrativeTimeline,
} from '@loom-studio/narrative-store'
import type { AssistantChatMessage, ChatMessage, JsonObject, JsonValue } from '@loom-studio/shared'
import type { SecretRef, SecretStore } from '@loom-studio/secret-store'
import type { StateStore } from '@loom-studio/state-store'
import type { PresetToolMount, PromptResourceStore, SettingMount, SettingMountSource } from '@loom-studio/prompt-resource-store'
export type { PresetToolMount, SettingMount, SettingMountSource } from '@loom-studio/prompt-resource-store'
import type { ActivationFacts, PromptActivation } from './prompt-activation.js'
import type { AgentToolRegistry, ToolDefinition } from './agent/tool-registry.js'
import type {
  CompiledToolExposure,
  ToolPromptBuildTrace,
} from './agent/tool-prompt-build.js'
import type { OpenAIChatPayload } from './provider-payload.js'
import type { PromptBuildTrace } from './prompt-build-pipeline.js'
import type {
  HistoryProjectionSnapshot,
  HistorySource,
  RendererDefinition,
  TextExtractionResult,
  TextExtractorDraft,
  TextExtractorEntry,
  TextTransformPhase,
  TextTransformRuleDraft,
  TextTransformRuleEntry,
} from './history-text.js'
import type { CompiledPrompt, CompositionSkeletonPatch, ProjectionOrderProfile } from './prompt-builder.js'
import type {
  CardBundleArtifact,
  ImportBundleContent,
  PortableExtensionPayloadArtifact,
  PromptResourceArtifact,
  PromptResourceCompositionCapabilities,
  PromptResourceContent,
  PromptResourceKind,
  PromptResourceNode,
} from './workspace.js'

export type ApplicationRuntime = {
  initialize(): Promise<void>
  getStateSnapshot(input: GetStateSnapshotInput): Promise<GetStateSnapshotResult>
  applyStateMutation(input: ApplyStateMutationInput, context?: RuntimeRequestContext): Promise<ApplyStateMutationResult>
  listStateDefinitions(input?: ListStateDefinitionsInput): Promise<ListStateDefinitionsResult>
  getStateDefinition(input: GetStateDefinitionInput): Promise<GetStateDefinitionResult>
  upsertStateDefinition(input: UpsertStateDefinitionInput, context?: RuntimeRequestContext): Promise<UpsertStateDefinitionResult>
  deleteStateDefinition(input: DeleteStateDefinitionInput, context?: RuntimeRequestContext): Promise<DeleteStateDefinitionResult>
  listTextTransformRules(): Promise<{ rules: TextTransformRuleEntry[] }>
  getTextTransformRule(input: { ruleId: string }): Promise<{ rule: TextTransformRuleEntry }>
  upsertTextTransformRule(input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft }, context?: RuntimeRequestContext): Promise<{ rule: TextTransformRuleEntry; mutation: MutationReceipt }>
  deleteTextTransformRule(input: { ruleId: string; expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  listTextExtractors(): Promise<{ extractors: TextExtractorEntry[] }>
  getTextExtractor(input: { extractorId: string }): Promise<{ extractor: TextExtractorEntry }>
  upsertTextExtractor(input: { extractorId: string; expectedVersion?: number; extractor: TextExtractorDraft }, context?: RuntimeRequestContext): Promise<{ extractor: TextExtractorEntry; mutation: MutationReceipt }>
  deleteTextExtractor(input: { extractorId: string; expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  projectHistory(input: { source: HistorySource; phase: TextTransformPhase }): Promise<{ snapshot: HistoryProjectionSnapshot }>
  extractHistory(input: { source: HistorySource; phase?: TextTransformPhase; extractorId: string }): Promise<{ extraction: TextExtractionResult; snapshot: HistoryProjectionSnapshot }>
  listRenderers(): Promise<{ renderers: RendererDefinition[] }>
  listExtensionRecords(input: { packageId: string; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<{ records: ExtensionRecordEntry[] }>
  getExtensionRecord(input: { packageId: string; recordId: string }): Promise<{ record: ExtensionRecordEntry | null }>
  createCard(input: CreateCardInput, context?: RuntimeRequestContext): Promise<CreateCardResult>
  getCard(input: GetCardInput): Promise<GetCardResult>
  listCards(input?: ListCardsInput): Promise<ListCardsResult>
  updateCard(input: UpdateCardInput, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  previewCardDeletion(input: PreviewCardDeletionInput): Promise<PreviewCardDeletionResult>
  deleteCard(input: DeleteCardInput, context?: RuntimeRequestContext): Promise<DeleteCardResult>
  listPortableExtensionPayloads(input?: ListPortableExtensionPayloadsInput): Promise<ListPortableExtensionPayloadsResult>
  getPortableExtensionPayload(input: GetPortableExtensionPayloadInput): Promise<GetPortableExtensionPayloadResult>
  createPortableExtensionPayload(input: CreatePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<CreatePortableExtensionPayloadResult>
  updatePortableExtensionPayload(input: UpdatePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<UpdatePortableExtensionPayloadResult>
  deletePortableExtensionPayload(input: DeletePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<DeletePortableExtensionPayloadResult>
  replaceCardPortableExtensionPayloads(input: ReplaceCardPortableExtensionPayloadsInput, context?: RuntimeRequestContext): Promise<ReplaceCardPortableExtensionPayloadsResult>
  createProviderProfile(input: CreateProviderProfileInput, context?: RuntimeRequestContext): Promise<CreateProviderProfileResult>
  getProviderProfile(input: GetProviderProfileInput): Promise<GetProviderProfileResult>
  listProviderProfiles(input?: ListProviderProfilesInput): Promise<ListProviderProfilesResult>
  updateProviderProfile(input: UpdateProviderProfileInput): Promise<UpdateProviderProfileResult>
  replaceProviderCredential(input: ReplaceProviderCredentialInput, context?: RuntimeRequestContext): Promise<ReplaceProviderCredentialResult>
  deleteProviderProfile(input: DeleteProviderProfileInput, context?: RuntimeRequestContext): Promise<DeleteProviderProfileResult>
  createAiCapabilityProfile(input: CreateAiCapabilityProfileInput): Promise<CreateAiCapabilityProfileResult>
  getAiCapabilityProfile(input: GetAiCapabilityProfileInput): Promise<GetAiCapabilityProfileResult>
  listAiCapabilityProfiles(input?: ListAiCapabilityProfilesInput): Promise<ListAiCapabilityProfilesResult>
  updateAiCapabilityProfile(input: UpdateAiCapabilityProfileInput): Promise<UpdateAiCapabilityProfileResult>
  deleteAiCapabilityProfile(input: DeleteAiCapabilityProfileInput): Promise<DeleteAiCapabilityProfileResult>
  listProviderModels(input: ListProviderModelsInput, context?: RuntimeRequestContext): Promise<ListProviderModelsResult>
  pingProviderModel(input: PingProviderModelInput, context?: RuntimeRequestContext): Promise<PingProviderModelResult>
  listAgentTools(): Promise<{ tools: AgentToolEntry[] }>
  importExtensionPackageResources(input: ImportExtensionPackageResourcesInput, context?: RuntimeRequestContext): Promise<ImportExtensionPackageResourcesResult>
  removeExtensionPackageResources(input: RemoveExtensionPackageResourcesInput, context?: RuntimeRequestContext): Promise<RemoveExtensionPackageResourcesResult>
  updateAgentTool(input: UpdateAgentToolInput): Promise<UpdateAgentToolResult>
  listPresetToolMounts(input?: ListPresetToolMountsInput): Promise<ListPresetToolMountsResult>
  replacePresetToolMounts(input: ReplacePresetToolMountsInput, context?: RuntimeRequestContext): Promise<ReplacePresetToolMountsResult>
  createAgentProfile(input: CreateAgentProfileInput): Promise<CreateAgentProfileResult>
  getAgentProfile(input: GetAgentProfileInput): Promise<GetAgentProfileResult>
  listAgentProfiles(input?: ListAgentProfilesInput): Promise<ListAgentProfilesResult>
  updateAgentProfile(input: UpdateAgentProfileInput): Promise<UpdateAgentProfileResult>
  deleteAgentProfile(input: DeleteAgentProfileInput): Promise<DeleteAgentProfileResult>
  createAgentSession(input: CreateAgentSessionInput, context?: RuntimeRequestContext): Promise<CreateAgentSessionResult>
  getAgentSession(input: GetAgentSessionInput): Promise<GetAgentSessionResult>
  getAgentTranscriptPage(input: GetAgentTranscriptPageInput): Promise<AgentTranscriptPage>
  appendAgentTranscriptEntries(input: AppendAgentTranscriptEntriesInput, context?: RuntimeRequestContext): Promise<AppendAgentTranscriptEntriesResult>
  deleteAgentSession(input: DeleteAgentSessionInput, context?: RuntimeRequestContext): Promise<DeleteAgentSessionResult>
  invokeAgentTurn(input: InvokeAgentTurnInput, context?: RuntimeRequestContext): Promise<InvokeAgentTurnResult>
  previewAgentTurn(input: PreviewAgentTurnInput, context?: RuntimeRequestContext): Promise<PreviewAgentTurnResult>
  createNarrativeTimeline(input: CreateNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult>
  getNarrativeTimeline(input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult>
  listNarrativeTimelines(input?: ListNarrativeTimelinesInput): Promise<ListNarrativeTimelinesResult>
  getNarrativePage(input: GetNarrativePageInput): Promise<NarrativePage>
  forkNarrativeBranch(input: ForkNarrativeBranchInput, context?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult>
  switchNarrativeBranch(input: SwitchNarrativeBranchInput, context?: RuntimeRequestContext): Promise<SwitchNarrativeBranchResult>
  deleteNarrativeTimeline(input: DeleteNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult>
  importCardBundle(input: ImportCardBundleInput, context?: RuntimeRequestContext): Promise<ImportCardBundleResult>
  getPromptResource(input: GetPromptResourceInput): Promise<GetPromptResourceResult>
  listPromptResources(input?: ListPromptResourcesInput): Promise<ListPromptResourcesResult>
  createPromptResource(input: CreatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  duplicatePromptResource(input: DuplicatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  deletePromptResource(input: DeletePromptResourceInput, context?: RuntimeRequestContext): Promise<DeletePromptResourceResult>
  revertPromptResourceChangeset(input: RevertPromptResourceChangesetInput, context?: RuntimeRequestContext): Promise<RevertPromptResourceChangesetResult>
  revertChangeset(input: { changesetId: string }, context?: RuntimeRequestContext): Promise<{ mutation: MutationReceipt }>
  importPromptResource(input: ImportPromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  exportPromptResource(input: ExportPromptResourceInput): Promise<ExportPromptResourceResult>
  updateCardPromptResources(input: UpdateCardPromptResourcesInput, context?: RuntimeRequestContext): Promise<UpdateCardPromptResourcesResult>
  listSettingMounts(input?: ListSettingMountsInput): Promise<ListSettingMountsResult>
  replaceSettingMounts(input: ReplaceSettingMountsInput, context?: RuntimeRequestContext): Promise<ReplaceSettingMountsResult>
  createPromptResourceAsset(input: CreatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAsset(input: UpdatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAssets(input: UpdatePromptResourceAssetsInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  movePromptResourceAsset(input: MovePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  deletePromptResourceAsset(input: DeletePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  exportCardBundle(input: ExportCardBundleInput): Promise<ExportCardBundleResult>
}

export type RuntimeRequestContext = {
  actor?: DataActorRef
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  abortSignal?: AbortSignal
}

export type StateTarget =
  | { scope: 'global' }
  | { scope: 'timeline'; timelineId: string; branchId: string }

export type StateMutationOperation =
  | { op: 'set'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'increment'; path: string; by: number }

export type StateSnapshotView = {
  scopeId: string
  target: StateTarget
  revisionId: string
  value: JsonObject
  createdAt: string
}

export type GetStateSnapshotInput = {
  target: StateTarget
}

export type GetStateSnapshotResult = {
  snapshot: StateSnapshotView
}

export type ApplyStateMutationInput = {
  target: StateTarget
  expectedRevisionId: string
  operations: StateMutationOperation[]
  idempotencyKey?: string
}

export type ApplyStateMutationResult = {
  snapshot: StateSnapshotView
  mutation: MutationReceipt
}

export type GlobalStateDefinitionDraft = {
  kind: 'global'
  path: string
  schema: JsonObject
  default?: JsonValue
  readOnly?: boolean
  label?: string
}

export type TimelineStateTemplateDraft = {
  kind: 'timeline-template'
  templateVersion: number
  schema: JsonObject
  initial: JsonObject
  label?: string
}

export type StateDefinitionDraft = GlobalStateDefinitionDraft | TimelineStateTemplateDraft

export type StateDefinitionContent = StateDefinitionDraft & {
  createdAt: string
  updatedAt: string
}

export type StateDefinitionEntry = StateDefinitionContent & {
  id: string
  version: number
}

export type TimelineStateBinding = {
  path: string
  templateId: string
  templateVersion: number
  initial?: JsonObject
}

export type TimelineRuntimeContextContent = {
  timelineId: string
  sourceCardId: string
  sourceCardVersion: number
  fallbackUserName: string
  stateBindings: Array<{
    path: string
    schema: JsonObject
  }>
  textTransformRules: TextTransformRuleEntry[]
  createdAt: string
}

export type ListStateDefinitionsInput = {
  kind?: StateDefinitionDraft['kind']
}

export type ListStateDefinitionsResult = {
  definitions: StateDefinitionEntry[]
}

export type GetStateDefinitionInput = {
  definitionId: string
}

export type GetStateDefinitionResult = {
  definition: StateDefinitionEntry
}

export type UpsertStateDefinitionInput = {
  definitionId: string
  expectedVersion?: number
  definition: StateDefinitionDraft
}

export type UpsertStateDefinitionResult = {
  definition: StateDefinitionEntry
  mutation: MutationReceipt
}

export type DeleteStateDefinitionInput = {
  definitionId: string
  expectedVersion?: number
}

export type DeleteStateDefinitionResult = {
  deleted: true
  mutation: MutationReceipt
}

export type ListSettingMountsInput = {
  source?: SettingMountSource
}

export type ListSettingMountsResult = {
  mounts: SettingMount[]
}

export type ReplaceSettingMountsInput = {
  source: SettingMountSource
  settingResourceIds: string[]
}

export type ReplaceSettingMountsResult = {
  mounts: SettingMount[]
  mutation: MutationReceipt
}

export type ListPresetToolMountsInput = {
  presetId?: string
  toolId?: string
}

export type ListPresetToolMountsResult = {
  mounts: PresetToolMount[]
}

export type PresetToolMountInput = {
  toolId: string
  orderIndex: number
  defaultEnabled: boolean
  activation?: PromptActivation
  provider?: PresetToolMount['provider']
  content?: PresetToolMount['content']
}

export type ReplacePresetToolMountsInput = {
  presetId: string
  mounts: PresetToolMountInput[]
}

export type ReplacePresetToolMountsResult = {
  mounts: PresetToolMount[]
  mutation: MutationReceipt
}

export type MutationReceipt = {
  changesetId: string
}

export type CreateNarrativeTimelineInput = {
  cardId: string
  title?: string
}

export type CreateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  mutation: MutationReceipt
}

export type GetNarrativeTimelineInput = {
  timelineId: string
}

export type GetNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branches: NarrativeBranch[]
}

export type ListNarrativeTimelinesInput = {
  createdFromCardId?: string
  cursor?: string
  limit?: number
}

export type ListNarrativeTimelinesResult = {
  timelines: NarrativeTimeline[]
  nextCursor?: string
}

export type GetNarrativePageInput = {
  timelineId: string
  branchId?: string
  cursor?: string
  limit?: number
}

export type ForkNarrativeBranchInput = {
  timelineId: string
  fromBranchId: string
  fromNodeId: string
  title?: string
}

export type ForkNarrativeBranchResult = {
  branch: NarrativeBranch
  mutation: MutationReceipt
}

export type SwitchNarrativeBranchInput = {
  timelineId: string
  branchId: string
  expectedActiveBranchId?: string
}

export type SwitchNarrativeBranchResult = {
  timeline: NarrativeTimeline
  mutation: MutationReceipt
}

export type DeleteNarrativeTimelineInput = {
  timelineId: string
}

export type DeleteNarrativeTimelineResult = {
  deleted: true
  mutation: MutationReceipt
}

export type CreateAgentSessionInput = {
  agentProfileId: string
  title?: string
}

export type CreateAgentSessionResult = {
  session: AgentSession
  mutation: MutationReceipt
}

export type GetAgentSessionInput = {
  agentSessionId: string
}

export type GetAgentSessionResult = {
  session: AgentSession
}

export type GetAgentTranscriptPageInput = {
  agentSessionId: string
  cursor?: string
  limit?: number
}

export type AppendAgentTranscriptEntriesInput = {
  agentSessionId: string
  expectedEntryCount: number
  entries: Array<{
    id?: string
    runId?: string
    entry: import('@loom-studio/agent-store').AgentTranscriptEntryData
  }>
}

export type AppendAgentTranscriptEntriesResult = {
  session: AgentSession
  entries: AgentTranscriptEntry[]
  mutation: MutationReceipt
}

export type DeleteAgentSessionInput = {
  agentSessionId: string
}

export type DeleteAgentSessionResult = {
  deleted: true
  mutation: MutationReceipt
}

export type InvokeAgentTurnInput = {
  agentSessionId: string
  input: string
  activationFacts?: ActivationFacts
  narrativeTarget?: {
    timelineId: string
    branchId?: string
    commit: boolean
  }
}

export type PreviewAgentTurnInput = InvokeAgentTurnInput

export type PreviewAgentTurnResult = {
  runId: string
  messages: ChatMessage[]
  projection: CompiledPrompt
  promptBuildTrace: PromptBuildTrace
  toolExposures: CompiledToolExposure[]
  toolPromptBuildTrace: ToolPromptBuildTrace
  providerPayloadPreview?: OpenAIChatPayload
}

export type InvokeAgentTurnResult = {
  runId: string
  agentSession: AgentSession
  entries: {
    user: AgentTranscriptEntry
    assistant: AgentTranscriptEntry
  }
  narrative?: {
    timeline: NarrativeTimeline
    branch: NarrativeBranch
    nodes: NarrativeNode[]
    node: NarrativeNode
  }
  provider: {
    provider: string
    model: string
    finishReason?: GatewayChatResult['finishReason']
    usage?: GatewayChatResult['usage']
    providerCallId?: string
  }
  projection: CompiledPrompt
  promptBuildTrace: PromptBuildTrace
  toolExposures: CompiledToolExposure[]
  toolPromptBuildTrace: ToolPromptBuildTrace
  mutation: MutationReceipt
}

export type ApplicationRuntimeOptions = {
  agents?: AgentStore
  agentTools?: AgentToolRegistry
  dataEngine?: SqliteDataEngine
  documents: DocumentStore
  narratives?: NarrativeStore
  promptResources: PromptResourceStore
  states?: StateStore
  logger?: Logger
  gateway?: AiGateway
  provider?: ApplicationProvider
  clock?: { now(): Date }
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets?: SecretStore
  providerAdapters?: ProviderAdapterRegistry
  aiCapabilities?: AiGatewayCapabilityRegistry
}

export type MediaAssetLookup = {
  get(assetId: string): Promise<{ id: string } | undefined>
}

export type SourceArtifactStorage = {
  preserve(input: {
    source: Uint8Array
    format: string
    originalFileName?: string
    mediaType?: string
    importerVersion?: string
    actor: DataActorRef
    reason: string
    correlationId?: string
    callId?: string
    parentCallId?: string
  }): Promise<{
    sourceArtifactId: string
    blobId: string
    sha256: string
    sizeBytes: number
    originalFileName?: string
    mediaType?: string
  }>
}

export type AiGateway = {
  invokeChat(input: GatewayInvokeChatInput): Promise<GatewayChatResult>
  listModels?(input: GatewayListModelsInput): Promise<GatewayListModelsResult>
}

export type GatewayListModelsInput = {
  providerProfileId: string
  context?: RuntimeRequestContext
}

export type GatewayListModelsResult = {
  modelIds: string[]
}

export type ApplicationProvider = {
  invoke(input: ProviderInvokeInput): Promise<ProviderInvokeResult>
}

export type ProviderMessage = ChatMessage

export type ProviderInvokeInput = {
  messages: ProviderMessage[]
  runId: string
  sessionId: string
  branchId: string
}

export type ProviderInvokeResult = {
  message?: AssistantChatMessage
  content: string
  model: string
  provider: string
  raw?: JsonValue
}

export type ProviderModelSelection = {
  providerProfileId: string
  modelId: string
}

export type GatewayInvokeChatInput = {
  model?: ProviderModelSelection
  request: CanonicalChatRequest
  runId: string
  sessionId: string
  branchId: string
  context?: RuntimeRequestContext
  abortSignal?: AbortSignal
}

export type CanonicalChatRequest = {
  messages: ProviderMessage[]
  tools?: Array<{ name: string; description?: string; inputSchema: JsonObject }>
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
  metadata?: JsonObject
}

export type GatewayChatResult = {
  message: AssistantChatMessage
  text: string
  model: string
  provider: string
  finishReason?: 'stop' | 'length' | 'tool_call' | 'error'
  rawStopReason?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  providerCallId?: string
  raw?: JsonValue
}

export type ProviderProfileConfig = {
  id: string
  providerExtensionId: string
  displayName: string
  config?: {
    baseUrl?: string
  } & JsonObject
  enabledModelIds: string[]
}

export type OpenAICompatibleGatewayOptions = {
  providerProfile: ProviderProfileConfig
  modelId: string
  apiKey: string
  fetch?: typeof fetch
}

export type CreateCardInput = {
  name: string
  userName?: string
  description?: string
  preset?: CardPresetInput
  opening?: OpeningChatInput | string
  setting?: JsonObject
  settingLayer?: SettingLayerInput
  media?: CardMediaRefs
}

export type CreateCardResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type GetCardInput = {
  cardId: string
}

export type GetCardResult = {
  card: CardSourceContent & { id: string; version: number }
}

export type ListCardsInput = {
  limit?: number
  cursor?: string
}

export type ListCardsResult = {
  cards: CardSummary[]
  nextCursor?: string
}

export type CardSummary = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
  media?: CardMediaRefs
  createdAt: string
  updatedAt: string
}

export type UpdateCardInput = {
  cardId: string
  name?: string
  userName?: string
  description?: string
  preset?: CardPresetInput
  opening?: OpeningChatInput | string
  settingLayer?: SettingLayerInput
  media?: CardMediaRefs
  stateDefinitionIds?: string[]
  timelineStateBindings?: TimelineStateBinding[]
}

export type UpdateCardResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type DeleteCardInput = {
  cardId: string
  includePlayData?: boolean
}

export type PreviewCardDeletionInput = {
  cardId: string
}

export type PreviewCardDeletionResult = {
  cardId: string
  timelines: Array<{ id: string; title?: string }>
  extensionData: {
    cardScoped: { configs: number; records: number }
    timelineScoped: { configs: number; records: number }
  }
  textTransformRuleIds: string[]
}

export type DeleteCardResult = {
  deleted: true
  mutation: MutationReceipt
}

export type PortableExtensionPayloadDraft = Omit<PortableExtensionPayloadArtifact, 'id'>

export type PortableExtensionPayloadEntry = PortableExtensionPayloadDraft & {
  id: string
  artifactPayloadId: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ListPortableExtensionPayloadsInput = {
  packageId?: string
}

export type ListPortableExtensionPayloadsResult = {
  payloads: PortableExtensionPayloadEntry[]
}

export type GetPortableExtensionPayloadInput = {
  payloadId: string
}

export type GetPortableExtensionPayloadResult = {
  payload: PortableExtensionPayloadEntry
}

export type CreatePortableExtensionPayloadInput = {
  artifactPayloadId?: string
  payload: PortableExtensionPayloadDraft
}

export type CreatePortableExtensionPayloadResult = {
  payload: PortableExtensionPayloadEntry
  mutation: MutationReceipt
}

export type UpdatePortableExtensionPayloadInput = {
  payloadId: string
  expectedVersion: number
  payload: PortableExtensionPayloadDraft
}

export type UpdatePortableExtensionPayloadResult = CreatePortableExtensionPayloadResult

export type DeletePortableExtensionPayloadInput = {
  payloadId: string
  expectedVersion: number
}

export type DeletePortableExtensionPayloadResult = {
  deleted: true
  mutation: MutationReceipt
}

export type ReplaceCardPortableExtensionPayloadsInput = {
  cardId: string
  expectedVersion: number
  payloadIds: string[]
}

export type ReplaceCardPortableExtensionPayloadsResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type ProviderCredentialStatus = {
  configured: boolean
  updatedAt?: string
}

export type ProviderProfileView = {
  id: string
  version: number
  providerExtensionId: string
  displayName: string
  config: JsonObject
  enabledModelIds: string[]
  credential: ProviderCredentialStatus
  createdAt: string
  updatedAt: string
}

export type CreateProviderProfileInput = {
  providerExtensionId: string
  displayName: string
  config?: JsonObject
  enabledModelIds?: string[]
  credential?: Record<string, string>
}

export type CreateProviderProfileResult = {
  providerProfile: ProviderProfileView
}

export type GetProviderProfileInput = {
  providerProfileId: string
}

export type GetProviderProfileResult = {
  providerProfile: ProviderProfileView
}

export type ListProviderProfilesInput = {
  limit?: number
  cursor?: string
}

export type ListProviderProfilesResult = {
  providerProfiles: ProviderProfileView[]
  nextCursor?: string
}

export type UpdateProviderProfileInput = {
  providerProfileId: string
  displayName?: string
  config?: JsonObject
  enabledModelIds?: string[]
}

export type UpdateProviderProfileResult = {
  providerProfile: ProviderProfileView
}

export type ReplaceProviderCredentialInput = {
  providerProfileId: string
  credential: Record<string, string>
}

export type ReplaceProviderCredentialResult = {
  credential: ProviderCredentialStatus
}

export type DeleteProviderProfileInput = {
  providerProfileId: string
}

export type DeleteProviderProfileResult = {
  deleted: true
  credentialCleanupPending: boolean
}

export type AiCapabilityProfileView = {
  id: string
  version: number
  providerProfileId: string
  providerExtensionId: string
  capabilityId: string
  displayName: string
  config: JsonObject
  available: boolean
  createdAt: string
  updatedAt: string
}

export type CreateAiCapabilityProfileInput = {
  providerProfileId: string
  capabilityId: string
  displayName: string
  config?: JsonObject
}

export type CreateAiCapabilityProfileResult = {
  profile: AiCapabilityProfileView
}

export type GetAiCapabilityProfileInput = {
  profileId: string
}

export type GetAiCapabilityProfileResult = {
  profile: AiCapabilityProfileView
}

export type ListAiCapabilityProfilesInput = {
  providerProfileId?: string
  capabilityId?: string
  limit?: number
  cursor?: string
}

export type ListAiCapabilityProfilesResult = {
  profiles: AiCapabilityProfileView[]
  nextCursor?: string
}

export type UpdateAiCapabilityProfileInput = {
  profileId: string
  displayName?: string
  config?: JsonObject
}

export type UpdateAiCapabilityProfileResult = {
  profile: AiCapabilityProfileView
}

export type DeleteAiCapabilityProfileInput = {
  profileId: string
}

export type DeleteAiCapabilityProfileResult = {
  deleted: true
}

export type ListProviderModelsInput = {
  providerProfileId: string
}

export type ListProviderModelsResult = {
  modelIds: string[]
}

export type PingProviderModelInput = ProviderModelSelection & {
  text?: string
}

export type PingProviderModelResult = {
  text: string
  provider: string
  model: string
  raw?: JsonValue
}

export type AgentHistoryPolicy = 'persistent' | 'ephemeral'

export type CreateAgentProfileInput = {
  name: string
  presetId: string
  model: ProviderModelSelection
  toolOverrides?: Record<string, boolean>
}
export type CreateAgentProfileResult = {
  agentProfile: AgentProfileContent & { id: string; version: number }
}
export type GetAgentProfileInput = { agentProfileId: string }
export type GetAgentProfileResult = CreateAgentProfileResult
export type ListAgentProfilesInput = { limit?: number; cursor?: string }
export type ListAgentProfilesResult = {
  agentProfiles: Array<AgentProfileContent & { id: string; version: number }>
  nextCursor?: string
}
export type UpdateAgentProfileInput = {
  agentProfileId: string
  name?: string
  presetId?: string
  model?: ProviderModelSelection
  toolOverrides?: Record<string, boolean>
}
export type UpdateAgentProfileResult = CreateAgentProfileResult
export type DeleteAgentProfileInput = { agentProfileId: string }
export type DeleteAgentProfileResult = { deleted: true }

export type ImportCardBundleInput =
  | {
    artifact: CardBundleArtifact
    source?: never
  }
  | {
    artifact?: never
    source: {
      text: string
      originalFileName?: string
    }
  }

export type ImportCardBundleResult = {
  card: CardSourceContent & { id: string; version: number }
  importBundle: ImportBundleContent & { id: string; version: number }
}

export type GetPromptResourceInput = {
  resourceId: string
}

export type GetPromptResourceResult = {
  resource: PromptResourceContent & { id: string; version: number }
}

export type ListPromptResourcesInput = {
  resourceKind?: PromptResourceKind
}

export type ListPromptResourcesResult = {
  resources: Array<PromptResourceContent & { id: string; version: number }>
}

export type CreatePromptResourceInput = {
  resourceKind: PromptResourceKind
  name: string
}

export type CreatePromptResourceResult = {
  resource: PromptResourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type DuplicatePromptResourceInput = {
  resourceId: string
  name?: string
}

export type DeletePromptResourceInput = {
  resourceId: string
}

export type DeletePromptResourceResult = {
  deleted: true
  detachedReferences: {
    presets: number
    cards: number
    timelines: number
  }
  mutation: MutationReceipt
}

export type RevertPromptResourceChangesetInput = {
  changesetId: string
  expectedVersion?: number
}

export type RevertPromptResourceChangesetResult = {
  mutation: MutationReceipt
}

export type ImportPromptResourceInput = {
  artifact: PromptResourceArtifact
}

export type ExportPromptResourceInput = {
  resourceId: string
}

export type ExportPromptResourceResult = {
  artifact: PromptResourceArtifact
}

export type UpdateCardPromptResourcesInput = {
  cardId: string
  promptResourceIds: string[]
}

export type UpdateCardPromptResourcesResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type CreatePromptResourceAssetInput = {
  resourceId: string
  targetAssetId: string
  position: 'before' | 'inside' | 'after'
  asset: PromptResourceNode
}

export type UpdatePromptResourceAssetInput = {
  resourceId: string
  assetId: string
  body?: string
  capabilities?: PromptResourceCompositionCapabilities
  label?: string
  meta?: string
  enabled?: boolean
  orderList?: string[]
  skeletonPatch?: PromptResourceNode['skeletonPatch']
  slotRanks?: PromptResourceNode['slotRanks']
}

export type UpdatePromptResourceAssetsInput = {
  resourceId: string
  updates: PromptAssetPatch[]
}

export type MovePromptResourceAssetInput = {
  resourceId: string
  assetId: string
  targetAssetId: string
  position: 'before' | 'inside' | 'after'
}

export type DeletePromptResourceAssetInput = {
  resourceId: string
  assetId: string
}

export type UpdatePromptResourceResult = {
  resource: PromptResourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type PromptAssetPatch = {
  assetId: string
  body?: string
  capabilities?: PromptResourceCompositionCapabilities
  label?: string
  meta?: string
  enabled?: boolean
  orderList?: string[]
  skeletonPatch?: CompositionSkeletonPatch
  slotRanks?: ProjectionOrderProfile['slotRanks']
}

export type ExportCardBundleInput = {
  cardId: string
}

export type ExportCardBundleResult = {
  artifact: CardBundleArtifact
}

export type ProviderProfileContent = {
  providerExtensionId: string
  displayName: string
  config: JsonObject
  secretRef?: SecretRef
  enabledModelIds: string[]
  createdAt: string
  updatedAt: string
}

export type AiCapabilityProfileContent = {
  providerProfileId: string
  capabilityId: string
  displayName: string
  config: JsonObject
  createdAt: string
  updatedAt: string
}

export type AgentProfileContent = {
  name: string
  presetId: string
  model: ProviderModelSelection
  toolOverrides: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

export type AgentToolContent = Omit<ToolDefinition, 'id'> & {
  origin?: ExtensionPackageResourceOrigin
  createdAt: string
  updatedAt: string
}

export type AgentToolEntry = ToolDefinition & {
  origin?: ExtensionPackageResourceOrigin
  version: number
  createdAt: string
  updatedAt: string
}

export type UpdateAgentToolInput = {
  toolId: string
  expectedVersion: number
  definition: ToolDefinition
}

export type UpdateAgentToolResult = {
  tool: AgentToolEntry
}

export type ExtensionPackageResourceOrigin = {
  kind: 'extension-package'
  packageId: string
  packageVersion: string
  contributionId: string
}

export type ImportExtensionPackageResourcesInput = {
  packageId: string
  packageVersion: string
  promptResources: Array<{
    contribution: ExtensionPromptResourceContribution
    artifact: JsonValue
  }>
  agentTools: Array<{
    contribution: ExtensionAgentToolContribution
    definition: JsonValue
  }>
}

export type ImportExtensionPackageResourcesResult = {
  promptResources: Array<{ contributionId: string; resourceId: string; resourceKind: PromptResourceKind }>
  agentTools: Array<{ contributionId: string; toolId: string }>
  mutation?: MutationReceipt
}

export type RemoveExtensionPackageResourcesInput = {
  packageId: string
}

export type RemoveExtensionPackageResourcesResult = {
  packageId: string
  promptResourceIds: string[]
  agentToolIds: string[]
  detachedReferences: {
    cards: number
    timelines: number
    agentProfiles: number
    presetToolMounts: number
  }
  mutation?: MutationReceipt
}

export type CardSourceContent = {
  name: string
  userName?: string
  description?: string
  importBundleId?: string
  portableExtensionPayloadIds?: string[]
  promptResourceIds?: string[]
  stateDefinitionIds?: string[]
  timelineStateBindings?: TimelineStateBinding[]
  media?: CardMediaRefs
  preset: CardPresetContent
  opening: OpeningChatContent
  settingLayer: SettingLayerContent
  createdAt: string
  updatedAt: string
}

export type CardMediaRefs = {
  avatarAssetId?: string
  coverAssetId?: string
}

export type CardPresetInput = {
  system?: string
}

export type CardPresetContent = {
  system?: string
}

export type OpeningChatInput = {
  entries?: OpeningChatEntryInput[]
}

export type OpeningChatContent = {
  entries: OpeningChatEntryContent[]
}

export type OpeningChatEntryInput = {
  role?: 'user' | 'assistant'
  content: string
}

export type OpeningChatEntryContent = {
  role: 'user' | 'assistant'
  content: string
}

export type SettingLayerInput = {
  entries?: SettingEntryInput[]
}

export type SettingLayerContent = {
  entries: SettingEntryContent[]
}

export type SettingEntryInput = {
  id?: string
  path?: string
  title?: string
  content: string
  enabled?: boolean
  activation?: SettingActivation
  tags?: string[]
}

export type SettingEntryContent = {
  id: string
  path?: string
  title?: string
  content: string
  enabled: boolean
  activation: SettingActivation
  tags: string[]
}

export type SettingActivation = PromptActivation
