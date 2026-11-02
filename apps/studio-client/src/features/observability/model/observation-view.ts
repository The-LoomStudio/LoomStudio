export type ObservationReference = { label: string; note?: string; open?: () => void }

// Display projections shared by the production reader and the isolated development preview.
export type ObservationMessage = {
  id: string
  role: string
  content: string
  raw?: unknown
  toolCalls?: Array<{ name: string; arguments: string }>
  estimatedTokens?: number
  sourceId?: string
  change?: string
  position?: number
}

export type ObservationSource = {
  id: string
  title: string
  path: string
  nodeKind?: string
  orderIndex?: number
  parentId?: string
  targetAnchorIds?: string[]
  anchorIds?: string[]
  activationKind?: string
  lifecycle?: string
  injections?: Array<{ id: string; targetAnchorId?: string; role?: string; messageIndex?: number; original?: string; rendered: string }>
  included?: boolean
  active: boolean
  reason: string
  originalRecorded?: boolean
  original: string
  rendered: string
}

export type ObservationStep = {
  id: string
  title: string
  description: string
  status: 'completed' | 'running' | 'failed' | 'aborted' | 'suspended'
  duration: string
  model?: string
  finishReason?: string
  messages: ObservationMessage[]
  response?: ObservationMessage
  outputRecorded?: boolean
  sources: ObservationSource[]
  variables: Array<{ name: string; path: string; value: string; source: string; hostId?: string; stage?: string }>
  tools: Array<{ id: string; name: string; input?: unknown; result?: unknown; status: string }>
  measurement?: {
    estimatedTokens?: number
    toolTokens?: number
    inputTokens?: number
    outputTokens?: number
    note: string
  }
  kind?: 'build' | 'request'
  evidence?: { messages: boolean; sources: boolean; variables: boolean; tools: boolean }
  toolDefinitions?: unknown[]
  configuration?: unknown
  capability?: { profileId: string; providerId?: string; capabilityId?: string }
  capabilityInput?: string
  raw?: unknown
  canCompare?: boolean
  initialInput?: boolean
  removedMessages?: ObservationMessage[]
  references?: ObservationReference[]
  identity?: Record<string, string | undefined>
  comparison?: string
  firstOutputMs?: number
  diagnostic?: string
}

export type ObservationRecord = {
  source?: import('../../log-viewer/model/use-log-reference-labels.js').LogReferenceLabel['source']
  id: string
  title: string
  kind: 'run' | 'build' | 'api'
  status: ObservationStep['status']
  time: string
  references?: ObservationReference[]
  identity?: Record<string, string | undefined>
  origin: string
  context: string
  steps: ObservationStep[]
  stepCount?: number
  diagnostic?: string
}
