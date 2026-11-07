export { chatAttachmentSchema, readChatAttachments, sameChatAttachments } from './chat-attachments.js'
export type { ChatAttachment } from './chat-attachments.js'
export type { AssistantChatMessage, ChatMessage, ChatToolCall } from './chat.js'
export { playerEntityType, playerEntity, playerEntityPath, playerProfileComponentKey, playerProfilePath, playerProfileTemplateId, readPlayerProfile } from './player-state.js'
export type { PlayerProfileState } from './player-state.js'
export {
  globalSearchKindSchema,
  globalSearchScopeSchema,
  searchResourcesInputSchema,
  listGlobalSearchScopesInputSchema,
} from './global-search.js'
export type {
  GlobalSearchKind,
  GlobalSearchScope,
  GlobalSearchHit,
  SearchResourcesInput,
  SearchResourcesResult,
  SearchScopeOption,
  ListGlobalSearchScopesInput,
  ListGlobalSearchScopesResult,
} from './global-search.js'
export {
  stripPromptAuthorDepth,
  promptAnchorOutput,
  isPromptMessageSequence,
  canPlacePromptNode,
  listLoreMountsInputSchema,
  listLoreMountsResultSchema,
  replaceLoreMountsInputSchema,
  replaceLoreMountsResultSchema,
  loreMountSchema,
  loreMountSourceSchema,
} from './prompt-resource-contracts.js'
export type {
  ListLoreMountsInput,
  ListLoreMountsResult,
  ReplaceLoreMountsInput,
  ReplaceLoreMountsResult,
  LoreMount,
  LoreMountSource,
} from './prompt-resource-contracts.js'
export type { CardDirectoryPreview, CardDirectorySaveResult, CardDirectoryEntry, CardDirectoryCatalog, OpenCardDirectoryResult, CardDirectoryAttachment } from './resource-directories.js'
export type {
  StateArtifact,
  StateComponentTemplate,
  StateContribution,
  StateEntityId,
  StateEntityRefAnnotation,
  StateEntityType,
  TimelineComponentMount,
  TimelineStateBinding,
} from './state-contribution.js'
export type {
  MacroCandidate,
  MacroInspection,
  MacroInspectionEntry,
  MacroProviderContext,
  MacroProviderDefinition,
  MacroRenderContext,
  MacroRenderTrace,
  MacroSelectionMap,
  MacroSelection,
  MacroOption,
  MacroOptions,
  MacroSourceKind,
  VariableDiagnostic,
  VariableRenderContext,
  VariableRenderTrace,
  VariableReadTrace,
  VariableSnapshot,
} from './macros.js'
export {
  builtinMacroAliases,
  canonicalMacroName,
  cloneMacroInspection,
  cloneVariableSnapshot,
  cloneVariableRenderTrace,
  createVariableRenderContext,
  isJsonScalar,
  isValidMacroName,
  isReservedMacroName,
  macroNamePattern,
  macroSelectionMatches,
  normalizeMacroOptions,
  normalizeMacroSelections,
  renderVariableMacros,
} from './macros.js'

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]
export type SerializedError = {
  code: string
  message: string
  details?: JsonValue
}

export type Clock = {
  now(): Date
}

export type IdGenerator = {
  next(prefix?: string): string
}

export function nowIso(clock: Clock = { now: () => new Date() }): string {
  return clock.now().toISOString()
}

export { createId } from './id.js'

export function serializeError(error: unknown, code = 'internal.error'): SerializedError {
  if (error instanceof Error) {
    return {
      code: 'code' in error && typeof error.code === 'string' ? error.code : code,
      message: error.message,
    }
  }

  return {
    code,
    message: String(error),
  }
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value)
}
export { formatResourceReference, parseResourceReference, formatEntityReference, parseEntityReference, parseResourceLink, type ResourceReference, type EntityReference } from './resource-reference.js'

export { promptResourceDisplayMetadataSchema } from './prompt-resource-contracts.js'
export type { PromptResourceDisplayMetadata } from './prompt-resource-contracts.js'

export { authoringNodeSchema, authoringResourceSchema, authoringApplySchema, authoringStateSchema } from './resource-authoring-contracts.js'
export type { AuthoringNode, AuthoringResource, AuthoringApplyInput, AuthoringState } from './resource-authoring-contracts.js'

export { toolReferenceSchema, extensionToolMountSchema, authoringToolMountSchema } from "./tool-mount-contracts.js"
export type { AgentToolReference, ExtensionToolMount } from "./tool-mount-contracts.js"
export { summarizePackageResource, packageResourceSummaryKinds } from './package-resource-summary.js'
export type { PackageResourceSummary, PackageResourceSummaryKind } from './package-resource-summary.js'

export { resourceReleaseSchema } from './prompt-resource-contracts.js'
