import type {
  AgentMessage,
  AgentMessagePage,
  AgentSession,
  AgentStore,
} from '@loom-studio/agent-store'
import type { DocumentStore } from '@loom-studio/document-store'
import type { DataActorRef, SqliteDataEngine } from '@loom-studio/data-engine'
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
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import type { ActivationFacts, PromptActivation } from './prompt-activation.js'
import type { OpenAIChatPayload } from './provider-payload.js'
import type { PromptBuildTrace } from './prompt-build-pipeline.js'
import type { CompiledPrompt, CompositionSkeletonPatch, ProjectionOrderProfile } from './prompt-builder.js'
import type {
  CardBundleArtifact,
  ImportBundleContent,
  PromptResourceArtifact,
  PromptResourceCompositionCapabilities,
  PromptResourceContent,
  PromptResourceKind,
  PromptResourceNode,
} from './workspace.js'

export type ApplicationRuntime = {
  initialize(): Promise<void>
  createCard(input: CreateCardInput, context?: RuntimeRequestContext): Promise<CreateCardResult>
  getCard(input: GetCardInput): Promise<GetCardResult>
  listCards(input?: ListCardsInput): Promise<ListCardsResult>
  updateCard(input: UpdateCardInput, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  deleteCard(input: DeleteCardInput, context?: RuntimeRequestContext): Promise<DeleteCardResult>
  createProviderProfile(input: CreateProviderProfileInput, context?: RuntimeRequestContext): Promise<CreateProviderProfileResult>
  getProviderProfile(input: GetProviderProfileInput): Promise<GetProviderProfileResult>
  listProviderProfiles(input?: ListProviderProfilesInput): Promise<ListProviderProfilesResult>
  updateProviderProfile(input: UpdateProviderProfileInput): Promise<UpdateProviderProfileResult>
  replaceProviderCredential(input: ReplaceProviderCredentialInput, context?: RuntimeRequestContext): Promise<ReplaceProviderCredentialResult>
  deleteProviderProfile(input: DeleteProviderProfileInput, context?: RuntimeRequestContext): Promise<DeleteProviderProfileResult>
  listProviderModels(input: ListProviderModelsInput, context?: RuntimeRequestContext): Promise<ListProviderModelsResult>
  pingProviderModel(input: PingProviderModelInput, context?: RuntimeRequestContext): Promise<PingProviderModelResult>
  createAgentProfile(input: CreateAgentProfileInput): Promise<CreateAgentProfileResult>
  getAgentProfile(input: GetAgentProfileInput): Promise<GetAgentProfileResult>
  listAgentProfiles(input?: ListAgentProfilesInput): Promise<ListAgentProfilesResult>
  updateAgentProfile(input: UpdateAgentProfileInput): Promise<UpdateAgentProfileResult>
  deleteAgentProfile(input: DeleteAgentProfileInput): Promise<DeleteAgentProfileResult>
  createAgentSession(input: CreateAgentSessionInput, context?: RuntimeRequestContext): Promise<CreateAgentSessionResult>
  getAgentSession(input: GetAgentSessionInput): Promise<GetAgentSessionResult>
  getAgentMessagePage(input: GetAgentMessagePageInput): Promise<AgentMessagePage>
  appendAgentMessages(input: AppendAgentMessagesInput, context?: RuntimeRequestContext): Promise<AppendAgentMessagesResult>
  deleteAgentSession(input: DeleteAgentSessionInput, context?: RuntimeRequestContext): Promise<DeleteAgentSessionResult>
  invokeAgentTurn(input: InvokeAgentTurnInput, context?: RuntimeRequestContext): Promise<InvokeAgentTurnResult>
  previewAgentTurn(input: PreviewAgentTurnInput, context?: RuntimeRequestContext): Promise<PreviewAgentTurnResult>
  createNarrativeTimelineFromCard(input: CreateNarrativeTimelineFromCardInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineFromCardResult>
  getNarrativeTimeline(input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult>
  listNarrativeTimelines(input?: ListNarrativeTimelinesInput): Promise<ListNarrativeTimelinesResult>
  getNarrativePage(input: GetNarrativePageInput): Promise<NarrativePage>
  forkNarrativeBranch(input: ForkNarrativeBranchInput, context?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult>
  switchNarrativeBranch(input: SwitchNarrativeBranchInput, context?: RuntimeRequestContext): Promise<SwitchNarrativeBranchResult>
  deleteNarrativeTimeline(input: DeleteNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult>
  importCardBundle(input: ImportCardBundleInput, context?: RuntimeRequestContext): Promise<ImportCardBundleResult>
  getImportBundle(input: GetImportBundleInput): Promise<GetImportBundleResult>
  getPromptResource(input: GetPromptResourceInput): Promise<GetPromptResourceResult>
  listPromptResources(input?: ListPromptResourcesInput): Promise<ListPromptResourcesResult>
  createPromptResource(input: CreatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  duplicatePromptResource(input: DuplicatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  deletePromptResource(input: DeletePromptResourceInput, context?: RuntimeRequestContext): Promise<DeletePromptResourceResult>
  revertPromptResourceChangeset(input: RevertPromptResourceChangesetInput, context?: RuntimeRequestContext): Promise<RevertPromptResourceChangesetResult>
  importPromptResource(input: ImportPromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  exportPromptResource(input: ExportPromptResourceInput): Promise<ExportPromptResourceResult>
  listCardPromptResources(input: ListCardPromptResourcesInput): Promise<ListCardPromptResourcesResult>
  updateCardPromptResources(input: UpdateCardPromptResourcesInput, context?: RuntimeRequestContext): Promise<UpdateCardPromptResourcesResult>
  updatePresetSettings(input: UpdatePresetSettingsInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  listGlobalSettingMounts(): Promise<ListGlobalSettingMountsResult>
  replaceGlobalSettingMounts(input: ReplaceGlobalSettingMountsInput, context?: RuntimeRequestContext): Promise<ReplaceGlobalSettingMountsResult>
  createPromptResourceAsset(input: CreatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAsset(input: UpdatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAssets(input: UpdatePromptResourceAssetsInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  movePromptResourceAsset(input: MovePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  deletePromptResourceAsset(input: DeletePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  exportCardArtifact(input: ExportCardArtifactInput): Promise<ExportCardBundleResult>
}

export type RuntimeRequestContext = {
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type SettingMountView = {
  id: string
  settingResourceId: string
  orderIndex: number
  origin: JsonObject
  createdAt: string
}

export type ListGlobalSettingMountsResult = { mounts: SettingMountView[] }

export type ReplaceGlobalSettingMountsInput = {
  settingResourceIds: string[]
}

export type ReplaceGlobalSettingMountsResult = {
  mounts: SettingMountView[]
  mutation: MutationReceipt
}

export type MutationReceipt = {
  changesetId: string
}

export type CreateNarrativeTimelineFromCardInput = {
  cardId: string
  title?: string
}

export type CreateNarrativeTimelineFromCardResult = {
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

export type GetAgentMessagePageInput = {
  agentSessionId: string
  cursor?: string
  limit?: number
}

export type AppendAgentMessagesInput = {
  agentSessionId: string
  expectedMessageCount: number
  messages: Array<{
    id?: string
    runId?: string
    message: ChatMessage
  }>
}

export type AppendAgentMessagesResult = {
  session: AgentSession
  messages: AgentMessage[]
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
  providerPayloadPreview?: OpenAIChatPayload
}

export type InvokeAgentTurnResult = {
  runId: string
  agentSession: AgentSession
  messages: {
    user: AgentMessage
    assistant: AgentMessage
  }
  narrative?: {
    timeline: NarrativeTimeline
    branch: NarrativeBranch
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
  mutation: MutationReceipt
}

export type ApplicationRuntimeOptions = {
  agents?: AgentStore
  dataEngine?: SqliteDataEngine
  documents: DocumentStore
  narratives?: NarrativeStore
  promptResources: PromptResourceStore
  logger?: Logger
  gateway?: AiGateway
  provider?: ApplicationProvider
  clock?: { now(): Date }
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets?: SecretStore
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
}

export type CanonicalChatRequest = {
  messages: ProviderMessage[]
  metadata?: JsonObject
}

export type GatewayChatResult = {
  message: AssistantChatMessage
  text: string
  model: string
  provider: string
  finishReason?: 'stop' | 'length' | 'tool_call' | 'error'
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
}

export type UpdateCardResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type DeleteCardInput = {
  cardId: string
}

export type DeleteCardResult = {
  deleted: true
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

export type GetImportBundleInput = {
  importBundleId: string
}

export type GetImportBundleResult = {
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

export type ListCardPromptResourcesInput = {
  cardId: string
}

export type ListCardPromptResourcesResult = {
  resources: Array<PromptResourceContent & { id: string; version: number }>
}

export type UpdateCardPromptResourcesInput = {
  cardId: string
  promptResourceIds: string[]
}

export type UpdateCardPromptResourcesResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type UpdatePresetSettingsInput = {
  presetId: string
  linkedSettingIds: string[]
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

export type ExportCardArtifactInput = {
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

export type AgentProfileContent = {
  name: string
  presetId: string
  model: ProviderModelSelection
  createdAt: string
  updatedAt: string
}

export type CardSourceContent = {
  name: string
  userName?: string
  description?: string
  importBundleId?: string
  promptResourceIds?: string[]
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
