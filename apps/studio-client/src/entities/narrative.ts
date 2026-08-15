import type { MutationReceipt } from './common.js'

export type NarrativeTimeline = {
  id: string
  title?: string
  createdFrom?: {
    cardId: string
    cardVersion: number
  }
  promptResourceIds: string[]
  activeBranchId: string
  createdAt: string
  updatedAt: string
}

export type NarrativeBranch = {
  id: string
  timelineId: string
  title?: string
  headNodeId?: string
  parentBranchId?: string
  forkedFromNodeId?: string
  createdAt: string
  updatedAt: string
}

export type NarrativeNode = {
  id: string
  timelineId: string
  parentNodeId?: string
  body: {
    format: 'loom-markdown.v1'
    raw: string
  }
  source?: {
    agentSessionId?: string
    agentMessageId?: string
    runId?: string
    changesetId?: string
  }
  createdAt: string
}

export type CreateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  mutation: MutationReceipt
}

export type GetNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branches: NarrativeBranch[]
}

export type ListNarrativeTimelinesResult = {
  timelines: NarrativeTimeline[]
  nextCursor?: string
}

export type NarrativePage = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  nextCursor?: string
}

export type ForkNarrativeBranchResult = {
  branch: NarrativeBranch
  mutation: MutationReceipt
}

export type SwitchNarrativeBranchResult = {
  timeline: NarrativeTimeline
  mutation: MutationReceipt
}
