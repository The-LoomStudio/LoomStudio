import type {
  DataActorRef,
  DataCommitFact,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'

export type NarrativeBody = {
  format: 'loom-markdown.v1'
  raw: string
}

export type NarrativeNodeSource = {
  agentSessionId?: string
  agentMessageId?: string
  runId?: string
  changesetId?: string
}

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
  deletedAt?: string
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
  body: NarrativeBody
  source?: NarrativeNodeSource
  createdAt: string
}

export type NarrativeWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type CreateNarrativeTimelineInput = NarrativeWriteContext & {
  id?: string
  title?: string
  createdFrom?: {
    cardId: string
    cardVersion: number
  }
  promptResourceIds?: string[]
  primaryBranchId?: string
  primaryBranchTitle?: string
  openingNodes?: Array<{
    id?: string
    body: NarrativeBody
    source?: Omit<NarrativeNodeSource, 'changesetId'>
  }>
}

export type CreateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  commit: DataCommitFact
}

export type AppendNarrativeNodeInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  expectedHeadNodeId: string | null
  nodeId?: string
  body: NarrativeBody
  source?: Omit<NarrativeNodeSource, 'changesetId'>
}

export type AppendNarrativeNodeResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  node: NarrativeNode
  commit: DataCommitFact
}

export type ForkNarrativeBranchInput = NarrativeWriteContext & {
  timelineId: string
  fromBranchId: string
  fromNodeId: string
  branchId?: string
  title?: string
}

export type SwitchNarrativeBranchInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  expectedActiveBranchId?: string
}

export type DeleteNarrativeTimelineInput = NarrativeWriteContext & {
  timelineId: string
}

export type NarrativePage = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  nextCursor?: string
}

export type NarrativeTransaction = {
  createTimeline(input: Omit<CreateNarrativeTimelineInput, keyof NarrativeWriteContext>): CreateNarrativeTimelineResultWithoutCommit
  appendNode(input: Omit<AppendNarrativeNodeInput, keyof NarrativeWriteContext>): AppendNarrativeNodeResultWithoutCommit
  forkBranch(input: Omit<ForkNarrativeBranchInput, keyof NarrativeWriteContext>): NarrativeBranch
  switchBranch(input: Omit<SwitchNarrativeBranchInput, keyof NarrativeWriteContext>): NarrativeTimeline
  deleteTimeline(input: Omit<DeleteNarrativeTimelineInput, keyof NarrativeWriteContext>): NarrativeTimeline
}

export type CreateNarrativeTimelineResultWithoutCommit = Omit<CreateNarrativeTimelineResult, 'commit'>
export type AppendNarrativeNodeResultWithoutCommit = Omit<AppendNarrativeNodeResult, 'commit'>

export type NarrativeStore = {
  getTimeline(id: string): Promise<NarrativeTimeline | null>
  getBranch(id: string): Promise<NarrativeBranch | null>
  getNode(id: string): Promise<NarrativeNode | null>
  getPage(input: { timelineId: string; branchId?: string; cursor?: string; limit?: number }): Promise<NarrativePage>
  createTimeline(input: CreateNarrativeTimelineInput): Promise<CreateNarrativeTimelineResult>
  appendNode(input: AppendNarrativeNodeInput): Promise<AppendNarrativeNodeResult>
  forkBranch(input: ForkNarrativeBranchInput): Promise<{ branch: NarrativeBranch; commit: DataCommitFact }>
  switchBranch(input: SwitchNarrativeBranchInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  deleteTimeline(input: DeleteNarrativeTimelineInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  transaction(tx: SqliteDataTransaction): NarrativeTransaction
}
