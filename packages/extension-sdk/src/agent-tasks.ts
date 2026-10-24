import type { JsonObject } from '@loom-studio/shared'
import type { TokenUsage } from '@loom-studio/tokenizer/contracts'

export type ExtensionAgentTaskCreate = ({ presetId: string } | { presetContributionId: string }) & {
  title?: string
  lifecycle?: 'persistent' | 'temporary'
}
export type ExtensionAgentTaskInvoke = { sessionId: string; input: string; activationFacts?: JsonObject }
export type ExtensionAgentTaskResult = { sessionId: string; runId: string; usage?: TokenUsage } & (
  | { state: 'completed'; text: string }
  | { state: 'failed'; error: { code: string; message: string } }
  | { state: 'cancelled' | 'suspended' | 'interrupted'; reason?: string }
)
export type ExtensionAgentTaskSnapshot = {
  sessionId: string
  presetId: string
  title?: string
  state: 'idle' | 'running' | 'waiting-approval' | ExtensionAgentTaskResult['state']
  runId?: string
  lastOutput?: string
  result?: ExtensionAgentTaskResult
}
export type ExtensionAgentTaskProgressEvent =
  | { type: 'text-delta' | 'reasoning-delta' | 'tool-input-delta'; delta: string; toolCallId?: string; toolName?: string }
  | { type: 'tool'; invocationId: string; toolId: string; phase: 'invocation' | 'result'; status: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'state'; state: ExtensionAgentTaskSnapshot['state']; message?: string }
export type ExtensionAgentTaskProgress = {
  snapshot: ExtensionAgentTaskSnapshot
  events: ExtensionAgentTaskProgressEvent[]
  nextCursor: number
  replayExpired: boolean
  partialText?: string
  pendingApprovals: Array<{ requestId: string; kind: 'mutation' | 'history-read' }>
  done: boolean
}
