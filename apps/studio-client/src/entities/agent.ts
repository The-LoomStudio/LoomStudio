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
  headEntryId?: string
  entryCount: number
  createdAt: string
  updatedAt: string
}

export type AgentTranscriptEntry = {
  id: string
  agentSessionId: string
  parentEntryId?: string
  sequence: number
  runId?: string
  entry: {
    kind: string
    role?: 'user' | 'assistant'
    content?: string
    [key: string]: ClientJsonValue | undefined
  }
  createdAt: string
}

export type CreateAgentSessionResult = {
  session: AgentSession
  mutation: MutationReceipt
}

export type AgentTranscriptPage = {
  session: AgentSession
  entries: AgentTranscriptEntry[]
  nextCursor?: string
}

export type AgentToolDefinition = {
  id: string
  version: number
  owner: { namespace: string }
  name: string
  description: string
  input: {
    kind: 'structured' | 'freeform' | 'hybrid'
    [key: string]: ClientJsonValue | undefined
  }
  prompt?: {
    parameterDescriptions?: Record<string, string>
    guidance?: string
    activation?: ClientJsonValue
    provider?: { order?: number }
    content?: {
      zone?: string
      slot?: string
      rankKey?: string
      orderHint?: number
    }
  }
  createdAt: string
  updatedAt: string
}

export type ToolExposure = {
  toolId: string
  exposed: boolean
  transport?: 'native-function' | 'provider-custom' | 'content'
  diagnostics: ClientJsonValue[]
  [key: string]: ClientJsonValue | undefined
}

export type PreviewAgentTurnResult = {
  runId: string
  messages: ChatMessage[]
  projection: PromptProjection
  toolExposures: ToolExposure[]
  toolPromptBuildTrace: ClientJsonValue
  providerPayloadPreview?: ClientJsonValue
}

export type InvokeAgentTurnResult = {
  runId: string
  agentSession: AgentSession
  entries: {
    user: AgentTranscriptEntry
    assistant: AgentTranscriptEntry
  }
  narrative?: {
    timeline: import('./narrative.js').NarrativeTimeline
    branch: import('./narrative.js').NarrativeBranch
    nodes: import('./narrative.js').NarrativeNode[]
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
  toolExposures: ToolExposure[]
  toolPromptBuildTrace: ClientJsonValue
  mutation: MutationReceipt
}
