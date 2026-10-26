import type { StudioRpcOutputs } from '../shared/api/trpc-client.js'
import type { ToolContentPlacement, PresetToolMountInput } from '@loom-studio/shared/tool-mounts'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { MacroInspection } from '@loom-studio/shared'
import type { MutationReceipt } from './common.js'
import type { PromptProjection } from './prompt.js'

export type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type ChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export type AgentSession = {
  id: string
  kind: 'agent' | 'timeline'
  agentPresetId?: string
  narrativeMode?: 'declared' | 'automatic'
  title?: string
  timelineId?: string
  headEntryId?: string
  entryCount: number
  createdAt: string
  updatedAt: string
}

export type AgentTranscriptEntry = {
  id: string
  /** Client-only identity retained when streamed reasoning, text or a tool becomes a saved entry. */
  presentationId?: string
  agentSessionId: string
  parentEntryId?: string
  roundId?: string
  candidateId?: string
  sequence: number
  runId?: string
  entry: {
    kind: string
    role?: 'user' | 'assistant'
    content?: string | ClientJsonValue
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
  input: import('../shared/api/trpc-client.js').StudioRpcInputs['application']['updateAgentTool']['definition']['input']
  prompt?: import('../shared/api/trpc-client.js').StudioRpcInputs['application']['updateAgentTool']['definition']['prompt']
  createdAt: string
  updatedAt: string
}

type ToolExposure = {
  toolId: string
  exposed: boolean
  transport?: 'native-function' | 'provider-custom' | 'content'
  diagnostics: ClientJsonValue[]
  [key: string]: ClientJsonValue | undefined
}

export type PreviewAgentTurnResult = StudioRpcOutputs['application']['previewAgentTurn']

export type InvokeAgentTurnResult = StudioRpcOutputs['application']['invokeAgentTurn']
