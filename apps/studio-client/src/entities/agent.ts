import type { StudioRpcOutputs } from '../shared/api/trpc-client.js'
import type { MutationReceipt } from './common.js'

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

type StoredTranscriptEntry = StudioRpcOutputs['application']['getAgentTranscriptPage']['entries'][number]
type StoredEntryData = StoredTranscriptEntry['entry']
type ClientEntryData = Exclude<StoredEntryData, { kind: 'reasoning' }>
  | (Extract<StoredEntryData, { kind: 'reasoning' }> & { state?: 'partial' | 'completed' })
  | { streamId?: string; kind: 'tool-input'; providerItemId: string; exposedName?: string; rawInput: string; status: 'preparing' | 'interrupted' }

export type AgentTranscriptEntry = Omit<StoredTranscriptEntry, 'entry'> & {
  /** Client-only identity retained when streamed reasoning, text or a tool becomes a saved entry. */
  presentationId?: string
  /** Server-provided insertion boundary; draft sequence is never persisted. */
  streamAfterSequence?: number
  entry: ClientEntryData
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

export type PreviewAgentTurnResult = StudioRpcOutputs['application']['previewAgentTurn']

export type InvokeAgentTurnResult = StudioRpcOutputs['application']['invokeAgentTurn']
