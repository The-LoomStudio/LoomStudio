export { applicationDocumentTypes } from './foundation/document-types.js'
export * from './transforms/history-text.js'
export { createApplicationRuntime } from './runtime/runtime.js'
export {
  materializeTimelineState,
  StateDefinitionError,
  toStateDefinitionEntry,
  validateStateDefinitionDraft,
  validateStateValue,
  validateTimelineStateBinding,
} from './state/state-definition.js'
export { composeAgentTurnPrompt } from './agents/agent-turn.js'
export {
  exportCardArtifact,
  importCardBundle,
  isPromptResourceArtifact,
  isCardBundleArtifact,
  normalizeCardBundleArtifact,
  normalizePortableExtensionPayloadArtifact,
  readPromptResourceInputs,
} from './cards/workspace.js'
export {
  createDocumentBackedAiGateway,
  createDocumentBackedProfiledAiGateway,
  createFakeAiGateway,
  createFakeProvider,
  createOpenAICompatibleGateway,
} from './providers/gateway.js'
export { officialFakeModelId } from './runtime/providers-runtime.js'
export {
  buildOpenAIChatPayload,
} from './providers/provider-payload.js'
export { createAgentToolRegistry } from './agents/tool-registry.js'
export {
  createOfficialAgentToolRegistry,
  createPromptToolExecutionScope,
  officialAgentToolDefinitions,
  officialReadContextTool,
  officialReadStateTool,
  officialSearchContextTool,
  officialUpdateStateTool,
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
  PortableExtensionPayloadArtifact,
  PortableExtensionPayloadContent,
  PromptResourceNode,
  PromptResourceContent,
  PromptResourceArtifact,
  PromptResourceKind,
  CardBundleSourceArtifactRef,
  CardBundleSourceBinding,
  PromptResourceCompositionCapabilities,
} from './cards/workspace.js'
