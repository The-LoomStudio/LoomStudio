export type NarrativeSessionStep = {
  id: string
  kind: 'thinking' | 'tool' | 'narrative' | 'reply'
  title: string
  content: string
  state: 'running' | 'completed'
  role?: 'user' | 'assistant'
  presentation?: 'question'
}
export type NarrativeSessionExecution = {
  id: string
  preset: string
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
