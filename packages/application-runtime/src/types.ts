import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
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
  createAgentRuntimeProfile(input: CreateAgentRuntimeProfileInput): Promise<CreateAgentRuntimeProfileResult>
  getAgentRuntimeProfile(input: GetAgentRuntimeProfileInput): Promise<GetAgentRuntimeProfileResult>
  listAgentRuntimeProfiles(input?: ListAgentRuntimeProfilesInput): Promise<ListAgentRuntimeProfilesResult>
  updateAgentRuntimeProfile(input: UpdateAgentRuntimeProfileInput): Promise<UpdateAgentRuntimeProfileResult>
  deleteAgentRuntimeProfile(input: DeleteAgentRuntimeProfileInput): Promise<DeleteAgentRuntimeProfileResult>
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  createSessionFromCard(input: CreateSessionFromCardInput): Promise<CreateSessionResult>
  importCardBundle(input: ImportCardBundleInput): Promise<ImportCardBundleResult>
  getImportBundle(input: GetImportBundleInput): Promise<GetImportBundleResult>
  getPromptResource(input: GetPromptResourceInput): Promise<GetPromptResourceResult>
  listCardPromptResources(input: ListCardPromptResourcesInput): Promise<ListCardPromptResourcesResult>
  createPromptResourceAsset(input: CreatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAsset(input: UpdatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAssets(input: UpdatePromptResourceAssetsInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  movePromptResourceAsset(input: MovePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  deletePromptResourceAsset(input: DeletePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  exportCardArtifact(input: ExportCardArtifactInput): Promise<ExportCardBundleResult>
  previewPrompt(input: PreviewPromptInput, context?: RuntimeRequestContext): Promise<PreviewPromptResult>
  submitTurn(input: SubmitTurnInput, context?: RuntimeRequestContext): Promise<SubmitTurnResult>
  getSession(input: GetSessionInput): Promise<GetSessionResult>
  getTimeline(input: GetTimelineInput): Promise<GetTimelineResult>
  getAgentTranscript(input: GetAgentTranscriptInput): Promise<GetAgentTranscriptResult>
  getRun(input: GetRunInput): Promise<GetRunResult>
  forkBranch(input: ForkBranchInput): Promise<ForkBranchResult>
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

export type ApplicationRuntimeOptions = {
  documents: DocumentStore
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

export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type ProviderInvokeInput = {
  messages: ProviderMessage[]
  runId: string
  sessionId: string
  branchId: string
}

export type ProviderInvokeResult = {
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

export type CreateAgentRuntimeProfileInput = {
  name: string
  purpose?: AgentRuntimePurpose
  presetId?: string
  modelProfileId?: string
}

export type CreateAgentRuntimeProfileResult = {
  agentRuntimeProfile: AgentRuntimeProfileContent & { id: string; version: number }
}

export type GetAgentRuntimeProfileInput = {
  agentRuntimeProfileId: string
}

export type GetAgentRuntimeProfileResult = {
  agentRuntimeProfile: AgentRuntimeProfileContent & { id: string; version: number }
}

export type ListAgentRuntimeProfilesInput = {
  limit?: number
  cursor?: string
}

export type ListAgentRuntimeProfilesResult = {
  agentRuntimeProfiles: Array<AgentRuntimeProfileContent & { id: string; version: number }>
  nextCursor?: string
}

export type UpdateAgentRuntimeProfileInput = {
  agentRuntimeProfileId: string
  name?: string
  purpose?: AgentRuntimePurpose
  presetId?: string
  modelProfileId?: string
}

export type UpdateAgentRuntimeProfileResult = {
  agentRuntimeProfile: AgentRuntimeProfileContent & { id: string; version: number }
}

export type DeleteAgentRuntimeProfileInput = {
  agentRuntimeProfileId: string
}

export type DeleteAgentRuntimeProfileResult = {
  deleted: true
}

export type CreateSessionInput = {
  cardSourceVersionId: string
  cardSnapshot?: JsonObject
  agentRuntimeProfileId?: string
  title?: string
}

export type CreateSessionResult = {
  session: SessionContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
}

export type CreateSessionFromCardInput = {
  cardId: string
  agentRuntimeProfileId?: string
  title?: string
}

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

export type PreviewPromptInput = {
  sessionId: string
  branchId?: string
  agentRuntimeProfileId?: string
  input: string
  projectionOrderProfile?: ProjectionOrderProfile
  activationFacts?: ActivationFacts
}

export type PreviewPromptResult = {
  session: SessionContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
  messages: ProviderMessage[]
  promptBuildTrace?: JsonValue
  providerPayloadPreview?: OpenAIChatPayload
  projection: CompiledPrompt
}

export type SubmitTurnInput = {
  sessionId: string
  branchId?: string
  agentRuntimeProfileId?: string
  input: string
  intent?: 'rp' | 'rewrite' | 'continue' | 'modify'
  projectionOrderProfile?: ProjectionOrderProfile
  activationFacts?: ActivationFacts
}

export type SubmitTurnResult = {
  run: RunContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
  entries: {
    user: NarrativeEntryContent & { id: string; version: number }
    assistant: NarrativeEntryContent & { id: string; version: number }
  }
  commitCandidate: CommitCandidateContent & { id: string; version: number }
  stateSnapshot: BranchStateSnapshotContent & { id: string; version: number }
}

export type GetSessionInput = {
  sessionId: string
}

export type GetSessionResult = {
  session: SessionContent & { id: string; version: number }
  branches: Array<NarrativeBranchContent & { id: string; version: number }>
}

export type GetTimelineInput = {
  sessionId: string
  branchId?: string
}

export type GetTimelineResult = {
  session: SessionContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
  entries: Array<NarrativeEntryContent & { id: string; version: number }>
}

export type GetAgentTranscriptInput = {
  sessionId: string
  branchId?: string
}

export type GetAgentTranscriptResult = {
  session: SessionContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
  entries: Array<AgentTranscriptEntryContent & { id: string; version: number }>
}

export type GetRunInput = {
  runId: string
}

export type GetRunResult = {
  run: RunContent & { id: string; version: number }
  runtimeEntries: Array<RuntimeEntryContent & { id: string; version: number }>
  commitCandidates: Array<CommitCandidateContent & { id: string; version: number }>
}

export type ForkBranchInput = {
  sessionId: string
  fromEntryId: string | null
  title?: string
}

export type ForkBranchResult = {
  branch: NarrativeBranchContent & { id: string; version: number }
  session: SessionContent & { id: string; version: number }
}

export type SessionContent = {
  cardSourceVersionId: string
  cardSnapshot: JsonObject
  agentRuntimeProfileId?: string
  promptResourceIds?: string[]
  title?: string
  activeBranchId: string
  createdAt: string
  updatedAt: string
}

export type NarrativeBranchContent = {
  sessionId: string
  title?: string
  parentBranchId?: string
  forkedFromEntryId?: string
  headEntryId?: string
  createdAt: string
  updatedAt: string
}

export type NarrativeEntryContent = {
  sessionId: string
  branchId: string
  parentEntryId?: string
  runId?: string
  role: 'user' | 'assistant'
  content: string
  status: 'accepted'
  intent?: 'rp' | 'rewrite' | 'continue' | 'modify'
  createdAt: string
}

export type RuntimeEntryContent = {
  sessionId: string
  branchId: string
  runId: string
  narrativeEntryId?: string
  kind: 'user_input' | 'prompt' | 'provider_result'
  content: JsonValue
  createdAt: string
}

export type RunContent = {
  sessionId: string
  branchId: string
  agentRuntimeProfileId?: string
  modelProfileId?: string
  status: 'running' | 'completed'
  checkpointEntryId?: string
  input: string
  intent: 'rp' | 'rewrite' | 'continue' | 'modify'
  provider?: string
  model?: string
  acceptedEntryId?: string
  commitCandidateId?: string
  stateSnapshotId?: string
  createdAt: string
  updatedAt: string
}

export type CommitCandidateContent = {
  sessionId: string
  branchId: string
  runId: string
  providerResultEntryId: string
  content: string
  status: 'auto_accepted'
  acceptedEntryId?: string
  createdAt: string
  updatedAt: string
}

export type BranchStateSnapshotContent = {
  sessionId: string
  branchId: string
  runId: string
  fromEntryId?: string
  headEntryId: string
  patch: JsonObject
  createdAt: string
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

export type AgentRuntimeProfileContent = {
  name: string
  purpose: AgentRuntimePurpose
  presetId?: string
  modelProfileId?: string
  createdAt: string
  updatedAt: string
}

export type AgentTranscriptEntryContent = {
  sessionId: string
  branchId: string
  runId?: string
  narrativeEntryId: string
  parentTranscriptEntryId?: string
  role: 'user' | 'assistant'
  content: string
  status: 'mirrored'
  source: 'narrative'
  createdAt: string
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
