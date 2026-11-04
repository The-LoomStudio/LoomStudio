import type { StepToolItem } from '../../sessions/model/transcript-render-items.js'
export type NarrativeSessionStep = {
  id: string
  kind: 'thinking' | 'tool' | 'narrative' | 'reply'
  tool?: StepToolItem
  title: string
  content: string
  state: 'running' | 'completed'
  role?: 'user' | 'assistant'
  presentation?: 'question'
}
export type NarrativeSessionExecution = {
  order?: number
  id: string
  preset: string
  durationMs?: number
  runningSince?: number
  inputAttachments?: import('@loom-studio/shared').ChatAttachment[]
  interjectionStatus?: 'pending' | 'applied' | 'discarded'
  input?: string
  inputEntryId?: string
  runId?: string
  error?: string
  failures?: Array<{ id: string; message: string }>
  resumable?: boolean
  retryable?: boolean
  state: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  steps: NarrativeSessionStep[]
}

export function executionActivity(execution: NarrativeSessionExecution): string | undefined {
  if (execution.state === 'paused') return '已暂停'
  if (execution.state !== 'running') return undefined
  const step = execution.steps.at(-1)
  if (step?.kind === 'tool' && step.state === 'running') return `正在调用 ${step.title}`
  if (step?.kind === 'thinking' && step.state === 'running') return '正在思考'
  if (step?.kind === 'narrative' && step.state === 'running') return '正在写正文'
  return '正在生成回复'
}
