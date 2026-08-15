import type { DataActorRef, DataCommitFact, SqliteDataTransaction } from '@loom-studio/data-engine'
export type { ChatMessage, ChatToolCall } from '@loom-studio/shared'
import type { ChatMessage } from '@loom-studio/shared'

export type AgentSession = {
  id: string
  agentProfileId: string
  title?: string
  headMessageId?: string
  messageCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type AgentMessage = {
  id: string
  agentSessionId: string
  parentMessageId?: string
  sequence: number
  runId?: string
  message: ChatMessage
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

export type AppendAgentMessagesInput = AgentWriteContext & {
  agentSessionId: string
  expectedMessageCount: number
  messages: Array<{
    id?: string
    runId?: string
    message: ChatMessage
  }>
}

export type DeleteAgentSessionInput = AgentWriteContext & {
  agentSessionId: string
}

export type AgentMessagePage = {
  session: AgentSession
  messages: AgentMessage[]
  nextCursor?: string
}

export type AgentTransaction = {
  createSession(input: Omit<CreateAgentSessionInput, keyof AgentWriteContext>): AgentSession
  appendMessages(input: Omit<AppendAgentMessagesInput, keyof AgentWriteContext>): { session: AgentSession; messages: AgentMessage[] }
  deleteSession(input: Omit<DeleteAgentSessionInput, keyof AgentWriteContext>): AgentSession
}

export type AgentStore = {
  getSession(id: string): Promise<AgentSession | null>
  getMessage(id: string): Promise<AgentMessage | null>
  getMessagePage(input: { agentSessionId: string; cursor?: string; limit?: number }): Promise<AgentMessagePage>
  hasSessionForProfile(agentProfileId: string): Promise<boolean>
  createSession(input: CreateAgentSessionInput): Promise<{ session: AgentSession; commit: DataCommitFact }>
  appendMessages(input: AppendAgentMessagesInput): Promise<{ session: AgentSession; messages: AgentMessage[]; commit: DataCommitFact }>
  deleteSession(input: DeleteAgentSessionInput): Promise<{ session: AgentSession; commit: DataCommitFact }>
  transaction(tx: SqliteDataTransaction): AgentTransaction
}
