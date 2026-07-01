import type { DocumentStore } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ActivationFacts, PromptActivation } from './prompt-activation.js'
import type { OpenAIChatPayload } from './provider-payload.js'
import type { CompiledPrompt, ProjectionOrderProfile } from './prompt-builder.js'
import type { PromptWorkspaceArtifact, PromptWorkspaceContent } from './workspace.js'

export type ApplicationRuntime = {
  createCard(input: CreateCardInput): Promise<CreateCardResult>
  getCard(input: GetCardInput): Promise<GetCardResult>
  listCards(input?: ListCardsInput): Promise<ListCardsResult>
  updateCard(input: UpdateCardInput): Promise<UpdateCardResult>
  deleteCard(input: DeleteCardInput): Promise<DeleteCardResult>
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
  pingModelProfile(input: PingModelProfileInput): Promise<PingModelProfileResult>
  createAgentRuntimeProfile(input: CreateAgentRuntimeProfileInput): Promise<CreateAgentRuntimeProfileResult>
  getAgentRuntimeProfile(input: GetAgentRuntimeProfileInput): Promise<GetAgentRuntimeProfileResult>
  listAgentRuntimeProfiles(input?: ListAgentRuntimeProfilesInput): Promise<ListAgentRuntimeProfilesResult>
  updateAgentRuntimeProfile(input: UpdateAgentRuntimeProfileInput): Promise<UpdateAgentRuntimeProfileResult>
  deleteAgentRuntimeProfile(input: DeleteAgentRuntimeProfileInput): Promise<DeleteAgentRuntimeProfileResult>
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>
  createSessionFromCard(input: CreateSessionFromCardInput): Promise<CreateSessionResult>
  importWorkspaceArtifact(input: ImportWorkspaceArtifactInput): Promise<ImportWorkspaceArtifactResult>
  getPromptWorkspace(input: GetPromptWorkspaceInput): Promise<GetPromptWorkspaceResult>
  listPromptWorkspaces(input?: ListPromptWorkspacesInput): Promise<ListPromptWorkspacesResult>
  createPromptAsset(input: CreatePromptAssetInput): Promise<UpdatePromptAssetResult>
  updatePromptAsset(input: UpdatePromptAssetInput): Promise<UpdatePromptAssetResult>
  movePromptAsset(input: MovePromptAssetInput): Promise<UpdatePromptAssetResult>
  deletePromptAsset(input: DeletePromptAssetInput): Promise<UpdatePromptAssetResult>
  updateProjectionOrderProfile(input: UpdateProjectionOrderProfileInput): Promise<UpdateProjectionOrderProfileResult>
  exportWorkspaceArtifact(input: ExportWorkspaceArtifactInput): Promise<ExportWorkspaceArtifactResult>
  previewPrompt(input: PreviewPromptInput): Promise<PreviewPromptResult>
  submitTurn(input: SubmitTurnInput): Promise<SubmitTurnResult>
  getSession(input: GetSessionInput): Promise<GetSessionResult>
  getTimeline(input: GetTimelineInput): Promise<GetTimelineResult>
  getAgentTranscript(input: GetAgentTranscriptInput): Promise<GetAgentTranscriptResult>
  getRun(input: GetRunInput): Promise<GetRunResult>
  forkBranch(input: ForkBranchInput): Promise<ForkBranchResult>
}

export type ApplicationRuntimeOptions = {
  documents: DocumentStore
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
}

export type DeleteCardInput = {
  cardId: string
}

export type DeleteCardResult = {
  deleted: true
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
  workspaceId?: string
}

export type CreateSessionResult = {
  session: SessionContent & { id: string; version: number }
  branch: NarrativeBranchContent & { id: string; version: number }
}

export type CreateSessionFromCardInput = {
  cardId: string
  agentRuntimeProfileId?: string
  title?: string
  workspaceId?: string
}

export type ImportWorkspaceArtifactInput = {
  artifact: PromptWorkspaceArtifact
  workspaceId?: string
}

export type ImportWorkspaceArtifactResult = {
  workspace: PromptWorkspaceContent & { id: string; version: number }
  card: CardSourceContent & { id: string; version: number }
}

export type GetPromptWorkspaceInput = {
  workspaceId: string
}

export type GetPromptWorkspaceResult = {
  workspace: PromptWorkspaceContent & { id: string; version: number }
}

export type ListPromptWorkspacesInput = {
  cardId?: string
  limit?: number
  cursor?: string
}

export type ListPromptWorkspacesResult = {
  workspaces: Array<PromptWorkspaceContent & { id: string; version: number }>
  nextCursor?: string
}

export type CreatePromptAssetInput = {
  workspaceId: string
  targetAssetId: string
  position: 'before' | 'inside' | 'after'
  asset: PromptWorkspaceContent['contextAssets'][number]
}

export type UpdatePromptAssetInput = {
  workspaceId: string
  assetId: string
  body?: string
  capabilities?: PromptWorkspaceContent['contextAssets'][number]['capabilities']
  label?: string
  meta?: string
  enabled?: boolean
}

export type UpdatePromptAssetResult = {
  workspace: PromptWorkspaceContent & { id: string; version: number }
}

export type MovePromptAssetInput = {
  workspaceId: string
  assetId: string
  targetAssetId: string
  position: 'before' | 'inside' | 'after'
}

export type DeletePromptAssetInput = {
  workspaceId: string
  assetId: string
}

export type UpdateProjectionOrderProfileInput = {
  workspaceId: string
  orderNodeId: string
  orderList?: string[]
  projectionOrderProfile: ProjectionOrderProfile
}

export type UpdateProjectionOrderProfileResult = {
  workspace: PromptWorkspaceContent & { id: string; version: number }
}

export type ExportWorkspaceArtifactInput = {
  workspaceId: string
}

export type ExportWorkspaceArtifactResult = {
  artifact: PromptWorkspaceArtifact
}

export type PreviewPromptInput = {
  sessionId: string
  branchId?: string
  agentRuntimeProfileId?: string
  input: string
  workspaceId?: string
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
  workspaceId?: string
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
  workspaceId?: string
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
