export * from './observability/types.js'
export { createObservationStore } from './observability/store.js'
export { createObservedAiGateway } from './observability/gateway.js'
export { applicationDocumentTypes } from './foundation/document-types.js'
export { readUserProfiles, resolveCurrentUserProfile, userProfilesDocumentId } from './profiles/user-profiles.js'
export type { UserProfile, UserProfilesConfig, UserProfilesContent, ResolvedUserProfile, CreateUserProfileInput, UpdateUserProfileInput, SelectUserProfileInput, DeleteUserProfileInput } from './profiles/user-profiles.js'
export { parseCardExtensionAdoptions } from './cards/card.js'
export { officialPromptResourceIds } from './prompt/prompt-resource-defaults.js'
export * from './transforms/history-text.js'
export { createApplicationRuntime } from './runtime/runtime.js'
export { extensionInstallationId } from '@loom-studio/extension-sdk'
export {
  expandTimelineStateBindings,
  materializeTimelineState,
  StateDefinitionError,
  toStateDefinitionEntry,
  validateStateDefinitionDraft,
  validateStateValue,
  validateTimelineStateBinding,
} from './state/state-definition.js'
export {
  createCardStateContribution,
  composeStateContributions,
  createStateArtifact,
  materializeStateContribution,
  parseStateArtifact,
  StateContributionError,
  validateStateContribution,
} from './state/state-contribution.js'
export { createStateContributionRegistry } from './state/state-contribution-registry.js'
export {
  createTimelineArchiveParticipantRegistry,
  parseTimelineArchive,
  serializeTimelineArchive,
} from './archive/timeline-archive.js'
export type {
  TimelineArchiveDataBlock,
  TimelineArchive,
  TimelineArchiveExportInput,
  TimelineArchiveIdMap,
  TimelineArchiveImportInput,
  TimelineArchiveParticipant,
  TimelineArchiveParticipantHandle,
  TimelineArchiveParticipantRegistry,
} from './archive/timeline-archive.js'
export type { StateContributionRegistry, StateContributionSource } from './state/state-contribution-registry.js'
export { composeAgentTurnPrompt } from './agents/agent-turn.js'
export { createNarrativeSampler } from './narrative/sampling.js'
export { createNarrativeReader } from './narrative/access.js'
export type { NarrativeHistoryReadApproval, ApproveNarrativeHistory } from './narrative/access.js'
export { createNarrativeContextRegistry } from './narrative/context-provider.js'
export type { NarrativeContextRegistry, ResolvedNarrativeContext } from './narrative/context-provider.js'
export type { NarrativeContextProjection, NarrativeContextProvider } from '@loom-studio/extension-sdk'
export { projectNarrativeNodes, projectNarrativeSample } from './narrative/projection.js'
export type {
  NarrativeSampleRequest,
  NarrativeSampleResult,
  NarrativeSampleSelection,
  NarrativeSampler,
  NarrativeReadRange,
} from './narrative/sampling.js'
export {
  exportCardArtifact,
  importCardBundle,
  readPromptResourceInputs,
} from './cards/card-bundle.js'
export {
  isPromptResourceArtifact,
  isCardBundleArtifact,
  assertCardBundleArtifact,
  normalizeCardBundleArtifact,
  normalizePromptResourceArtifact,
  normalizePortableExtensionPayloadArtifact,
} from './cards/card-bundle-codec.js'
export {
  createDocumentBackedAiGateway,
  createDocumentBackedProfiledAiGateway,
  createFakeAiGateway,
  createOpenAICompatibleGateway,
} from './providers/gateway.js'
export { officialFakeModelId } from './runtime/providers-runtime.js'
export {
  buildOpenAIChatPayload,
} from './providers/provider-payload.js'
export { createAgentToolRegistry } from './agents/tool-registry.js'
export { createMacroProviderRegistry } from './prompt/macro-provider-registry.js'
export { createPromptProcessorRegistry, type PromptProcessorRegistry } from './prompt/prompt-processor-registry.js'
export { createStateContentRegistry, type StateContentRegistry } from './state/state-content-registry.js'
export type { TimelinePresetConfig } from './prompt/timeline-preset-config.js'
export type { MacroProviderRegistry, MacroStaticSource } from './prompt/macro-provider-registry.js'
export type {
  ResolvedLoomScriptRendererMount,
  UnavailableLoomScriptMount,
  LoomScriptArtifact,
  LoomScriptAttachmentArtifact,
  LoomScriptContent,
  LoomScriptContributionDefinition,
  LoomScriptInput,
  LoomScriptEntry,
  LoomScriptMountContent,
  LoomScriptMountEntry,
  LoomScriptMountTarget,
  LoomScriptOwner,
  LoomScriptRendererContributionDefinition,
} from './scripts/loom-script-contracts.js'
export { parseLoomScriptSource, serializeLoomScriptMetadata } from './scripts/loom-script-codec.js'
export {
  createOfficialAgentToolRegistry,
  createPromptToolExecutionScope,
  officialAgentToolDefinitions,
  officialReadContextTool,
  officialReadStateTool,
  officialSearchContextTool,
  officialUpdateStateTool,
  officialAppendNarrativeTool,
  officialEditNarrativeTool,
  officialSearchPromptResourcesTool,
  officialReadPromptResourceTool,
  officialUpdatePromptResourceTool,
  officialCodeActTool,
  officialCodeActJsonTool,
} from './agents/official-tools/index.js'
export {
  createLoomContentScannerState,
  finishLoomContentScan,
  pushLoomContentChunk,
  renderLoomContentToolResult,
} from './agents/content-transport.js'
export type {
  LoomContentScanError,
  LoomContentScanErrorCode,
  LoomContentScanEvent,
  LoomContentScannerOptions,
  LoomContentScannerState,
  LoomContentScanResult,
  LoomContentToolInvocation,
  LoomContentToolResult,
} from './agents/content-transport.js'
export { compileToolPromptSources } from './agents/tool-prompt-build.js'
export type {
  CompiledToolExposure,
  CompiledToolPrompt,
  ToolPromptActivationTrace,
  ToolPromptBuildInput,
  ToolPromptBuildResult,
  ToolPromptBuildTrace,
  ToolPromptOrderTrace,
  ToolContentPlacement,
  ToolPromptSource,
  ToolPromptTemplate,
} from './agents/tool-prompt-build.js'
export type {
  AgentToolAnalysis,
  AgentToolRegistry,
  ModelToolTransportCapabilities,
  ResolvedAgentTools,
  StructuredToolFallback,
  ToolDefinition,
  ToolDiagnostic,
  ToolExposureAnalysis,
  ToolGrammar,
  ToolInputDefinition,
  ToolInvocation,
  ToolInvocationValidation,
  ToolOwnerRef,
  ToolApprovalContext,
  ToolApprovalDecision,
  ToolApprovalHandler,
  ToolExecutionContext,
  ToolExecutionScope,
  ToolContextItem,
  ToolExecutor,
  ToolRuntimeRegistration,
  ToolResult,
  ToolResultPart,
  ToolTransport,
} from './agents/tool-registry.js'
export type {
  VfsBinding,
  VfsApprovalControl,
  VfsEntry,
  VfsMutationDecision,
  VfsMutationPreview,
  VfsReadObservation,
  VfsStateTarget,
} from './vfs/types.js'
export {
  combineActivationGates,
  evaluateCondition,
  evaluatePromptActivation,
  isActivationCondition,
  isPromptActivation,
} from './prompt/prompt-activation.js'
export type {
  CompiledMessage,
  CompiledPrompt,
  EditorProjection,
  PromptCompositionCapabilities,
  PromptContribution,
  PromptFragment,
  PromptProviderRole,
  PromptSourceKind,
  SourceNode,
} from './prompt/prompt-builder.js'
export type { PromptBuildTrace } from './prompt/prompt-build-pipeline.js'
export {
  cloneVariableRenderTrace,
  createVariableRenderContext,
  renderVariableMacros,
} from './prompt/variables.js'
export type {
  VariableDiagnostic,
  VariableReadTrace,
  VariableRenderContext,
  VariableRenderTrace,
  VariableSnapshot,
} from './prompt/variables.js'
export type {
  ActivationCondition,
  ActivationEvaluation,
  ActivationFacts,
  PromptActivation,
} from './prompt/prompt-activation.js'
export type {
  OpenAIChatMessage,
  OpenAIChatPayload,
} from './providers/provider-payload.js'
export type * from './types.js'
export type {
  CardBundleBindingEndpoint,
  ImportBundleContent,
  CardBundleArtifact,
  CardBundleImportManifest,
  CardBundleSourceArtifactRef,
  CardBundleSourceBinding,
} from './cards/card-bundle-types.js'

