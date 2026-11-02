import type { StudioRpcOutputs } from '../shared/api/trpc-client.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { RendererContributionDefinition } from '@loom-studio/extension-sdk'

export type HistorySource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string; headEntryId?: string }

export type TextTransformPhase = 'classify' | 'prompt' | 'display'

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

export type TextTransformRule = TextTransformRuleDraft & { id: string; version: number; createdAt: string; updatedAt: string; scriptDocumentId?: string; contributionId?: string }
  & { origin?: ExtensionPackageResourceOrigin }

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

type ExtensionPackageResourceOrigin = {
  kind: 'extension-package'
  packageId: string
  packageVersion: string
  contributionId: string
}

export type HistoryProjectionSnapshot = StudioRpcOutputs['application']['projectHistory']['snapshot']

export type RendererDefinition = RendererContributionDefinition

export type TextPipelineInspection = StudioRpcOutputs['application']['inspectTextPipeline']
