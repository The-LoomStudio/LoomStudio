import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'
import type { MutationReceipt } from './common.js'

export type HistorySource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string; headEntryId?: string }

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
    | { kind: 'promote-reasoning'; contentGroup?: number | string; visibility: 'collapsed' | 'hidden' | 'visible'; replay: 'omit' | 'assistant-content'; dialect?: string }
  targets: Array<'narrative' | 'agent-session'>
  phases: Array<'classify' | 'prompt' | 'display'>
  range?: { minDepth?: number; maxDepth?: number }
}

export type TextTransformRule = TextTransformRuleDraft & { id: string; version: number; createdAt: string; updatedAt: string }

export type TextExtractorDraft = {
  name: string
  owner: TextRuleOwner
  enabled: boolean
  orderIndex: number
  targets: Array<'narrative' | 'agent-session'>
  matcher: { kind: 'regex'; pattern: string; flags: string; contentGroup?: number | string }
  strategy: 'latest-valid' | 'all-matches'
  parser: 'text' | 'key-value-lines'
  outputSchema?: Record<string, ClientJsonValue>
}

export type TextExtractor = TextExtractorDraft & { id: string; version: number; createdAt: string; updatedAt: string }

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
  matches: Array<{ ruleId: string; entryId: string; depth: number; start: number; end: number; match: string; captures: Array<string | undefined>; namedCaptures: Record<string, string | undefined> }>
  diagnostics: Array<{ code: string; message: string; ruleId?: string; entryId?: string }>
  ruleIds: string[]
}

export type RendererDefinition = RendererContributionDefinition

export type TextTransformMutationResult<T> = { mutation: MutationReceipt } & T
