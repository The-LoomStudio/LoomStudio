import type { DataTransactionInput } from '@loom-studio/data-engine'
import type {
  DataCommitFact,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import type { ChatAttachment, JsonObject, JsonValue } from '@loom-studio/shared'
import type { TokenCount, TokenUsage } from '@loom-studio/tokenizer/contracts'

export type SessionSummaryPolicy = {
  enabled: boolean
  maxTokens: number
  bufferFloors: number
  triggerFloors: number
  triggerTokens: number
  asynchronous: boolean
}

export type AgentSession = {
  id: string
  kind: 'agent' | 'timeline'
  agentPresetId?: string
  narrativeMode?: 'declared' | 'automatic'
  timelineId?: string
  title?: string
  headEntryId?: string
  summaryPolicy?: SessionSummaryPolicy
  entryCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type AgentMessageState = 'partial' | 'complete'

export type AgentToolInvocationStatus =
  | 'proposed'
  | 'waiting-approval'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'skipped'

export type AgentToolResultStatus =
  | 'completed'
  | 'failed'
  | 'denied'
  | 'aborted'
  | 'skipped'

export type AgentTranscriptEntryData =
  | {
      kind: 'user-interjection'
      withdrawn?: boolean
      requestId: string
      content: string
      mode: 'discussion' | 'narrative'
      narrativeTarget?: { timelineId: string; branchId: string }
      attachments?: ChatAttachment[]
      macroSelections?: import('@loom-studio/shared').MacroSelectionMap
      activationFacts?: JsonObject
    }
  | { kind: 'interjection-applied'; requestId: string }
  | { kind: 'interjection-discarded'; requestId: string }
  | {
      /** Saved handoff; retired history stays stored. Legacy entries retire their preceding segment. */
      kind: 'work-summary'
      content: string
      /** Host-selected boundaries; absent on legacy summaries. */
      boundary?: {
        sourceThroughSequence: number
        retiredThroughSequence: number
        adoptedWorkspaceRevisionId?: string
        narrative?: { timelineId: string; branchId: string; nodeId: string | null; stateRevisionId?: string; workspaceRevisionId?: string }
      }
    }
  | {
      kind: 'message'
      editBaseline?: JsonObject
      purpose?: 'narrative' | 'discussion'
      narrativeId?: string
      role: 'user' | 'assistant'
      content: string
      attachments?: ChatAttachment[]
      interjectionRequestId?: string
      state?: AgentMessageState
      continuesEntryId?: string
    }
  | {
      kind: 'reasoning'
      content: string
      source: 'provider-native' | 'assistant-content'
      dialect?: string
      providerCallId?: string
      rawRef?: string
      visibility: 'collapsed' | 'hidden' | 'visible'
      replay: 'omit' | 'assistant-content'
    }
  | {
      kind: 'request-measurement'
      measurementId: string
      providerStep: number
      providerProfileId: string
      modelId: string
      requestDigest: string
      scope: 'canonical-content-v1'
      count: TokenCount
      uncounted: string[]
    }
  | {
      kind: 'provider-observation'
      provider: string
      model: string
      providerCallId?: string
      rawStopReason?: string
      normalizedStopReason?:
        'stop' | 'length' | 'tool-call' | 'error' | 'cancelled'
      usage?: TokenUsage
      measurementId?: string
      providerStep?: number
      rawRef?: string
    }
  | {
      kind: 'tool-invocation'
      invocationId: string
      toolId: string
      exposedName: string
      transport: 'native-function' | 'provider-custom' | 'content'
      arguments?: JsonObject
      rawInput?: string
      providerCallId?: string
      providerItemId?: string
      status: AgentToolInvocationStatus
    }
  | {
      kind: 'tool-result'
      invocationId: string
      toolId: string
      status: AgentToolResultStatus
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'json'; value: JsonValue }
        | { type: 'artifact-ref'; artifactId: string }
      >
      error?: { code: string; message: string }
      syntheticReason?:
        | 'provider-error'
        | 'provider-abort'
        | 'length'
        | 'interrupt'
        | 'timeout'
        | 'orphan-repair'
    }
  | {
      kind: 'run-state'
      recovery?: JsonObject
      sourceRunId?: string
      state:
        | 'created'
        | 'running'
        | 'suspended'
        | 'completed'
        | 'failed'
        | 'aborted'
        | 'discarded'
      reason?: string
      measurementId?: string
    }

export type AgentTranscriptEntry = {
  id: string
  agentSessionId: string
  parentEntryId?: string
  roundId?: string
  candidateId?: string
  sequence: number
  runId?: string
  entry: AgentTranscriptEntryData
  createdAt: string
}

export type AgentWriteContext = DataTransactionInput
export type CreateAgentSessionInput = AgentWriteContext & {
  id?: string
  agentPresetId: string
  timelineId?: string
  title?: string
}
export type AppendAgentTranscriptEntriesInput = AgentWriteContext & {
  agentSessionId: string
  expectedEntryCount: number
  entries: Array<{
    id?: string
    runId?: string
    roundId?: string
    candidateId?: string
    entry: AgentTranscriptEntryData
  }>
}
export type DeleteAgentSessionInput = AgentWriteContext & {
  agentSessionId: string
}
export type UpdateAgentSessionInput = AgentWriteContext & {
  agentSessionId: string
  title?: string
  timelineId?: string | null
  summaryPolicy?: SessionSummaryPolicy
  agentPresetId?: string
  narrativeMode?: 'declared' | 'automatic'
}
export type AgentTranscriptPage = {
  session: AgentSession
  entries: AgentTranscriptEntry[]
  nextCursor?: string
}

export type ListAgentSessionsInput = {
  includeTimelines?: boolean
  agentPresetId?: string
  timelineId?: string
  standalone?: boolean
  cursor?: string
  limit?: number
}

export type AgentSessionPage = {
  sessions: AgentSession[]
  nextCursor?: string
}

export type AgentSessionRunSummary = {
  agentSessionId: string
  title?: string
  timelineId?: string
  updatedAt: string
  run?: {
    runId: string
    state: Extract<AgentTranscriptEntryData, { kind: 'run-state' }>['state']
    reason?: string
    updatedAt: string
  }
}

export type AgentSummaryTask = {
  taskId: string
  agentSessionId: string
  state: 'preparing' | 'submitted' | 'adopted' | 'failed'
  content: string
  sourceThroughSequence: number
  toolArguments?: string
  createdAt: string
  updatedAt: string
}

export type AgentTransaction = {
  reviseInterjection(input: { entryId: string; expected: AgentTranscriptEntryData; replacement: AgentTranscriptEntryData }): AgentTranscriptEntry
  rewindStandalone(input: { agentSessionId: string; expectedHeadEntryId?: string; headEntryId?: string }): void
  restoreTimelineEntries(input: { agentSessionId: string; entries: AgentTranscriptEntry[]; headEntryId?: string; entryCount: number }): AgentSession
  getEntry(id: string): AgentTranscriptEntry | null
  createTimelineSession(input: { id: string; title?: string; agentPresetId?: string }): AgentSession
  setTimelineHead(input: { agentSessionId: string; headEntryId: string | null }): AgentSession
  writeSummaryTask(input: Omit<AgentSummaryTask, 'createdAt' | 'updatedAt'>): void
  getLatestWorkSummary(agentSessionId: string): AgentTranscriptEntry | null
  getSession(id: string): AgentSession | null
  createSession(
    input: Omit<CreateAgentSessionInput, keyof AgentWriteContext>,
  ): AgentSession
  listSessions(input?: ListAgentSessionsInput): AgentSessionPage
  appendEntries(
    input: Omit<AppendAgentTranscriptEntriesInput, keyof AgentWriteContext>,
    options?: { timelineBranchId: string },
  ): { session: AgentSession; entries: AgentTranscriptEntry[] }
  deleteSession(
    input: Omit<DeleteAgentSessionInput, keyof AgentWriteContext>,
  ): AgentSession
  updateSession(
    input: Omit<UpdateAgentSessionInput, keyof AgentWriteContext>,
  ): AgentSession
}

export type AgentStore = {
  listEntries(agentSessionId: string): Promise<AgentTranscriptEntry[]>
  countSummaryMessages(agentSessionId: string, retiredThrough: number, sourceThrough: number): Promise<{ retired: number; source: number; total: number }>
  listSummaryTasks(agentSessionId: string): Promise<AgentSummaryTask[]>
  listRunStates(): Promise<AgentSessionRunSummary[]>
  getSession(id: string): Promise<AgentSession | null>
  listSessions(input?: ListAgentSessionsInput): Promise<AgentSessionPage>
  getEntry(id: string): Promise<AgentTranscriptEntry | null>
  findRunCheckpoint(input: { agentSessionId: string; runId: string }): Promise<AgentTranscriptEntry | null>
  getLatestWorkSummary(agentSessionId: string): Promise<AgentTranscriptEntry | null>
  getEntryPage(input: {
    agentSessionId: string
    cursor?: string
    limit?: number
  }): Promise<AgentTranscriptPage>
  createSession(
    input: CreateAgentSessionInput,
  ): Promise<{ session: AgentSession; commit: DataCommitFact }>
  appendEntries(input: AppendAgentTranscriptEntriesInput): Promise<{
    session: AgentSession
    entries: AgentTranscriptEntry[]
    commit: DataCommitFact
  }>
  deleteSession(
    input: DeleteAgentSessionInput,
  ): Promise<{ session: AgentSession; commit: DataCommitFact }>
  updateSession(
    input: UpdateAgentSessionInput,
  ): Promise<{ session: AgentSession; commit: DataCommitFact }>
  transaction(tx: SqliteDataTransaction): AgentTransaction
}
