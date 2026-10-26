export type NarrativeSwipeView = {
  id: string
  timelineId: string
  branchId: string
  revision: number
  inputKind?: 'communication'
  inputNodeId?: string
  inputs?: Array<{ nodeId: string; input: string; selectedCandidateId?: string }>
  sourceAgentSessionId: string
  selectedCandidateId?: string
  selectedAgentSessionId?: string
  activeCandidateId?: string
  active: boolean
  suspended: boolean
  canSelect: boolean
  canGenerate: boolean
  requiresRegeneration?: boolean
  reason?: string
  candidates: Array<{
    id: string
    inputNodeId?: string
    nodeId?: string
    preview: string
    status: 'running' | 'suspended' | 'completed' | 'failed' | 'discarded'
  }>
}
