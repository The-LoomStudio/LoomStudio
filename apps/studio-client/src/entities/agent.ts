import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { MutationReceipt } from './common.js'
import type { PromptProjection } from './prompt.js'

export type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export type ChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type AgentSession = {
  id: string
  agentProfileId: string
  title?: string
  headMessageId?: string
  messageCount: number
  createdAt: string
  updatedAt: string
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

export type CreateAgentSessionResult = {
  session: AgentSession
  mutation: MutationReceipt
}

export type AgentMessagePage = {
  session: AgentSession
  messages: AgentMessage[]
  nextCursor?: string
}

export type PreviewAgentTurnResult = {
  runId: string
  messages: ChatMessage[]
  projection: PromptProjection
  providerPayloadPreview?: ClientJsonValue
}

export type InvokeAgentTurnResult = {
  runId: string
  agentSession: AgentSession
  messages: {
    user: AgentMessage
    assistant: AgentMessage
  }
  narrative?: {
    timeline: import('./narrative.js').NarrativeTimeline
    branch: import('./narrative.js').NarrativeBranch
    node: import('./narrative.js').NarrativeNode
  }
  provider: {
    provider: string
    model: string
    finishReason?: string
    usage?: { inputTokens?: number; outputTokens?: number }
    providerCallId?: string
  }
  projection: PromptProjection
  mutation: MutationReceipt
}
