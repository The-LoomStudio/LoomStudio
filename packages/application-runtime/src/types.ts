import type {
  AgentMessage,
  AgentMessagePage,
  AgentSession,
  AgentStore,
} from '@loom-studio/agent-store'
import type { DocumentStore } from '@loom-studio/document-store'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { Logger } from '@loom-studio/logging'
import type {
  NarrativeBranch,
  NarrativeNode,
  NarrativePage,
  NarrativeStore,
  NarrativeTimeline,
} from '@loom-studio/narrative-store'
import type { AssistantChatMessage, ChatMessage, JsonObject, JsonValue } from '@loom-studio/shared'
import type { ActivationFacts, PromptActivation } from './prompt-activation.js'
import type { OpenAIChatPayload } from './provider-payload.js'
import type { CompiledPrompt, CompositionSkeletonPatch, ProjectionOrderProfile } from './prompt-builder.js'
import type {
  CardBundleArtifact,
  ImportBundleContent,
  PromptResourceCompositionCapabilities,
  PromptResourceContent,
  PromptResourceNode,
} from './workspace.js'

export type ApplicationRuntime = {
  createCard(input: CreateCardInput, context?: RuntimeRequestContext): Promise<CreateCardResult>
  getCard(input: GetCardInput): Promise<GetCardResult>
  listCards(input?: ListCardsInput): Promise<ListCardsResult>
  updateCard(input: UpdateCardInput, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  deleteCard(input: DeleteCardInput, context?: RuntimeRequestContext): Promise<DeleteCardResult>
  createProviderAccount(input: CreateProviderAccountInput): Promise<CreateProviderAccountResult>
  getProviderAccount(input: GetProviderAccountInput): Promise<GetProviderAccountResult>
  listProviderAccounts(input?: ListProviderAccountsInput): Promise<ListProviderAccountsResult>
  updateProviderAccount(input: UpdateProviderAccountInput): Promise<UpdateProviderAccountResult>
  deleteProviderAccount(input: DeleteProviderAccountInput): Promise<DeleteProviderAccountResult>
  createModelProfile(input: CreateModelProfileInput): Promise<CreateModelProfileResult>
  getModelProfile(input: GetModelProfileInput): Promise<GetModelProfileResult>
  listModelProfiles(input?: ListModelProfilesInput): Promise<ListModelProfilesResult>
  updateModelProfile(input: UpdateModelProfileInput): Promise<UpdateModelProfileResult>
  deleteModelProfile(input: DeleteModelProfileInput): Promise<DeleteModelProfileResult>
  pingModelProfile(input: PingModelProfileInput, context?: RuntimeRequestContext): Promise<PingModelProfileResult>
  createAgentPreset(input: CreateAgentPresetInput): Promise<CreateAgentPresetResult>
  getAgentPreset(input: GetAgentPresetInput): Promise<GetAgentPresetResult>
  listAgentPresets(input?: ListAgentPresetsInput): Promise<ListAgentPresetsResult>
  updateAgentPreset(input: UpdateAgentPresetInput): Promise<UpdateAgentPresetResult>
  deleteAgentPreset(input: DeleteAgentPresetInput): Promise<DeleteAgentPresetResult>
  createAgentLocalBinding(input: CreateAgentLocalBindingInput): Promise<CreateAgentLocalBindingResult>
  getAgentLocalBinding(input: GetAgentLocalBindingInput): Promise<GetAgentLocalBindingResult>
  listAgentLocalBindings(input?: ListAgentLocalBindingsInput): Promise<ListAgentLocalBindingsResult>
  updateAgentLocalBinding(input: UpdateAgentLocalBindingInput): Promise<UpdateAgentLocalBindingResult>
  deleteAgentLocalBinding(input: DeleteAgentLocalBindingInput): Promise<DeleteAgentLocalBindingResult>
  createAgentSession(input: CreateAgentSessionInput, context?: RuntimeRequestContext): Promise<CreateAgentSessionResult>
  getAgentSession(input: GetAgentSessionInput): Promise<GetAgentSessionResult>
  getAgentMessagePage(input: GetAgentMessagePageInput): Promise<AgentMessagePage>
  appendAgentMessages(input: AppendAgentMessagesInput, context?: RuntimeRequestContext): Promise<AppendAgentMessagesResult>
  deleteAgentSession(input: DeleteAgentSessionInput, context?: RuntimeRequestContext): Promise<DeleteAgentSessionResult>
  invokeAgentTurn(input: InvokeAgentTurnInput, context?: RuntimeRequestContext): Promise<InvokeAgentTurnResult>
  previewAgentTurn(input: PreviewAgentTurnInput, context?: RuntimeRequestContext): Promise<PreviewAgentTurnResult>
  createNarrativeTimelineFromCard(input: CreateNarrativeTimelineFromCardInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineFromCardResult>
  getNarrativeTimeline(input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult>
  getNarrativePage(input: GetNarrativePageInput): Promise<NarrativePage>
  forkNarrativeBranch(input: ForkNarrativeBranchInput, context?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult>
  switchNarrativeBranch(input: SwitchNarrativeBranchInput, context?: RuntimeRequestContext): Promise<SwitchNarrativeBranchResult>
  deleteNarrativeTimeline(input: DeleteNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult>
  importCardBundle(input: ImportCardBundleInput, context?: RuntimeRequestContext): Promise<ImportCardBundleResult>
  getImportBundle(input: GetImportBundleInput): Promise<GetImportBundleResult>
  getPromptResource(input: GetPromptResourceInput): Promise<GetPromptResourceResult>
  listCardPromptResources(input: ListCardPromptResourcesInput): Promise<ListCardPromptResourcesResult>
  updateCardPromptResources(input: UpdateCardPromptResourcesInput, context?: RuntimeRequestContext): Promise<UpdateCardPromptResourcesResult>
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
  agentPresetId: string
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
  localBindingId?: string
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
  mutation: MutationReceipt
}

export type ApplicationRuntimeOptions = {
  agents?: AgentStore
  dataEngine?: SqliteDataEngine
  documents: DocumentStore
  narratives?: NarrativeStore
  logger?: Logger
  gateway?: AiGateway
  provider?: ApplicationProvider
  clock?: { now(): Date }
}

export type AiGateway = {
  invokeChat(input: GatewayInvokeChatInput): Promise<GatewayChatResult>
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

export type GatewayInvokeChatInput = {
  modelProfileId?: string
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

export type ProviderAccountConfig = {
  id: string
  providerExtensionId: string
  displayName: string
  config?: {
    baseUrl?: string
  } & JsonObject
  secretRefs?: Record<string, string>
}

export type ModelProfileConfig = {
  id: string
  providerAccountId: string
  capability: 'chat.completion'
  displayName: string
  providerModelId: string
  config?: JsonObject
}

export type OpenAICompatibleGatewayOptions = {
  providerAccount: ProviderAccountConfig
  modelProfile: ModelProfileConfig
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
  cards: Array<CardSourceContent & { id: string; version: number }>
  nextCursor?: string
}

export type UpdateCardInput = {
  cardId: string
  name?: string
  userName?: string
  description?: string
  preset?: CardPresetInput
  opening?: OpeningChatInput | string
  settingLayer?: SettingLayerInput
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

export type CreateProviderAccountInput = {
  providerExtensionId: string
  displayName: string
  config?: JsonObject
  secretRefs?: Record<string, string>
}

export type CreateProviderAccountResult = {
  providerAccount: ProviderAccountContent & { id: string; version: number }
}

export type GetProviderAccountInput = {
  providerAccountId: string
}

export type GetProviderAccountResult = {
  providerAccount: ProviderAccountContent & { id: string; version: number }
}

export type ListProviderAccountsInput = {
  limit?: number
  cursor?: string
}

export type ListProviderAccountsResult = {
  providerAccounts: Array<ProviderAccountContent & { id: string; version: number }>
  nextCursor?: string
}

export type UpdateProviderAccountInput = {
  providerAccountId: string
  displayName?: string
  config?: JsonObject
  secretRefs?: Record<string, string>
}

export type UpdateProviderAccountResult = {
  providerAccount: ProviderAccountContent & { id: string; version: number }
}

export type DeleteProviderAccountInput = {
  providerAccountId: string
}

export type DeleteProviderAccountResult = {
  deleted: true
}

export type CreateModelProfileInput = {
  providerAccountId: string
  capability?: 'chat.completion'
  displayName: string
  providerModelId: string
  config?: JsonObject
}

export type CreateModelProfileResult = {
  modelProfile: ModelProfileContent & { id: string; version: number }
}

export type GetModelProfileInput = {
  modelProfileId: string
}

export type GetModelProfileResult = {
  modelProfile: ModelProfileContent & { id: string; version: number }
}

export type ListModelProfilesInput = {
  providerAccountId?: string
  limit?: number
  cursor?: string
}

export type ListModelProfilesResult = {
  modelProfiles: Array<ModelProfileContent & { id: string; version: number }>
  nextCursor?: string
}

export type UpdateModelProfileInput = {
  modelProfileId: string
  displayName?: string
  providerModelId?: string
  config?: JsonObject
}

export type UpdateModelProfileResult = {
  modelProfile: ModelProfileContent & { id: string; version: number }
}

export type DeleteModelProfileInput = {
  modelProfileId: string
}

export type DeleteModelProfileResult = {
  deleted: true
}

export type PingModelProfileInput = {
  modelProfileId: string
  text?: string
}

export type PingModelProfileResult = {
  text: string
  provider: string
  model: string
  raw?: JsonValue
}

export type AgentHistoryPolicy = 'persistent' | 'ephemeral'

export type CreateAgentPresetInput = {
  name: string
  instructions: string
  promptResourceIds?: string[]
  historyPolicy?: AgentHistoryPolicy
}

export type CreateAgentPresetResult = {
  agentPreset: AgentPresetContent & { id: string; version: number }
}

export type GetAgentPresetInput = { agentPresetId: string }
export type GetAgentPresetResult = { agentPreset: AgentPresetContent & { id: string; version: number } }
export type ListAgentPresetsInput = { limit?: number; cursor?: string }
export type ListAgentPresetsResult = {
  agentPresets: Array<AgentPresetContent & { id: string; version: number }>
  nextCursor?: string
}
export type UpdateAgentPresetInput = {
  agentPresetId: string
  name?: string
  instructions?: string
  promptResourceIds?: string[]
  historyPolicy?: AgentHistoryPolicy
}
export type UpdateAgentPresetResult = CreateAgentPresetResult
export type DeleteAgentPresetInput = { agentPresetId: string }
export type DeleteAgentPresetResult = { deleted: true }

export type CreateAgentLocalBindingInput = {
  name: string
  purpose?: AgentRuntimePurpose
  modelProfileId?: string
}
export type CreateAgentLocalBindingResult = {
  localBinding: AgentLocalBindingContent & { id: string; version: number }
}
export type GetAgentLocalBindingInput = { localBindingId: string }
export type GetAgentLocalBindingResult = CreateAgentLocalBindingResult
export type ListAgentLocalBindingsInput = { limit?: number; cursor?: string }
export type ListAgentLocalBindingsResult = {
  localBindings: Array<AgentLocalBindingContent & { id: string; version: number }>
  nextCursor?: string
}
export type UpdateAgentLocalBindingInput = {
  localBindingId: string
  name?: string
  purpose?: AgentRuntimePurpose
  modelProfileId?: string
}
export type UpdateAgentLocalBindingResult = CreateAgentLocalBindingResult
export type DeleteAgentLocalBindingInput = { localBindingId: string }
export type DeleteAgentLocalBindingResult = { deleted: true }

export type ImportCardBundleInput = {
  artifact: CardBundleArtifact
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

export type ProviderAccountContent = {
  providerExtensionId: string
  displayName: string
  config: JsonObject
  secretRefs: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type ModelProfileContent = {
  providerAccountId: string
  capability: 'chat.completion'
  displayName: string
  providerModelId: string
  config: JsonObject
  createdAt: string
  updatedAt: string
}

export type AgentRuntimePurpose = 'narrative' | 'agent-work' | 'summary' | 'test' | string

export type AgentPresetContent = {
  name: string
  instructions: string
  promptResourceIds: string[]
  historyPolicy: AgentHistoryPolicy
  createdAt: string
  updatedAt: string
}

export type AgentLocalBindingContent = {
  name: string
  purpose: AgentRuntimePurpose
  modelProfileId?: string
  createdAt: string
  updatedAt: string
}

export type CardSourceContent = {
  name: string
  userName?: string
  description?: string
  importBundleId?: string
  promptResourceIds?: string[]
  preset: CardPresetContent
  opening: OpeningChatContent
  settingLayer: SettingLayerContent
  createdAt: string
  updatedAt: string
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
