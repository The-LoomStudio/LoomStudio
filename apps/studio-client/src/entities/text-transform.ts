import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'
import type { MutationReceipt } from './common.js'

export type HistorySource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string; headEntryId?: string }

export type TextTransformPhase = 'classify' | 'prompt' | 'display'

export type TextPipelineConsumer = {
  agentSessionId: string
  agentProfileId: string
  presetId: string
}

export type TextPipelineOverride = {
  id: string
  version: number
  source:
    | { kind: 'narrative'; timelineId: string; branchId: string }
    | { kind: 'agent-session'; sessionId: string }
  phase: TextTransformPhase
  consumerAgentSessionId?: string
  disabledRuleIds: string[]
  orderedRuleIds: string[]
  createdAt: string
  updatedAt: string
}

export type TextRuleOwner =
  | { kind: 'workspace' }
  | { kind: 'preset'; presetId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'extension'; packageId: string; moduleId?: string }
  | { kind: 'user-override' }

export type TextTransformRuleDraft = {
  name: string
  owner: TextRuleOwner
  enabled: boolean
  orderIndex: number
  matcher: { kind: 'regex'; pattern: string; flags: string }
  effect:
    | { kind: 'replace'; replacement: string }
    | { kind: 'mark'; markerType?: string }
    | { kind: 'promote-reasoning'; contentGroup?: number | string; visibility: 'collapsed' | 'hidden' | 'visible'; replay: 'omit' | 'assistant-content'; dialect?: string }
  targets: Array<'narrative' | 'agent-session'>
  phases: Array<'classify' | 'prompt' | 'display'>
  range?: { minDepth?: number; maxDepth?: number }
}

export type TextTransformRule = TextTransformRuleDraft & { id: string; version: number; createdAt: string; updatedAt: string }
  & { origin?: ExtensionPackageResourceOrigin }

// Runtime inspection entries share the persisted CRUD shape, but are kept as
// explicit aliases so the client does not assemble an effective rule set.
export type TextTransformRuleEntry = TextTransformRule

export type TextExtractorDraft = {
  name: string
  owner: TextRuleOwner
  enabled: boolean
  orderIndex: number
  targets: Array<'narrative' | 'agent-session'>
  matcher: { kind: 'regex'; pattern: string; flags: string; contentGroup?: number | string }
  strategy: 'latest-valid' | 'all-matches'
  parser: 'text' | 'key-value-lines'
  artifactType?: string
  outputSchema?: Record<string, ClientJsonValue>
}

export type TextExtractor = TextExtractorDraft & { id: string; version: number; createdAt: string; updatedAt: string }
  & { origin?: ExtensionPackageResourceOrigin }

export type ExtensionPackageResourceOrigin = {
  kind: 'extension-package'
  packageId: string
  packageVersion: string
  contributionId: string
}

export type TextExtractorEntry = TextExtractor

export type HistoryProjectionSnapshot = {
  source: HistorySource
  phase: 'classify' | 'prompt' | 'display'
  entries: Array<{
    id: string
    text: string
    originalText: string
    depth: number
    appliedRuleIds: string[]
    promotedReasoning: Array<{ content: string; visibility: string; replay: string; dialect?: string }>
  }>
  matches: Array<{
    matchId: string
    ruleId: string
    ruleVersion: number
    entryId: string
    depth: number
    stepIndex: number
    occurrenceIndex: number
    inputRange: { start: number; end: number }
    displayRange?: { start: number; end: number }
    match: string
    captures: Array<string | undefined>
    namedCaptures: Record<string, string | undefined>
  }>
  diagnostics: Array<{ code: string; message: string; ruleId?: string; entryId?: string }>
  ruleIds: string[]
  trace?: {
    entryId: string
    canonicalText: string
    finalText: string
    steps: Array<{
      ruleId: string
      ruleVersion: number
      stepIndex: number
      effect: TextTransformRuleDraft['effect']['kind']
      matched: boolean
      inputText: string
      outputText: string
      matchIds: string[]
    }>
  }
}

export type RendererDefinition = RendererContributionDefinition

export type TextPipelineInspection = {
  source: HistorySource
  phase: TextTransformPhase
  consumer?: TextPipelineConsumer
  rules: TextTransformRuleEntry[]
  extractors: TextExtractorEntry[]
  artifacts: Array<{
    artifactId: string
    artifactType: string
    extractorId: string
    extractorVersion: number
    source: HistorySource
    phase: TextTransformPhase
    values: Array<{ value: ClientJsonValue; sourceEntryId: string }>
    stale: boolean
    diagnostics: Array<{ code: string; message: string; ruleId?: string; entryId?: string }>
  }>
  snapshot: HistoryProjectionSnapshot
}

export type TextTransformMutationResult<T> = { mutation: MutationReceipt } & T
