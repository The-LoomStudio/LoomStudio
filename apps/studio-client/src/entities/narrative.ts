import type { MutationReceipt } from './common.js'

export type NarrativeTimeline = {
  id: string
  opening?: { id?: string; nodeId?: string; locked: boolean; custom?: boolean }
  title?: string
  openingPreview?: string
  latestPreview?: string
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
  stateHeadRevisionId: string
  parentBranchId?: string
  forkedFromNodeId?: string
  createdAt: string
  updatedAt: string
}

export type NarrativeNode = {
  entryId?: string
  kind: 'user-input' | 'narrative'
  floor: number
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