export type { WorkspaceTarget, WorkspaceMutation, WorkspaceMutationInput } from './runtime/workspace-runtime.js'

export type { SessionSummaryStatus } from './agents/session-summary.js'
export { defaultSessionSummaryPolicy } from './agents/session-summary.js'

export { parseAgentApprovalPolicy } from './agents/approval-policy.js'
export type { AgentApprovalPolicy, AgentApprovalMode, AgentApprovalScope } from './agents/approval-policy.js'

export { readUserBackgrounds, userBackgroundsDocumentId } from './profiles/user-backgrounds.js'
export type { UserBackground, UserBackgroundsContent, UserBackgroundsConfig, AddUserBackgroundInput, RemoveUserBackgroundInput } from './profiles/user-backgrounds.js'

export { officialDeclareNarrativeTool } from './agents/official-tools/index.js'
export { resolvePackageDependency } from './extensions/package-dependency.js'
export type { ResolvePackageDependencyInput, ResolvedPackageDependency } from './extensions/package-dependency.js'

export type {
  PromptResourceKind,
  PromptResourceContent,
  PromptResourceArtifact,
  PromptResourceNode,
  PromptResourceCompositionCapabilities,
} from './prompt/prompt-resource-types.js'

export type {
  PortableExtensionPayloadArtifact,
  PortableExtensionPayloadContent,
} from './extensions/portable-payload-types.js'
