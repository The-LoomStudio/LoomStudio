import type { ChatMessage } from '@loom-studio/shared'

export type ObservationStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'suspended'
export type ObservationOrigin = {
  timelineId?: string
  moduleId?: string
  instanceId?: string
  eventId?: string
  eventName?: string
  actor?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  installationId?: string
  packageId?: string
  sourceRunId?: string
}
export type ObservationSource = {
  id: string
  title: string
  path?: string
  nodeKind?: string
  orderIndex?: number
  parentId?: string
  /** IDs and aliases identifying this virtual anchor, not injection targets. */
  anchorIds?: string[]
  /** Authored targets, including contributions that were not emitted. */
  targetAnchorIds?: string[]
  activationKind?: string
  lifecycle?: string
  resourceId?: string
  version?: number | string
  active: boolean
  reason: string
  original?: string
  rendered?: string
  fragmentIds?: string[]
  placement?: unknown
}
export type ObservationVariable = {
  name: string
  path: string
  value?: unknown
  source: string
  hostId?: string
  stage?: string
}
export type ObservationBuild = {
  messages?: ChatMessage[]
  messageFragments?: string[][]
  sources?: ObservationSource[]
  variables?: ObservationVariable[]
  transformations?: unknown[]
  diagnostics?: unknown[]
  trace?: unknown
}
export type ObservationRequest = {
  preparedMessages?: ChatMessage[]
  input?: unknown
  capability?: { profileId: string; providerId?: string; capabilityId?: string }
  messages?: ChatMessage[]
  tools?: unknown[]
  toolChoice?: unknown
  model?: { providerProfileId?: string; modelId: string }
  configuration?: Record<string, unknown>
  phase?: 'prepared' | 'invoking' | 'completed' | 'failed' | 'aborted'
  delivery?: string
  estimate?: unknown
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; [key: string]: unknown }
  finishReason?: string
  providerCallId?: string
  firstOutputMs?: number
  response?: unknown
  /** Assistant text after reasoning and content-tool transport have been decoded. */
  assistantContent?: string
  toolExecutions?: Array<{ id: string; name: string; input?: unknown; result?: unknown; status: string; [key: string]: unknown }>
}
export type ObservationSummary = {
  id: string
  kind: 'run' | 'build' | 'api' | 'request'
  parentId?: string
  title: string
  status: ObservationStatus
  capturedAt: string
  updatedAt: string
  expiresAt: string
  agentPresetId?: string
  agentSessionId?: string
  timelineId?: string
  branchId?: string
  buildId?: string
  providerStep?: number
  origin?: ObservationOrigin
  durationMs?: number
  availability: 'recorded' | 'partial'
  diagnostic?: string
  /** Returned model output only; hasText does not imply a committed message. */
  output?: { toolNames: string[]; hasText: boolean }
}
export type ObservationEntry = ObservationSummary & {
  build?: ObservationBuild
  request?: ObservationRequest
}
export type ObservationWrite = Omit<ObservationEntry, 'capturedAt' | 'updatedAt' | 'expiresAt' | 'availability'> & {
  availability?: ObservationSummary['availability']
}
export type ObservationPatch = Partial<Omit<ObservationWrite, 'id' | 'kind' | 'parentId'>>
export type ObservationListInput = {
  kind?: 'run' | 'build' | 'api'
  status?: ObservationStatus
  agentSessionId?: string
  timelineId?: string
  cursor?: string
  limit?: number
}
export type ObservationListResult = { records: ObservationSummary[]; nextCursor?: string; dropped: number }
export type ObservationDetail = { record: ObservationSummary; children: ObservationSummary[] }
export type ObservationPersistenceState = { enabled: boolean; available: boolean; error?: string }
export type ObservationStore = {
  /** All producer writes are best effort. Use capture around producer-side mapping too. */
  capture(work: () => void): void
  write(record: ObservationWrite): void
  patch(id: string, patch: ObservationPatch): void
  get(id: string): ObservationEntry | null
  list(input?: ObservationListInput): ObservationListResult
  children(parentId: string): ObservationSummary[]
  ready(): Promise<void>
  persistence(): Promise<ObservationPersistenceState>
  setPersistence(enabled: boolean): Promise<ObservationPersistenceState>
  flush(): Promise<void>
  dispose(): Promise<void>
}
