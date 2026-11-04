import type { ChatAttachment } from '@loom-studio/shared'
import type { AddUserBackgroundInput, RemoveUserBackgroundInput, UserBackgroundsConfig } from './profiles/user-backgrounds.js'
import type { ObservationStore, ObservationOrigin } from './observability/types.js'
import type { AgentApprovalPolicy } from './agents/approval-policy.js'
import type { CreateUserProfileInput, DeleteUserProfileInput, SelectUserProfileInput, UpdateUserProfileInput, UserProfilesConfig } from './profiles/user-profiles.js'
import type { LoomScriptContributionDefinition, LoomScriptMountTarget, CreateLoomScriptMountInput, UpdateLoomScriptMountInput, ListLoomScriptMountsInput, MutateLoomScriptMountResult, ListLoomScriptMountsResult } from '@loom-studio/shared/loom-scripts'
import type { ListPresetToolMountsInput, ListPresetToolMountsResult, ReplacePresetToolMountsInput, ReplacePresetToolMountsResult } from '@loom-studio/shared/tool-mounts'
export type { ListPresetToolMountsInput, ListPresetToolMountsResult, PresetToolMountInput, ReplacePresetToolMountsInput, ReplacePresetToolMountsResult } from '@loom-studio/shared/tool-mounts'
import type { TokenUsage } from '@loom-studio/tokenizer/contracts'
import type { RequestTokenEstimate } from '@loom-studio/ai-gateway'
import type {
  AgentTranscriptEntry,
  AgentTranscriptPage,
  AgentSession,
  AgentStore,
  AgentSessionRunSummary,
} from '@loom-studio/application-data'
export type {
  AgentTranscriptEntry,
  AgentTranscriptPage,
  AgentSession,
} from '@loom-studio/application-data'
import type { DocumentStore } from '@loom-studio/document-store'
import type { AiGatewayCapabilityRegistry, ProviderAdapterRegistry } from '@loom-studio/ai-gateway'
import type { DataActorRef, SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import type {
  ExtensionAgentToolContribution,
  ExtensionPromptAddition,
  ExtensionConfigEntry,
  ExtensionEntityRef,
  ExtensionPromptResourceContribution,
  ExtensionRecordEntry,
  ExtensionStorageScope,
  ExtensionTextExtractorContribution,
  ExtensionTextTransformRuleContribution,
} from '@loom-studio/extension-sdk'
export type { ExtensionConfigEntry, ExtensionEntityRef, ExtensionRecordEntry, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import type { Logger } from '@loom-studio/logging'
import type { VfsMutationDecision, VfsMutationPreview } from './vfs/types.js'
import type { NarrativeSwipeView } from './narrative/swipe-types.js'
export type { NarrativeSwipeView } from './narrative/swipe-types.js'
import type {
  NarrativeBranch,
  NarrativeNode,
  NarrativePage,
  NarrativeStore,
  NarrativeTimeline,
} from '@loom-studio/application-data'
export type {
  NarrativeBranch,
  NarrativeNode,
  NarrativePage,
  NarrativeTimeline,
} from '@loom-studio/application-data'
import type {
  AssistantChatMessage,
  ChatMessage,
  SearchResourcesInput,
  SearchResourcesResult,
  ListGlobalSearchScopesInput,
  ListGlobalSearchScopesResult,
  JsonObject,
  JsonValue,
  ListLoreMountsInput,
  ListLoreMountsResult,
  MacroInspection,
  MacroSelectionMap,
  ReplaceLoreMountsInput,
  ReplaceLoreMountsResult,
  StateComponentTemplate,
  StateEntityId,
  StateEntityRefAnnotation,
  StateEntityType,
  TimelineComponentMount,
  TimelineStateBinding,
} from '@loom-studio/shared'
export type {
  GlobalSearchHit,
  GlobalSearchKind,
  GlobalSearchScope,
  SearchResourcesInput,
  SearchResourcesResult,
  SearchScopeOption,
  ListGlobalSearchScopesInput,
  ListGlobalSearchScopesResult,
  ListLoreMountsInput,
  ListLoreMountsResult,
  ReplaceLoreMountsInput,
  ReplaceLoreMountsResult,
  LoreMount,
  LoreMountSource,
} from '@loom-studio/shared'
import type { SecretRef, SecretStore } from '@loom-studio/secret-store'
import type { StateStore } from '@loom-studio/application-data'
import type { PromptResourceStore } from '@loom-studio/application-data'
export type { PresetToolMount } from '@loom-studio/application-data'
import type { ActivationFacts, PromptActivation } from './prompt/prompt-activation.js'
import type { AgentToolRegistry, ToolDefinition } from './agents/tool-registry.js'
import type {
  CompiledToolExposure,
  ToolPromptBuildTrace,
} from './agents/tool-prompt-build.js'
import type { OpenAIChatPayload } from './providers/provider-payload.js'
import type { PromptBuildTrace } from './prompt/prompt-build-pipeline.js'
import type {
  HistoryProjectionSnapshot,
  HistorySource,
  InspectTextPipelineInput,
  RendererDefinition,
  TextExtractionResult,
  TextExtractorDraft,
  TextExtractorEntry,
  TextExtractorSummary,
  TextTransformPhase,
  TextTransformRuleDraft,
  TextTransformRuleEntry,
  TextTransformRuleSummary,
  TextPipelineInspection,
  TextPipelineOverrideEntry,
} from './transforms/history-text.js'
export type {
  HistoryProjectionSnapshot,
  HistorySource,
  HistoryTextEntry,
  InspectTextPipelineInput,
  RendererDefinition,
  TextExtractionResult,
  TextExtractionArtifact,
  TextExtractionArtifactValue,
  TextExtractorContent,
  TextExtractorDraft,
  TextExtractorEntry,
  TextExtractorSummary,
  TextTransformPhase,
  TextTransformRuleContent,
  TextTransformRuleDraft,
  TextTransformRuleEntry,
  TextTransformRuleSummary,
  TextPipelineInspection,
  TextPipelineConsumer,
  TextPipelineOverrideContent,
  TextPipelineOverrideEntry,
  TextPipelineOverrideSource,
} from './transforms/history-text.js'
import type { CompiledPrompt } from './prompt/prompt-builder.js'
import type { SampleNarrativeInput } from './narrative/sampling-contracts.js'
import type { NarrativeSampleResult } from './narrative/sampling.js'
import type { NarrativeContextRegistry } from './narrative/context-provider.js'
export type { SampleNarrativeInput } from './narrative/sampling-contracts.js'
import type { MacroProviderRegistry } from './prompt/macro-provider-registry.js'
import type { PromptProcessorRegistry } from './prompt/prompt-processor-registry.js'
import type { StateContentRegistry } from './state/state-content-registry.js'
import type { StateContributionRegistry } from './state/state-contribution-registry.js'
import type { TimelineArchive, TimelineArchiveParticipant } from './archive/timeline-archive.js'
import type {
  LoomScriptArtifact,
  LoomScriptEntry,
  LoomScriptOwner,
  ResolvedLoomScriptRendererMount,
  UnavailableLoomScriptMount,
} from './scripts/loom-script-contracts.js'
import type { CardBundleArtifact, ImportBundleContent } from './cards/card-bundle-types.js'
import type { PortableExtensionPayloadArtifact } from './extensions/portable-payload-types.js'
import type { PromptResourceArtifact, PromptResourceCompositionCapabilities, PromptResourceContent, PromptResourceKind, PromptResourceNode } from './prompt/prompt-resource-types.js'
export type { CardBundleArtifact, ImportBundleContent } from './cards/card-bundle-types.js'
export type { PortableExtensionPayloadArtifact } from './extensions/portable-payload-types.js'
export type { PromptResourceArtifact, PromptResourceCompositionCapabilities, PromptResourceContent, PromptResourceKind, PromptResourceNode } from './prompt/prompt-resource-types.js'
export type { MacroProviderRegistry } from './prompt/macro-provider-registry.js'
export type { StateContributionRegistry } from './state/state-contribution-registry.js'
export type {
  StateArtifact,
  StateContribution,
  StateEntityId,
  StateEntityRefAnnotation,
  StateEntityType,
  TimelineComponentMount,
  TimelineStateBinding,
} from '@loom-studio/shared'

export type ApplicationRuntime = ReturnType<typeof import('./runtime/resource-authoring-runtime.js').createResourceAuthoringRuntimeMethods> & ReturnType<typeof import('./runtime/observability-runtime.js').createObservabilityRuntimeMethods> & ReturnType<typeof import('./runtime/workspace-runtime.js').createWorkspaceRuntimeMethods> & {
  validateCardFramework(input: { card: CardFrameworkFields }): Promise<{ presetId?: string }>
  checkExtensionDependencyConsumers(input: { packageId: string; target?: ExtensionInstallationTarget; nextVersion?: string }): Promise<void>
  getUserBackgrounds(): Promise<{ config: UserBackgroundsConfig }>
  addUserBackground(input: AddUserBackgroundInput, context?: RuntimeRequestContext): Promise<{ config: UserBackgroundsConfig; mutation: MutationReceipt }>
  removeUserBackground(input: RemoveUserBackgroundInput, context?: RuntimeRequestContext): Promise<{ config: UserBackgroundsConfig; mutation: MutationReceipt }>
  getUserProfiles(): Promise<{ config: UserProfilesConfig }>
  createUserProfile(input: CreateUserProfileInput, context?: RuntimeRequestContext): Promise<{ config: UserProfilesConfig; mutation: MutationReceipt }>
  updateUserProfile(input: UpdateUserProfileInput, context?: RuntimeRequestContext): Promise<{ config: UserProfilesConfig; mutation: MutationReceipt }>
  selectUserProfile(input: SelectUserProfileInput, context?: RuntimeRequestContext): Promise<{ config: UserProfilesConfig; mutation: MutationReceipt }>
  deleteUserProfile(input: DeleteUserProfileInput, context?: RuntimeRequestContext): Promise<{ config: UserProfilesConfig; mutation: MutationReceipt }>
  subscribeNarrativeActivity: ReturnType<typeof import('./extensions/narrative-activity.js').createNarrativeActivityRegistry>['subscribe']
  registerReadonlyFiles: ReturnType<typeof import('./extensions/readonly-files.js').createExtensionReadonlyFilesRegistry>['register']
  registerTimelineArchiveParticipant: import('./archive/timeline-archive.js').TimelineArchiveParticipantRegistry['register']
  searchResources(input: SearchResourcesInput): Promise<SearchResourcesResult>
  listGlobalSearchScopes(input: ListGlobalSearchScopesInput): Promise<ListGlobalSearchScopesResult>
  getTimelinePresetConfig(input: { timelineId: string; presetId: string }): Promise<{ config: import('./prompt/timeline-preset-config.js').TimelinePresetConfig }>
  updateTimelinePresetConfig(input: { timelineId: string; presetId: string; expectedVersion: number; macroSelections: MacroSelectionMap }, context?: RuntimeRequestContext): Promise<{ config: import('./prompt/timeline-preset-config.js').TimelinePresetConfig; mutation: MutationReceipt }>
  sampleNarrative(input: SampleNarrativeInput, signal?: AbortSignal): Promise<NarrativeSampleResult>
  getEffectiveNarrativePreview(input: { timelineId: string; branchId: string }): Promise<{
    timelineId: string
    branchId: string
    sourceId: string
    version?: string
    coveredThroughNodeId: string | null
    rawThroughNodeId: string | null
    memory: Array<{ id: string; content: string }>
    nodes: Array<{ id: string; text: string }>
    complete: boolean
  }>
  captureCardDirectoryState(input: { cardId: string }): Promise<{ artifact: CardBundleArtifact; snapshot: JsonObject }>
  applyCardDirectoryState(input: { cardId: string; artifact: CardBundleArtifact; snapshot: JsonObject }, context?: RuntimeRequestContext): Promise<{ mutation: { changesetId: string } }>
  initialize(): Promise<void>
  installOfficialContent(input: InstallOfficialContentInput, context?: RuntimeRequestContext): Promise<InstallOfficialContentResult>
  getStateSnapshot(input: GetStateSnapshotInput): Promise<GetStateSnapshotResult>
  inspectStateSources(input: InspectStateSourcesInput): Promise<StateSourcesInspection>
  applyStateMutation(input: ApplyStateMutationInput, context?: RuntimeRequestContext): Promise<ApplyStateMutationResult>
  listStateDefinitions(input?: ListStateDefinitionsInput): Promise<ListStateDefinitionsResult>
  getStateDefinition(input: GetStateDefinitionInput): Promise<GetStateDefinitionResult>
  upsertStateDefinition(input: UpsertStateDefinitionInput, context?: RuntimeRequestContext): Promise<UpsertStateDefinitionResult>
  deleteStateDefinition(input: DeleteStateDefinitionInput, context?: RuntimeRequestContext): Promise<DeleteStateDefinitionResult>
  listTextTransformRuleSummaries(input?: { owner?: TextTransformRuleDraft['owner'] }): Promise<{ rules: TextTransformRuleSummary[] }>
  listTextTransformRules(input?: { owner?: TextTransformRuleDraft['owner'] }): Promise<{ rules: TextTransformRuleEntry[] }>
  getTextTransformRule(input: { ruleId: string }): Promise<{ rule: TextTransformRuleEntry }>
  upsertTextTransformRule(input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft }, context?: RuntimeRequestContext): Promise<{ rule: TextTransformRuleEntry; mutation: MutationReceipt }>
  deleteTextTransformRule(input: { ruleId: string; expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  listTextExtractorSummaries(): Promise<{ extractors: TextExtractorSummary[] }>
  listTextExtractors(): Promise<{ extractors: TextExtractorEntry[] }>
  getTextExtractor(input: { extractorId: string }): Promise<{ extractor: TextExtractorEntry }>
  upsertTextExtractor(input: { extractorId: string; expectedVersion?: number; extractor: TextExtractorDraft }, context?: RuntimeRequestContext): Promise<{ extractor: TextExtractorEntry; mutation: MutationReceipt }>
  deleteTextExtractor(input: { extractorId: string; expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  getTextPipelineOverride(input: InspectTextPipelineInput): Promise<{ override: TextPipelineOverrideEntry | null }>
  upsertTextPipelineOverride(input: InspectTextPipelineInput & { expectedVersion?: number; disabledRuleIds: string[]; orderedRuleIds: string[] }, context?: RuntimeRequestContext): Promise<{ override: TextPipelineOverrideEntry; mutation: MutationReceipt }>
  deleteTextPipelineOverride(input: InspectTextPipelineInput & { expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  projectHistory(input: { source: HistorySource; phase: TextTransformPhase; entryIds?: string[]; streamingEntries?: Array<{ id: string; text: string; role?: 'user' | 'assistant' }>; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }): Promise<{ snapshot: HistoryProjectionSnapshot }>
  previewCardOpeningDisplay(input: { cardId: string; presetId?: string; text: string }): Promise<{ text: string; originalText: string; diagnostics: Array<{ code: string; message: string }> }>
  extractHistory(input: { source: HistorySource; phase?: TextTransformPhase; extractorId: string; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }): Promise<{ extraction: TextExtractionResult; snapshot: HistoryProjectionSnapshot }>
  inspectTextPipeline(input: InspectTextPipelineInput): Promise<TextPipelineInspection>
  listRenderers(): Promise<{ renderers: RendererDefinition[] }>
  setLoomScriptExecutionStates(states: Array<{ mountId: string; revision: number; active: boolean }>): void
  previewLoomScript(input: { source: string; text: string; previewSource?: 'narrative' | 'agent-session'; streaming?: boolean; phase?: TextTransformPhase; settings?: import('@loom-studio/shared/loom-scripts').LoomScriptSettings }): Promise<{ output: string; matches: Array<{ ruleId: string; match: string }>; diagnostics: Array<{ message: string }>; extractions: Array<{ extractorId: string; values: JsonValue[]; diagnostics: Array<{ message: string }> }> }>
  deleteLoomScriptMount(input: { mountId: string; expectedVersion: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  listLoomScriptConfigs(input: import('./scripts/script-config.js').ScriptConfigQuery): Promise<import('@loom-studio/extension-sdk').ScriptConfigEntry[]>
  upsertLoomScriptConfig(input: import('./scripts/script-config.js').ScriptConfigWrite, context?: RuntimeRequestContext): Promise<import('@loom-studio/extension-sdk').ScriptConfigEntry>
  getLoomScriptSettings(input: { mountId: string }): Promise<{ ruleDefaults: Array<{ id: string; rule: import('@loom-studio/shared/loom-scripts').ScriptTextTransformRule }>; definitions: import('@loom-studio/shared/loom-scripts').LoomScriptSettingDefinition[]; inherited?: import('@loom-studio/shared/loom-scripts').LoomScriptSettings; effective?: import('@loom-studio/shared/loom-scripts').LoomScriptSettings; saved: import('@loom-studio/shared/loom-scripts').LoomScriptSettings; adopted: import('@loom-studio/shared/loom-scripts').LoomScriptSettings; documentVersion: number; adoptedDocumentVersion?: number; validationError?: string }>
  importLoomScript(input: { owner: LoomScriptOwner; fileName: string; source: string; mount?: { target: LoomScriptMountTarget; orderIndex?: number } }, context?: RuntimeRequestContext): Promise<{ script: LoomScriptEntry; mutation: MutationReceipt }>
  updateLoomScript(input: { scriptDocumentId: string; expectedVersion: number; fileName: string; source: string }, context?: RuntimeRequestContext): Promise<{ script: LoomScriptEntry; mutation: MutationReceipt }>
  deleteLoomScript(input: { scriptDocumentId: string; expectedVersion: number }, context?: RuntimeRequestContext): Promise<{ deleted: true; mutation: MutationReceipt }>
  reorderLoomScripts(input: { groups: Array<{ owner: LoomScriptOwner; scriptIds: string[]; groupOrder?: number }>; target?: LoomScriptMountTarget }, context?: RuntimeRequestContext): Promise<{ reordered: true; mutation: MutationReceipt }>
  getLoomScriptSummary(input: { scriptDocumentId: string }): Promise<{ script: { id: string; contributionKinds: LoomScriptContributionDefinition['kind'][] } | null }>
  getLoomScript(input: { scriptDocumentId: string }): Promise<{ script: LoomScriptEntry }>
  listLoomScripts(input?: { owner?: LoomScriptOwner }): Promise<{ scripts: LoomScriptEntry[] }>
  exportLoomScript(input: { scriptDocumentId: string }): Promise<{ artifact: LoomScriptArtifact }>
  createLoomScriptMount(input: CreateLoomScriptMountInput, context?: RuntimeRequestContext): Promise<MutateLoomScriptMountResult>
  updateLoomScriptMount(input: UpdateLoomScriptMountInput, context?: RuntimeRequestContext): Promise<MutateLoomScriptMountResult>
  refreshLoomScriptMount(input: { mountId: string; expectedVersion: number }, context?: RuntimeRequestContext): Promise<MutateLoomScriptMountResult>
  listLoomScriptMounts(input?: ListLoomScriptMountsInput): Promise<ListLoomScriptMountsResult>
  resolveLoomScriptRendererMounts(input?: { workspaceId?: string; timelineId?: string; presetId?: string; cardId?: string }): Promise<{ mounts: ResolvedLoomScriptRendererMount[]; unavailableMounts: UnavailableLoomScriptMount[] }>
  listExtensionRecords(input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<{ records: ExtensionRecordEntry[] }>
  getExtensionRecord(input: { packageId: string; target?: ExtensionInstallationTarget; recordId: string }): Promise<{ record: ExtensionRecordEntry | null }>
  listExtensionConfigs(input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope }): Promise<{ configs: ExtensionConfigEntry[] }>
  getExtensionConfig(input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string }): Promise<{ config: ExtensionConfigEntry | null }>
  upsertExtensionConfig(input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string; value: JsonValue; expectedVersion?: number }, context?: RuntimeRequestContext): Promise<{ config: ExtensionConfigEntry; mutation: MutationReceipt }>
  createCard(input: CreateCardInput, context?: RuntimeRequestContext): Promise<CreateCardResult>
  forkCard(input: { cardId: string; expectedVersion: number }, context?: RuntimeRequestContext): Promise<ImportCardBundleResult>
  getCard(input: GetCardInput): Promise<GetCardResult>
  listCards(input?: ListCardsInput): Promise<ListCardsResult>
  updateCard(input: UpdateCardInput, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  attachCardExtensionPackage(input: AttachCardExtensionPackageInput, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  getCardExtensionPackage(input: { cardId: string; packageId: string; source?: 'installed' }): Promise<{ archive: AttachCardExtensionPackageInput['archive']; cardVersion: number }>
  detachCardExtensionPackage(input: { cardId: string; expectedVersion: number; packageId: string }, context?: RuntimeRequestContext): Promise<UpdateCardResult>
  previewCardDeletion(input: PreviewCardDeletionInput): Promise<PreviewCardDeletionResult>
  deleteCard(input: DeleteCardInput, context?: RuntimeRequestContext): Promise<DeleteCardResult>
  deleteCards(input: DeleteCardsInput, context?: RuntimeRequestContext): Promise<DeleteCardsResult>
  listExtensionInstallations(): Promise<ListExtensionInstallationsResult>
  inspectTimelineExtensionResources(input: { timelineId: string; installationId: string }): Promise<TimelineExtensionResourceInspection>
  beginTimelineExtensionWork(
    input: { timelineId: string; installationId: string; packageVersion?: string; signal?: AbortSignal },
  ): Promise<{ lease: TimelineExtensionLease; signal: AbortSignal; dispose(): void; run<T>(work: () => T): T }>
  runTimelineExtensionWork<T>(
    input: { timelineId: string; branchId?: string; installationId: string; packageVersion?: string; signal?: AbortSignal },
    work: (execution: { lease: TimelineExtensionLease; signal: AbortSignal;
      narrativeSource: NonNullable<import('@loom-studio/extension-sdk').ExtensionTimelineExecution['narrativeSource']>;
      assertNarrativeSource(): Promise<void>; withNarrativeWrite<TValue>(work: () => TValue): TValue }) => Promise<T>,
  ): Promise<T>
  assertTimelineExtensionWork(lease: TimelineExtensionLease): Promise<void>
  isTimelineExtensionActive(input: { timelineId: string; installationId: string }): Promise<boolean>
  listTimelineExtensionTargets(input: { installationId: string }): Promise<import('@loom-studio/extension-sdk').ExtensionTimelineTarget[]>
  subscribeTimelineExtensionTargets(input: { installationId: string }, listener: () => void): { dispose(): void }
  getTimelineExtensionParticipation(input: { timelineId: string }): Promise<TimelineExtensionParticipation>
  previewTimelineExtensionRecovery(input: { timelineId: string; installationId: string }): Promise<TimelineExtensionRecoveryPreview>
  previewTimelineExtensionAdoption(input: PreviewTimelineExtensionAdoptionInput): Promise<TimelineExtensionAdoptionPreview>
  previewTimelineExtensionStateInitialization(input: PreviewTimelineExtensionAdoptionInput): Promise<TimelineExtensionAdoptionPreview>
  initializeTimelineExtensionState(input: AdoptTimelineExtensionInput, context?: RuntimeRequestContext): Promise<{
    revisionId: string
    mutation: MutationReceipt
  }>
  adoptTimelineExtension(input: AdoptTimelineExtensionInput, context?: RuntimeRequestContext): Promise<{
    participation: TimelineExtensionParticipation
    revisionId: string
    mutation: MutationReceipt
  }>
  recoverTimelineExtension(input: RecoverTimelineExtensionInput, context?: RuntimeRequestContext): Promise<{
    participation: TimelineExtensionParticipation
    mutation: MutationReceipt
  }>
  updateTimelineExtensionParticipation(input: UpdateTimelineExtensionParticipationInput, context?: RuntimeRequestContext): Promise<{
    participation: TimelineExtensionParticipation
    mutation: MutationReceipt
  }>
  listPortableExtensionPayloads(input?: ListPortableExtensionPayloadsInput): Promise<ListPortableExtensionPayloadsResult>
  getPortableExtensionPayload(input: GetPortableExtensionPayloadInput): Promise<GetPortableExtensionPayloadResult>
  createPortableExtensionPayload(input: CreatePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<CreatePortableExtensionPayloadResult>
  updatePortableExtensionPayload(input: UpdatePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<UpdatePortableExtensionPayloadResult>
  deletePortableExtensionPayload(input: DeletePortableExtensionPayloadInput, context?: RuntimeRequestContext): Promise<DeletePortableExtensionPayloadResult>
  replaceCardPortableExtensionPayloads(input: ReplaceCardPortableExtensionPayloadsInput, context?: RuntimeRequestContext): Promise<ReplaceCardPortableExtensionPayloadsResult>
  createProviderProfile(input: CreateProviderProfileInput, context?: RuntimeRequestContext): Promise<CreateProviderProfileResult>
  getProviderProfile(input: GetProviderProfileInput): Promise<GetProviderProfileResult>
  listProviderProfiles(input?: ListProviderProfilesInput): Promise<ListProviderProfilesResult>
  updateProviderProfile(input: UpdateProviderProfileInput, context?: RuntimeRequestContext): Promise<UpdateProviderProfileResult>
  replaceProviderCredential(input: ReplaceProviderCredentialInput, context?: RuntimeRequestContext): Promise<ReplaceProviderCredentialResult>
  deleteProviderProfile(input: DeleteProviderProfileInput, context?: RuntimeRequestContext): Promise<DeleteProviderProfileResult>
  createAiCapabilityProfile(input: CreateAiCapabilityProfileInput, context?: RuntimeRequestContext): Promise<CreateAiCapabilityProfileResult>
  getAiCapabilityProfile(input: GetAiCapabilityProfileInput): Promise<GetAiCapabilityProfileResult>
  listAiCapabilityProfiles(input?: ListAiCapabilityProfilesInput): Promise<ListAiCapabilityProfilesResult>
  updateAiCapabilityProfile(input: UpdateAiCapabilityProfileInput, context?: RuntimeRequestContext): Promise<UpdateAiCapabilityProfileResult>
  deleteAiCapabilityProfile(input: DeleteAiCapabilityProfileInput, context?: RuntimeRequestContext): Promise<DeleteAiCapabilityProfileResult>
  listProviderModels(input: ListProviderModelsInput, context?: RuntimeRequestContext): Promise<ListProviderModelsResult>
  pingProviderModel(input: PingProviderModelInput, context?: RuntimeRequestContext): Promise<PingProviderModelResult>
  getAgentToolSummary(input: { toolId: string }): Promise<{ tool: { id: string } | null }>
  listAgentTools(): Promise<{ tools: AgentToolEntry[] }>
  importExtensionPackageResources(input: ImportExtensionPackageResourcesInput, context?: RuntimeRequestContext): Promise<ImportExtensionPackageResourcesResult>
  previewExtensionPackageResources(input: PreviewExtensionPackageResourcesInput): Promise<PreviewExtensionPackageResourcesResult>
  uninstallExtensionInstallation(input: UninstallExtensionInstallationInput, context?: RuntimeRequestContext): Promise<UninstallExtensionInstallationResult>
  removeExtensionPackageResources(input: RemoveExtensionPackageResourcesInput, context?: RuntimeRequestContext): Promise<RemoveExtensionPackageResourcesResult>
  updateAgentTool(input: UpdateAgentToolInput, context?: RuntimeRequestContext): Promise<UpdateAgentToolResult>
  listPresetToolMounts(input?: ListPresetToolMountsInput): Promise<ListPresetToolMountsResult>
  replacePresetToolMounts(input: ReplacePresetToolMountsInput, context?: RuntimeRequestContext): Promise<ReplacePresetToolMountsResult>
  createAgentPreset(input: CreateAgentPresetInput, context?: RuntimeRequestContext): Promise<AgentPresetResult>
  getAgentPreset(input: { agentPresetId: string }): Promise<{ agentPreset: AgentPresetEntry }>
  listAgentPresets(input?: { limit?: number; cursor?: string }): Promise<{ agentPresets: AgentPresetEntry[]; nextCursor?: string }>
  updateAgentPreset(input: UpdateAgentPresetInput, context?: RuntimeRequestContext): Promise<AgentPresetResult>
  deleteAgentPreset(input: { agentPresetId: string }, context?: RuntimeRequestContext): Promise<DeletePromptResourceResult>
  createAgentSession(input: CreateAgentSessionInput, context?: RuntimeRequestContext): Promise<CreateAgentSessionResult>
  listAgentSessions(input?: ListAgentSessionsInput): Promise<ListAgentSessionsResult>
  listAgentRunStates(): Promise<AgentSessionRunSummary[]>
  getAgentSession(input: GetAgentSessionInput): Promise<GetAgentSessionResult>
  getAgentTranscriptPage(input: GetAgentTranscriptPageInput): Promise<AgentTranscriptPage>
  appendAgentTranscriptEntries(input: AppendAgentTranscriptEntriesInput, context?: RuntimeRequestContext): Promise<AppendAgentTranscriptEntriesResult>
  summarizeAgentSession(input: { agentSessionId: string; branchId?: string }, context?: RuntimeRequestContext): Promise<import('./agents/session-summary.js').SessionSummaryStatus>
  cancelAgentSessionSummary(input: { agentSessionId: string }): Promise<import('./agents/session-summary.js').SessionSummaryStatus>
  updateAgentSessionSummary(input: { agentSessionId: string; branchId?: string; expectedSummaryId: string; expectedEntryCount: number; content: string }, context?: RuntimeRequestContext): Promise<void>
  getAgentSessionMemory(input: { agentSessionId: string; branchId?: string }): Promise<{
    session: AgentSession; policy: NonNullable<AgentSession['summaryPolicy']>;
    status: import('./agents/session-summary.js').SessionSummaryStatus; summary: AgentTranscriptEntry | null;
    coverage: { retiredThroughSequence: number; sourceThroughSequence: number; messages: { retired: number; source: number; total: number } };
  }>
  listAgentSessionSummaryTasks(input: { agentSessionId: string }): ReturnType<import('@loom-studio/application-data').AgentStore['listSummaryTasks']>
  getAgentSessionSummaryStatus(input: { agentSessionId: string }): import('./agents/session-summary.js').SessionSummaryStatus
  completeAgentSessionHandoff(input: CompleteAgentSessionHandoffInput, context?: RuntimeRequestContext): Promise<CompleteAgentSessionHandoffResult>
  deleteAgentSession(input: DeleteAgentSessionInput, context?: RuntimeRequestContext): Promise<DeleteAgentSessionResult>
  updateAgentSession(input: UpdateAgentSessionInput, context?: RuntimeRequestContext): Promise<UpdateAgentSessionResult>
  reviseAgentInput(input: { agentSessionId: string; entryId: string; expectedContent: string; expectedAttachments?: ChatAttachment[]; content: string; attachments?: ChatAttachment[] }, context?: RuntimeRequestContext): Promise<{ entry: AgentTranscriptEntry; rerun: boolean }>
  submitAgentInterjection(input: SubmitAgentInterjectionInput, context?: RuntimeRequestContext): Promise<{ entry: AgentTranscriptEntry; pending: boolean }>
  invokeAgentTurn(input: InvokeAgentTurnInput, context?: RuntimeRequestContext): Promise<InvokeAgentTurnResult>
  findAgentRunCheckpoint(input: { agentSessionId: string; runId: string }): Promise<AgentTranscriptEntry | null>
  inspectAgentRunState(input: { agentSessionId: string; runId: string }): Promise<{ runId: string; state: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled'; entryCount: number; reason?: string }>
  prepareAgentRunRecovery(input: { agentSessionId: string; runId?: string }): Promise<import('./agents/run-recovery.js').AgentRunRecovery | undefined>
  previewAgentTurn(input: PreviewAgentTurnInput, context?: RuntimeRequestContext): Promise<PreviewAgentTurnResult>
  buildExtensionPrompt(input: import('@loom-studio/extension-sdk').ExtensionPromptBuildInput, target: import('@loom-studio/extension-sdk').ExtensionInstallationTarget, packageId: string, lease?: TimelineExtensionLease, context?: RuntimeRequestContext): Promise<import('@loom-studio/extension-sdk').ExtensionPromptBuildResult>
  inspectMacros(input: InspectMacrosInput): Promise<InspectMacrosResult>
  createNarrativeTimeline(input: CreateNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult>
  importNarrativeHistory(input: ImportNarrativeHistoryInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult>
  replaceNarrativeOpening(input: ReplaceNarrativeOpeningInput, context?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult>
  getNarrativeTimeline(input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult>
  exportTimelineArchive(input: { timelineId: string }): Promise<{ archive: TimelineArchive }>
  importTimelineArchive(input: { source: string }): Promise<{ timelineId: string; idMap: import('./archive/timeline-archive.js').TimelineArchiveIdMap; unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }>; mutation: MutationReceipt }>
  listNarrativeTimelines(input?: ListNarrativeTimelinesInput): Promise<ListNarrativeTimelinesResult>
  getNarrativePage(input: GetNarrativePageInput): Promise<NarrativePage>
  getNarrativeSwipes(input: { timelineId: string; branchId: string }): Promise<{ swipe?: NarrativeSwipeView }>
  selectNarrativeSwipe(input: { timelineId: string; branchId: string; groupId: string; candidateId: string; expectedRevision: number; expectedHeadNodeId: string | null }, context?: RuntimeRequestContext): Promise<{ page: NarrativePage; swipe: NarrativeSwipeView }>
  appendNarrativeInput(input: AppendNarrativeInput, context?: RuntimeRequestContext): Promise<AppendNarrativeInputResult>
  editNarrativeNode(input: { timelineId: string; branchId: string; nodeId: string; expectedHeadNodeId: string; expectedRaw: string; raw: string }, context?: RuntimeRequestContext): Promise<{ timeline: NarrativeTimeline; branch: NarrativeBranch; replacements: Array<{ previousNodeId: string; node: NarrativeNode }>; mutation: MutationReceipt }>
  forkNarrativeBranch(input: ForkNarrativeBranchInput, context?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult>
  switchNarrativeBranch(input: SwitchNarrativeBranchInput, context?: RuntimeRequestContext): Promise<SwitchNarrativeBranchResult>
  deleteNarrativeTimeline(input: DeleteNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult>
  updateNarrativeTimeline(input: UpdateNarrativeTimelineInput, context?: RuntimeRequestContext): Promise<UpdateNarrativeTimelineResult>
  importCardBundle(input: ImportCardBundleInput, context?: RuntimeRequestContext): Promise<ImportCardBundleResult>
  getPromptResource(input: GetPromptResourceInput): Promise<GetPromptResourceResult>
  listPromptResources(input?: ListPromptResourcesInput): Promise<ListPromptResourcesResult>
  getPromptResourceBindings(input: GetPromptResourceInput): Promise<GetPromptResourceBindingsResult>
  createPromptResource(input: CreatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  duplicatePromptResource(input: DuplicatePromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  deletePromptResource(input: DeletePromptResourceInput, context?: RuntimeRequestContext): Promise<DeletePromptResourceResult>
  revertPromptResourceChangeset(input: RevertPromptResourceChangesetInput, context?: RuntimeRequestContext): Promise<RevertPromptResourceChangesetResult>
  revertChangeset(input: { changesetId: string }, context?: RuntimeRequestContext): Promise<{ mutation: MutationReceipt }>
  importPromptResource(input: ImportPromptResourceInput, context?: RuntimeRequestContext): Promise<CreatePromptResourceResult>
  exportPromptResource(input: ExportPromptResourceInput): Promise<ExportPromptResourceResult>
  updateCardPromptResources(input: UpdateCardPromptResourcesInput, context?: RuntimeRequestContext): Promise<UpdateCardPromptResourcesResult>
  updatePromptResourceMacros(input: UpdatePromptResourceMacrosInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceMacrosResult>
  listLoreMounts(input?: ListLoreMountsInput): Promise<ListLoreMountsResult>
  replaceLoreMounts(input: ReplaceLoreMountsInput, context?: RuntimeRequestContext): Promise<ReplaceLoreMountsResult>
  createPromptResourceAsset(input: CreatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAsset(input: UpdatePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  updatePromptResourceAssets(input: UpdatePromptResourceAssetsInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  movePromptResourceAsset(input: MovePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  deletePromptResourceAsset(input: DeletePromptResourceAssetInput, context?: RuntimeRequestContext): Promise<UpdatePromptResourceResult>
  exportCardBundle(input: ExportCardBundleInput): Promise<ExportCardBundleResult>
}

export type RuntimeRequestContext = {
  /** Host-owned provenance; never accepted from extension or RPC payloads. */
  observationOrigin?: Omit<ObservationOrigin, 'actor' | 'sourceRunId'>
  extensionLeases?: TimelineExtensionLease[]
  actor?: DataActorRef
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  abortSignal?: AbortSignal
  agentRun?: {
    runId: string
    sendRequestDigest?: string
    onEvent: (event: AgentRunEvent) => void
    continuation?: {
      sourceRunId: string
      messages: ChatMessage[]
      userEntry: import('@loom-studio/application-data').AgentTranscriptEntry
      partialEntryId?: string
      recovery?: import('./agents/run-recovery.js').AgentRunRecoveryCheckpoint
      expectedEntryCount?: number
    }
    onSuspended?: (checkpoint: {
      sourceRunId: string
      messages: ChatMessage[]
      userEntry: import('@loom-studio/application-data').AgentTranscriptEntry
      partialEntryId?: string
      recovery?: import('./agents/run-recovery.js').AgentRunRecoveryCheckpoint
      expectedEntryCount?: number
    }) => void
    onMutationApproval?: (
      preview: VfsMutationPreview,
      signal: AbortSignal,
    ) => Promise<VfsMutationDecision>
    onHistoryReadApproval?: import('./narrative/access.js').ApproveNarrativeHistory
  }
}

export type AgentRunTask = {
  runId: string
  agentSessionId: string
  title?: string
  timelineId?: string
  state: 'running' | 'suspended' | 'interrupted' | 'completed' | 'failed' | 'cancelled' | 'discarded'
  reason?: string
  updatedAt: string
  canPause: boolean
  canResume: boolean
  canAbandon: boolean
}

export type AgentStreamPosition = {
  /** Last committed transcript sequence before this stream segment. */
  afterSequence?: number
  streamId?: string
  roundId?: string
  candidateId?: string
  timelinePosition?: AgentTranscriptEntry['timelinePosition']
  purpose?: 'narrative' | 'discussion'
}

export type AgentRunEvent =
  | (AgentStreamPosition & { type: 'reasoning-delta'; runId: string; providerRunId: string; providerStep: number; reasoningId: string; delta: string })
  | { type: 'started'; runId: string }
  | { type: 'transcript-appended'; runId: string; entries: AgentTranscriptEntry[] }
  | (AgentStreamPosition & { type: 'text-delta'; runId: string; providerRunId: string; providerStep: number; delta: string })
  | (AgentStreamPosition & { type: 'tool-input-delta'; runId: string; providerRunId: string; providerStep: number; toolCallId: string; toolName?: string; delta: string })
  | { type: 'mutation-approval-requested'; runId: string; requestId: string; preview: VfsMutationPreview }
  | { type: 'history-read-approval-requested'; runId: string; requestId: string; action: import('./narrative/access.js').NarrativeHistoryReadApproval }
  | { type: 'usage'; runId: string; providerRunId: string; providerStep: number; usage: NonNullable<GatewayChatResult['usage']> }
  | { type: 'completed'; runId: string; result: InvokeAgentTurnResult }
  | { type: 'suspended'; runId: string; reason?: string }
  | { type: 'failed'; runId: string; error: { name: string; message: string } }
  | { type: 'cancelled'; runId: string; reason?: string }

export type InstallOfficialContentInput = {
  packageId: string
  packageVersion: string
  resources: Array<{ id: string; artifact: PromptResourceArtifact }>
  loreMounts: Array<{ presetResourceId: string; loreResourceId: string }>
}

export type InstallOfficialContentResult = {
  resources: Array<{ id: string; created: boolean }>
  mutation?: MutationReceipt
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
  extensionTarget?: ExtensionInstallationTarget
  target: StateTarget
}

export type GetStateSnapshotResult = {
  snapshot: StateSnapshotView
  playerProfile?: import('@loom-studio/shared').PlayerProfileState
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
  componentKey?: string
  targetEntityTypeIds?: string[]
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

export type CardStateTemplate = StateComponentTemplate

export type StateReferenceDiagnostic = {
  code: 'state.entity_ref_unresolved'
  path: string
  reference: StateEntityId
}

export type MaterializedStateContribution = {
  snapshot: JsonObject
  entityTypes: StateEntityType[]
  entities: StateEntityId[]
  components: Array<{
    path: string
    schema: JsonObject
    templateId: string
    componentKey: string
  }>
  references: Array<{
    path: string
    annotation: StateEntityRefAnnotation
  }>
  referenceDiagnostics: StateReferenceDiagnostic[]
  bindings: TimelineStateBinding[]
}

export type TimelineRuntimeContextContent = {
  timelineId: string
  sourceCardId: string
  sourceCardVersion: number
  cardName?: string
  stateEntityTypes: StateEntityType[]
  stateEntities: StateEntityId[]
  stateComponents: MaterializedStateContribution['components']
  stateReferences: MaterializedStateContribution['references']
  stateContributionSources: Array<{
    installationId: string
    contributionId: string
    packageId: string
    moduleId: string
    packageVersion: string
    declaration: import('@loom-studio/shared').StateContribution
  }>
  stateBindings: Array<{
    installationId?: string
    path: string
    schema: JsonObject
  }>
  createdAt: string
}

export type InspectStateSourcesInput = {
  cardId?: string
  target?: Extract<StateTarget, { scope: 'timeline' }>
}

export type StateSourcesInspection = {
  card: {
    id: string
    version: number
    name: string
    declaration: import('@loom-studio/shared').StateContribution
    definitionIds: string[]
    contributionIds: string[]
  } | null
  definitions: StateDefinitionEntry[]
  extensions: Array<{
    installationId: string
    packageId: string
    target: ExtensionInstallationTarget | null
    installation: (ExtensionInstallationContent & { version: number }) | null
    cardDefault: boolean
    adoption: TimelineExtensionParticipationContent['entries'][number] | null
    eligible: boolean
    registered: TimelineRuntimeContextContent['stateContributionSources']
    accepted: TimelineRuntimeContextContent['stateContributionSources']
  }>
  timeline: {
    target: Extract<StateTarget, { scope: 'timeline' }>
    revisionId: string
    context: TimelineRuntimeContextContent | null
    paths: Array<{
      path: string
      kind: 'entity' | 'component' | 'binding'
      installationId?: string
      present: boolean
    }>
  } | null
}

export type ListStateDefinitionsInput = {
  kind?: StateDefinitionDraft['kind']
  ids?: string[]
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

export type MutationReceipt = {
  changesetId: string
}

export type AgentTurnMutationReceipt = MutationReceipt & {
  scope: 'agent-session-transcript'
}

export type AppendNarrativeInput = {
  attachments?: ChatAttachment[]
  timelineId: string
  branchId: string
  nodeId: string
  expectedHeadNodeId: string | null
  content: string
}

export type AppendNarrativeInputResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  node: NarrativeNode
  mutation: MutationReceipt
}

export type CreateNarrativeTimelineInput = {
  cardId: string
  agentPresetId?: string
  playerProfile?: import('@loom-studio/shared').PlayerProfileState
  extensionAdoptions?: CardExtensionAdoption[]
  expectedCardVersion?: number
  title?: string
  openingId?: string
  openingContent?: string
}

export type CreateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  mutation: MutationReceipt
}

export type ImportNarrativeHistoryInput = {
  cardId: string
  title?: string
  messages: Array<{ content: string; role?: 'user' | 'assistant'; createdAt?: string }>
}

export type ReplaceNarrativeOpeningInput = Pick<CreateNarrativeTimelineInput, 'expectedCardVersion' | 'openingId' | 'openingContent'> & {
  timelineId: string
  branchId: string
  expectedHeadNodeId: string | null
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

export type UpdateNarrativeTimelineInput = {
  timelineId: string
  title?: string
}

export type UpdateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  mutation: MutationReceipt
}

export type CreateAgentSessionInput = {
  agentPresetId: string
  title?: string
  timelineId?: string
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

export type ListAgentSessionsInput = {
  includeTimelines?: boolean
  agentPresetId?: string
  timelineId?: string
  standalone?: boolean
  cursor?: string
  limit?: number
}

export type ListAgentSessionsResult = {
  sessions: AgentSession[]
  nextCursor?: string
}

export type GetAgentTranscriptPageInput = {
  agentSessionId: string
  cursor?: string
  limit?: number
  selectedCandidates?: boolean
}

export type AppendAgentTranscriptEntriesInput = {
  agentSessionId: string
  expectedEntryCount: number
  entries: Array<{
    id?: string
    runId?: string
    entry: import('@loom-studio/application-data').AgentTranscriptEntryData
  }>
}

export type AppendAgentTranscriptEntriesResult = {
  session: AgentSession
  entries: AgentTranscriptEntry[]
  mutation: MutationReceipt
}

export type CompleteAgentSessionHandoffInput = {
  agentSessionId: string
  expectedEntryCount: number
  summary: string
  branchId?: string
  /** Fixed by the host when preparing the summary, never by a model tool argument. */
  boundary?: {
    sourceThroughSequence: number
    retiredThroughSequence: number
    adoptedWorkspaceRevisionId?: string
    narrative?: { timelineId: string; branchId: string; nodeId: string | null; stateRevisionId?: string; workspaceRevisionId?: string }
  }
}

export type CompleteAgentSessionHandoffResult = AppendAgentTranscriptEntriesResult & {
  memoryNotification: { status: 'notified' | 'not-configured' | 'failed'; error?: string }
}

export type DeleteAgentSessionInput = {
  agentSessionId: string
}

export type DeleteAgentSessionResult = {
  deleted: true
  mutation: MutationReceipt
}

export type UpdateAgentSessionInput = {
  agentSessionId: string
  agentPresetId?: string
  narrativeMode?: 'declared' | 'automatic'
  summaryPolicy?: import('@loom-studio/application-data').SessionSummaryPolicy
  title?: string
}

export type UpdateAgentSessionResult = {
  session: AgentSession
  mutation: MutationReceipt
}

export type SubmitAgentInterjectionInput = {
  macroSelections?: MacroSelectionMap
  activationFacts?: ActivationFacts
  agentSessionId: string
  requestId: string
  input: string
  mode: 'discussion' | 'narrative'
  narrativeTarget?: { timelineId: string; branchId: string }
  attachments?: ChatAttachment[]
}

export type InvokeAgentTurnInput = {
  attachments?: ChatAttachment[]
  interjectionRequestId?: string
  /** Host task execution without story history/state; Preset-controlled Card Lore remains available. */
  contextMode?: 'isolated'
  requestId?: string
  agentSessionId: string
  input: string
  resume?: boolean
  /** Replace the latest adopted discussion input and rerun from its material baseline. */
  retry?: { entryId: string }
  activationFacts?: ActivationFacts
  narrativeTarget?: {
    timelineId: string
    branchId?: string
    inputNodeId?: string
    sourceNodeId?: string
    swipe?: {
      groupId: string
      mode: 'swipe' | 'regenerate' | 'retry'
      input?: string
      expectedRevision: number
      allowSessionChange?: boolean
    }
  }
  macroSelections?: MacroSelectionMap
  promptAddition?: ExtensionPromptAddition
}

export type PreviewAgentTurnInput = InvokeAgentTurnInput

export type PreviewAgentTurnResult = {
  tokenEstimate: RequestTokenEstimate
  runId: string
  messages: ChatMessage[]
  projection: CompiledPrompt
  promptBuildTrace: PromptBuildTrace
  toolExposures: CompiledToolExposure[]
  toolPromptBuildTrace: ToolPromptBuildTrace
  providerPayloadPreview?: OpenAIChatPayload
  macroInspection: MacroInspection
}

export type InvokeAgentTurnResult = {
  summaryStatus?: import('./agents/session-summary.js').SessionSummaryStatus
  runId: string
  agentSession: AgentSession
  entries: {
    user: AgentTranscriptEntry
    assistant: AgentTranscriptEntry
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
  mutation: AgentTurnMutationReceipt
  macroInspection: MacroInspection
}

export type InspectMacrosInput = {
  cardId?: string
  presetId?: string
  timelineTarget?: { timelineId: string; branchId?: string }
  macroSelections?: MacroSelectionMap
}

export type InspectMacrosResult = {
  macroInspection: MacroInspection
}

export type ApplicationRuntimeOptions = {
  observations?: ObservationStore
  onStateChanged?: (event: StateChangeEvent) => void
  validatePackageAsset?: (input: { packageId: string; packageVersion: string; target: ExtensionInstallationTarget; path: string }) => Promise<void>
  exportExtensionArchive?: (input: { archive: Uint8Array; packageId: string; version: string; installationId: string }) => Promise<Uint8Array>
  withCardDeletion?: (cardId: string, commit: () => Promise<DeleteCardResult>) => Promise<DeleteCardResult>
  withCardDeletions?: (cardIds: string[], commit: () => Promise<DeleteCardsResult>) => Promise<DeleteCardsResult>
  agents?: AgentStore
  agentTools?: AgentToolRegistry
  dataEngine?: SqliteDataEngine
  documents: DocumentStore
  blobs?: BlobStorage
  narratives?: NarrativeStore
  promptResources: PromptResourceStore
  states?: StateStore
  logger?: Logger
  runtimeLogger?: Logger
  gateway?: AiGateway
  clock?: { now(): Date }
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets?: SecretStore
  providerAdapters?: ProviderAdapterRegistry
  aiCapabilities?: AiGatewayCapabilityRegistry
  macroProviders?: MacroProviderRegistry
  promptProcessors?: PromptProcessorRegistry
  stateContent?: StateContentRegistry
  narrativeContext?: NarrativeContextRegistry
  stateContributions?: StateContributionRegistry
  timelineArchiveParticipants?: TimelineArchiveParticipant[]
}

export type StateChangeEvent = {
  target: StateTarget
  revisionId: string
  changesetId: string
  paths: string[]
}

export type MediaAssetLookup = {
  get(assetId: string): Promise<{ id: string; mediaType?: string; sizeBytes?: number; kind?: string } | undefined>
  read?(assetId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
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

export type PreparedBlobStorageWrite = {
  blob: {
    id: string
    sha256: string
    sizeBytes: number
    mediaType?: string
    createdAt: string
  }
  existing: boolean
}

export type BlobStorage = {
  prepareWrite(input: { source: Uint8Array; mediaType?: string; maxBytes?: number }): Promise<PreparedBlobStorageWrite>
  participateWrite(tx: SqliteDataTransaction, prepared: PreparedBlobStorageWrite): {
    blob: PreparedBlobStorageWrite['blob']
    created: boolean
  }
  read(blobId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
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

export type ProviderMessage = ChatMessage

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
  delivery?: 'stream' | 'complete'
  onEvent?: (event: import('@loom-studio/ai-gateway').AiGatewayEvent) => void
}

export type CanonicalChatRequest = {
  messages: ProviderMessage[]
  tools?: Array<{ name: string; description?: string; inputSchema: JsonObject }>
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'tool'; toolName: string }
  metadata?: JsonObject
  providerOptions?: JsonObject
}

export type GatewayChatResult = {
  message: AssistantChatMessage
  text: string
  reasoning?: string
  toolCallErrors?: Record<string, { code: string; message: string }>
  model: string
  provider: string
  finishReason?: 'stop' | 'length' | 'tool_call' | 'error'
  rawStopReason?: string
  usage?: TokenUsage
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
  mediaAssets?: MediaAssetLookup
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

  lore?: LoreInput
  media?: CardMediaRefs
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
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

export type CardSummary = Pick<CardFrameworkFields, 'catalogSource'> & {
  id: string
  artifactId: string
  derivedFrom?: { artifactId: string }
  version: number
  name: string
  userName?: string
  description?: string
  openingPreview?: string
  validationError?: string
  media?: CardMediaRefs
  createdAt: string
  updatedAt: string
}

export type UpdateCardInput = {
  cardId: string
  extensionAdoptions?: CardExtensionAdoption[]
  expectedVersion?: number
  name?: string
  userName?: string
  description?: string
  preset?: CardPresetInput
  opening?: OpeningChatInput | string
  lore?: LoreInput
  media?: CardMediaRefs
  stateTemplates?: CardStateTemplate[]
  stateDefinitionIds?: string[]
  stateEntityTypes?: StateEntityType[]
  timelineStateEntities?: StateEntityId[]
  timelineComponentMounts?: TimelineComponentMount[]
  stateContributionIds?: string[]
  timelineStateBindings?: TimelineStateBinding[]
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
}

export type UpdateCardResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type DeleteCardInput = {
  cardId: string
  includePlayData?: boolean
  includePromptResources?: boolean
}

export type DeleteCardsInput = {
  cardIds: string[]
  includePlayData?: boolean
  includePromptResources?: boolean
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

export type DeleteCardsResult = DeleteCardResult & {
  cardIds: string[]
}

export type PortableExtensionPayloadDraft = Omit<PortableExtensionPayloadArtifact, 'id'>

export type PortableExtensionPayloadEntry = PortableExtensionPayloadDraft & {
  ownerInstallationId?: string
  id: string
  artifactPayloadId: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ListPortableExtensionPayloadsInput = {
  ownerInstallationId?: string | null
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
  ownerInstallationId?: string
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
  tokenMultipliers?: Record<string, number>
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
  credential?: Record<string, string>
  tokenMultipliers?: Record<string, number>
  expectedVersion: number
  providerProfileId: string
  displayName?: string
  config?: JsonObject
  enabledModelIds?: string[]
}

export type UpdateProviderProfileResult = {
  credentialCleanupFailed?: boolean
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
  providerExtensionId?: string
  capabilityId: string
  displayName: string
  config: JsonObject
  available: boolean
  unavailableReason?: 'provider-profile-missing' | 'provider-unavailable' | 'capability-unavailable'
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
  providerProfileId?: string
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
export type AgentDelivery = 'stream' | 'complete'

export type AgentPresetEntry = PromptResourceContent & { id: string; version: number }
export type CreateAgentPresetInput = {
  name: string
  model?: ProviderModelSelection
  delivery?: AgentDelivery
  historyPolicy?: AgentHistoryPolicy
  approvalPolicy?: AgentApprovalPolicy
}
export type AgentPresetResult = {
  agentPreset: AgentPresetEntry
  mutation: MutationReceipt
}
export type UpdateAgentPresetInput = {
  agentPresetId: string
  expectedVersion: number
  name?: string
  model?: ProviderModelSelection | null
  delivery?: AgentDelivery
  historyPolicy?: AgentHistoryPolicy
  approvalPolicy?: AgentApprovalPolicy
  useCardLore?: boolean
  useCardText?: boolean
  useGlobalLore?: boolean
  useGlobalText?: boolean
  textUses?: Array<{ id: string; kind: 'rule' | 'extractor'; enabled: boolean; orderIndex?: number }>
}

export type ListAgentToolsResult = { tools: AgentToolEntry[] }

export type ImportCardBundleInput = { newCardId?: string } & (
  {
    artifact: CardBundleArtifact
    source?: never
  }
  | {
    artifact?: never
    source: {
      text: string
      originalFileName?: string
    }
  })

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
  invalidResources?: Array<{ id: string; resourceKind: PromptResourceKind; label: string; version: number; error: string }>
}

export type GetPromptResourceBindingsResult = {
  resourceId: string
  cards: Array<{ id: string; name: string }>
  loreMounts: ListLoreMountsResult['mounts']
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
  expectedVersion: number
  cardId: string
  promptResourceIds: string[]
  externalPromptResourceIds?: string[]
}

export type UpdateCardPromptResourcesResult = {
  card: CardSourceContent & { id: string; version: number }
  mutation: MutationReceipt
}

export type UpdatePromptResourceMacrosInput = {
  resourceId: string
  expectedVersion: number
  macros: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
}

export type UpdatePromptResourceMacrosResult = {
  resource: PromptResourceContent & { id: string; version: number }
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
  expectedVersion?: number
  assetId: string
  body?: string
  capabilities?: PromptResourceCompositionCapabilities
  label?: string
  meta?: string
  enabled?: boolean
}

export type UpdatePromptResourceAssetsInput = {
  resourceId: string
  expectedVersion?: number
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
}

export type ExportCardBundleInput = {
  cardId: string
}

export type ExportCardBundleResult = {
  artifact: CardBundleArtifact
}

export type ProviderProfileContent = {
  tokenMultipliers?: Record<string, number>
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
  installationId?: string
}

export type ExtensionInstallationTarget = import('@loom-studio/extension-sdk').ExtensionInstallationTarget

export type ExtensionInstallationContent = {
  dependencies?: import('@loom-studio/extension-sdk').ExtensionDependency[]
  packageId: string
  packageVersion: string
  participation?: 'timeline'
  source?: ExtensionInstallationSource
  target: ExtensionInstallationTarget
  archiveBlobId?: string
  createdAt: string
  updatedAt: string
}

export type ExtensionInstallationSource =
  | { kind: 'git' | 'zip'; url: string }
  | { kind: 'local'; directory: string }
  | { kind: 'card' }

export type TimelineExtensionParticipationContent = {
  timelineId: string
  entries: Array<{
    installationId: string
    packageId: string
    packageVersion: string
    installationVersion: number
    source?: ExtensionInstallationSource
    enabled: boolean
    generation: string
  }>
}

export type CardExtensionAdoption = {
  packageId: string
  target: 'global' | 'card'
}

export type TimelineExtensionParticipation = TimelineExtensionParticipationContent & { version: number }

export type TimelineExtensionResourceInspection = {
  timelineId: string
  installationId: string
  resources: Array<{ id: string; kind: string; label: string; contributionId: string; packageId: string; eligible: boolean }>
}

export type TimelineExtensionRecoveryPreview = {
  timelineId: string
  installationId: string
  expectedVersion: number
  expectedInstallationVersion: number
  packageId: string
  packageVersion: string
  previousSource: ExtensionInstallationSource
  source: ExtensionInstallationSource
  sourceChanged: boolean
}

export type PreviewTimelineExtensionAdoptionInput = {
  timelineId: string
  branchId: string
  installationId: string
}

export type AdoptTimelineExtensionInput = PreviewTimelineExtensionAdoptionInput & {
  expectedVersion: number
  expectedInstallationVersion: number
  expectedStateRevisionId: string
  expectedRuntimeContextVersion: number
  contributionInstances: Array<{ contributionId: string; instanceId: string }>
}

export type TimelineExtensionAdoptionPreview = AdoptTimelineExtensionInput & {
  packageId: string
  packageVersion: string
  source: ExtensionInstallationSource
  paths: string[]
}

export type RecoverTimelineExtensionInput = {
  timelineId: string
  installationId: string
  expectedVersion: number
  expectedInstallationVersion: number
  acceptSourceChange?: boolean
}

export type UpdateTimelineExtensionParticipationInput = {
  timelineId: string
  installationId: string
  expectedVersion: number
  enabled: boolean
}

export type TimelineExtensionLease = import('@loom-studio/extension-sdk').ExtensionTimelineLease

export type ListExtensionInstallationsResult = {
  installations: Array<ExtensionInstallationContent & { id: string; version: number }>
}

export type ImportExtensionPackageResourcesInput = {
  dependencies?: import('@loom-studio/extension-sdk').ExtensionDependency[]
  participation?: 'timeline'
  source?: ExtensionInstallationSource
  loomScripts?: Array<{ contribution: { id: string; source: string; orderIndex?: number; groupOrder?: number }; source: string }>
  expectedCardVersion?: number
  update?: { expectedInstallationVersion: number; expectedPreviewFingerprint?: string }
  packageId: string
  packageVersion: string
  target?: ExtensionInstallationTarget
  promptResources: Array<{
    contribution: ExtensionPromptResourceContribution
    artifact: JsonValue
  }>
  agentTools: Array<{
    contribution: ExtensionAgentToolContribution
    definition: JsonValue
  }>
  transformRules: Array<{
    contribution: ExtensionTextTransformRuleContribution
    artifact: JsonValue
  }>
  textExtractors: Array<{
    contribution: ExtensionTextExtractorContribution
    artifact: JsonValue
  }>
}

export type ImportExtensionPackageResourcesResult = {
  loomScripts?: Array<{ contributionId: string; scriptId: string }>
  installationId: string
  promptResources: Array<{ contributionId: string; resourceId: string; resourceKind: PromptResourceKind }>
  agentTools: Array<{ contributionId: string; toolId: string }>
  transformRules: Array<{ contributionId: string; ruleId: string }>
  textExtractors: Array<{ contributionId: string; extractorId: string }>
  mutation?: MutationReceipt
}

export type PreviewExtensionPackageResourcesInput = ImportExtensionPackageResourcesInput & {
  update: NonNullable<ImportExtensionPackageResourcesInput['update']>
}

export type PreviewExtensionPackageResourcesResult = {
  packageId: string
  installationId: string
  packageVersion: string
  expectedInstallationVersion: number
  fingerprint: string
  items: Array<{
    kind: string
    contributionId: string
    resourceId?: string
    name?: string
    action: 'add' | 'update' | 'remove' | 'unchanged'
    localChanges: 'unknown' | 'none' | 'modified'
    references?: Array<{ kind: string; id: string; name?: string }>
  }>
  warnings: string[]
}

export type UninstallExtensionInstallationInput = {
  packageId: string
  target?: ExtensionInstallationTarget
  expectedInstallationVersion: number
}

export type UninstallExtensionInstallationResult = {
  packageId: string
  installationId: string
  uninstalled: true
  resourcesRetained: true
  mutation?: MutationReceipt
}

export type RemoveExtensionPackageResourcesInput = {
  expectedInstallationVersion?: number
  packageId: string
  target?: ExtensionInstallationTarget
}

export type RemoveExtensionPackageResourcesResult = {
  loomScriptIds?: string[]
  loomScriptMountIds?: string[]
  packageId: string
  promptResourceIds: string[]
  agentToolIds: string[]
  textTransformRuleIds: string[]
  textExtractorIds: string[]
  detachedReferences: {
    cards: number
    timelines: number
    presetToolMounts: number
  }
  mutation?: MutationReceipt
}

export type CardFrameworkFields = {
  extensionDependencies?: Array<{ id: string; version: string; target: 'global' }>
  defaultPreset?: { packageId: string; contributionId: string; target: 'global' }
  catalogSource?: { packageId: string; characterId: string; version: string; digest: string }
}

export type CardSourceContent = CardFrameworkFields & {
  artifactId: string
  derivedFrom?: { artifactId: string }
  extensionAdoptions?: CardExtensionAdoption[]
  name: string
  userName?: string
  description?: string
  importBundleId?: string
  portableExtensionPayloadIds?: string[]
  extensionPackages?: Array<{ packageId: string; version: string; blobId: string }>
  promptResourceIds?: string[]
  externalPromptResourceIds?: string[]
  stateTemplates?: CardStateTemplate[]
  stateDefinitionIds?: string[]
  stateEntityTypes?: StateEntityType[]
  timelineStateEntities?: StateEntityId[]
  timelineComponentMounts?: TimelineComponentMount[]
  stateContributionIds?: string[]
  timelineStateBindings?: TimelineStateBinding[]
  media?: CardMediaRefs
  preset: CardPresetContent
  opening: OpeningChatContent
  lore: LoreContent
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
  createdAt: string
  updatedAt: string
}

export type AttachCardExtensionPackageInput = {
  cardId: string
  expectedVersion: number
  archive: NonNullable<CardBundleArtifact['extensionPackages']>[number]
}

export type CardMediaRefs = {
  avatarAssetId?: string
  coverAssetId?: string
}

export type CardPresetInput = {
  system?: string
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
}

export type CardPresetContent = {
  system?: string
  macros?: Record<string, string>
  macroOptions?: import("@loom-studio/shared").MacroOptions
}

export type OpeningChatInput = {
  id?: string
  title?: string
  content: string
  alternatives?: Array<{ id?: string; title?: string; content: string }>
}

export type OpeningChatContent = {
  id: string
  title?: string
  content: string
  alternatives?: Array<{ id: string; title?: string; content: string }>
}

export type LoreInput = {
  entries?: LoreEntryInput[]
}

export type LoreContent = {
  entries: LoreEntryContent[]
}

export type LoreEntryInput = {
  id?: string
  path?: string
  title?: string
  content: string
  enabled?: boolean
  activation?: LoreActivation
  tags?: string[]
}

export type LoreEntryContent = {
  id: string
  path?: string
  title?: string
  content: string
  enabled: boolean
  activation: LoreActivation
  tags: string[]
}

export type LoreActivation = PromptActivation
