import type {
  DataActorRef,
  DataCommitFact,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import type { JsonObject, JsonValue } from '@loom-studio/shared'

export type AgentSession = {
  id: string
  agentProfileId: string
  title?: string
  headEntryId?: string
  entryCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type AgentTranscriptEntryData =
  | { kind: 'message'; role: 'user' | 'assistant'; content: string }
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
      kind: 'provider-observation'
      provider: string
      model: string
      providerCallId?: string
      rawStopReason?: string
      normalizedStopReason?:
        'stop' | 'length' | 'tool-call' | 'error' | 'cancelled'
      usage?: { inputTokens?: number; outputTokens?: number }
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
      status:
        | 'proposed'
        | 'waiting-approval'
        | 'running'
        | 'completed'
        | 'failed'
        | 'skipped'
    }
  | {
      kind: 'tool-result'
      invocationId: string
      toolId: string
      status: 'completed' | 'failed' | 'denied' | 'aborted' | 'skipped'
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
      state:
        | 'created'
        | 'running'
        | 'suspended'
        | 'completed'
        | 'failed'
        | 'aborted'
        | 'discarded'
      reason?: string
    }

export type AgentTranscriptEntry = {
  id: string
  agentSessionId: string
  parentEntryId?: string
  sequence: number
  runId?: string
  entry: AgentTranscriptEntryData
  createdAt: string
}

export type AgentWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}
export type CreateAgentSessionInput = AgentWriteContext & {
  id?: string
  agentProfileId: string
  title?: string
}
export type AppendAgentTranscriptEntriesInput = AgentWriteContext & {
  agentSessionId: string
  expectedEntryCount: number
  entries: Array<{
    id?: string
    runId?: string
    entry: AgentTranscriptEntryData
  }>
}
export type DeleteAgentSessionInput = AgentWriteContext & {
  agentSessionId: string
}
export type AgentTranscriptPage = {
  session: AgentSession
  entries: AgentTranscriptEntry[]
  nextCursor?: string
}

export type AgentTransaction = {
  createSession(
    input: Omit<CreateAgentSessionInput, keyof AgentWriteContext>,
  ): AgentSession
  appendEntries(
    input: Omit<AppendAgentTranscriptEntriesInput, keyof AgentWriteContext>,
  ): { session: AgentSession; entries: AgentTranscriptEntry[] }
  deleteSession(
    input: Omit<DeleteAgentSessionInput, keyof AgentWriteContext>,
  ): AgentSession
}

export type AgentStore = {
  getSession(id: string): Promise<AgentSession | null>
  getEntry(id: string): Promise<AgentTranscriptEntry | null>
  getEntryPage(input: {
    agentSessionId: string
    cursor?: string
    limit?: number
  }): Promise<AgentTranscriptPage>
  hasSessionForProfile(agentProfileId: string): Promise<boolean>
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
  transaction(tx: SqliteDataTransaction): AgentTransaction
}
