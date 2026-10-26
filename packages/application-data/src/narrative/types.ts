import type { DataTransactionInput } from '@loom-studio/data-engine'
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
  deletedAt?: string
}

export type NarrativeBranch = {
  id: string
  timelineId: string
  title?: string
  headEntryId?: string
  headNodeId?: string
  stateHeadRevisionId: string
  workspaceHeadRevisionId: string
  parentBranchId?: string
  forkedFromNodeId?: string
  createdAt: string
  updatedAt: string
}

export type NarrativeNode = {
  kind: 'user-input' | 'narrative'
  /** Persistent position on a path; not a globally unique node identity. */
  floor: number
  id: string
  entryId?: string
  timelineId: string
  parentNodeId?: string
  stateRevisionId: string
  workspaceRevisionId: string
  body: NarrativeBody
  source?: NarrativeNodeSource
  createdAt: string
}

export type NarrativeWriteContext = DataTransactionInput

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
  stateRevisionId: string
  openingNode?: {
    id?: string
    body: NarrativeBody
    source?: Omit<NarrativeNodeSource, 'changesetId'>
    createdAt?: string
  }
  opening?: NarrativeTimeline['opening']
}

export type ReplaceNarrativeOpeningInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  expectedHeadNodeId: string | null
  expectedStateHeadRevisionId: string
  openingId?: string
  openingNode?: { body: NarrativeBody; createdAt?: string }
}

export type CreateNarrativeTimelineResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  commit: DataCommitFact
}

export type AppendNarrativeNodeInput = NarrativeWriteContext & {
  kind?: NarrativeNode['kind']
  timelineId: string
  branchId: string
  expectedHeadNodeId: string | null
  nodeId?: string
  body: NarrativeBody
  stateRevisionId: string
  source?: Omit<NarrativeNodeSource, 'changesetId'>
}

export type AppendNarrativeNodeResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  node: NarrativeNode
  commit: DataCommitFact
}

export type AppendNarrativeUserInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  nodeId: string
  expectedHeadNodeId: string | null
  body: NarrativeBody
}

export type AppendNarrativeUserInputResult = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  node: NarrativeNode
  commit: Pick<DataCommitFact, 'changesetId'>
}

export type ForkNarrativeBranchInput = NarrativeWriteContext & {
  timelineId: string
  fromBranchId: string
  fromNodeId: string
  branchId?: string
  title?: string
}

export type SetNarrativeBranchStateHeadInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  expectedStateHeadRevisionId: string | null
  stateRevisionId: string
}

export type SwitchNarrativeBranchInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  expectedActiveBranchId?: string
}

export type DeleteNarrativeTimelineInput = NarrativeWriteContext & {
  timelineId: string
}

export type UpdateNarrativeTimelineInput = NarrativeWriteContext & {
  timelineId: string
  title?: string
}

export type UpdateNarrativePromptResourcesInput = NarrativeWriteContext & {
  timelineId: string
  promptResourceIds: string[]
  expectedPromptResourceIds?: string[]
}

export type NarrativePage = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  nodes: NarrativeNode[]
  nextCursor?: string
}

export type NarrativeTimelinePage = {
  timelines: NarrativeTimeline[]
  nextCursor?: string
}

export type NarrativeSearchTimeline = Pick<NarrativeTimeline, 'id' | 'title' | 'createdFrom'>

export type EditNarrativeNodeInput = NarrativeWriteContext & {
  timelineId: string
  nodeId: string
  body: NarrativeBody
}

export type EditNarrativeNodeResult = {
  node: NarrativeNode
  timeline: NarrativeTimeline
  commit: DataCommitFact
}

export type NarrativeTransaction = {
  getRecoveryPoint(branchId: string, nodeId: string): NarrativeRecoveryPoint

  getBranch(id: string): NarrativeBranch | null
  getNode(id: string): NarrativeNode | null
  restoreBranch(input: { timelineId: string; branchId: string; expectedHeadNodeId: string | null; expectedStateHeadRevisionId: string; headNodeId: string | null; headEntryId?: string | null; stateRevisionId: string; workspaceRevisionId?: string; expectedWorkspaceHeadRevisionId?: string }): NarrativeBranch
  setBranchWorkspaceHead(input: { timelineId: string; branchId: string; expectedRevisionId: string; revisionId: string }): NarrativeBranch
  replaceOpening(input: Omit<ReplaceNarrativeOpeningInput, keyof NarrativeWriteContext>): CreateNarrativeTimelineResultWithoutCommit
  getTimeline(id: string): NarrativeTimeline | null
  restoreArchivePaths(input: { timelineId: string; nodes: NarrativeNode[]; branches: NarrativeBranch[]; recoveryPoints?: NarrativeRecoveryPoint[] }): void
  editBranchNode(input: Omit<EditBranchNodeInput, keyof NarrativeWriteContext>): EditBranchNodeValue
  createTimeline(input: Omit<CreateNarrativeTimelineInput, keyof NarrativeWriteContext>): CreateNarrativeTimelineResultWithoutCommit
  appendNode(input: Omit<AppendNarrativeNodeInput, keyof NarrativeWriteContext>): AppendNarrativeNodeResultWithoutCommit
  editNode(input: Omit<EditNarrativeNodeInput, keyof NarrativeWriteContext>): { node: NarrativeNode; timeline: NarrativeTimeline }
  forkBranch(input: Omit<ForkNarrativeBranchInput, keyof NarrativeWriteContext>): NarrativeBranch
  setBranchStateHead(input: Omit<SetNarrativeBranchStateHeadInput, keyof NarrativeWriteContext>): NarrativeBranch
  switchBranch(input: Omit<SwitchNarrativeBranchInput, keyof NarrativeWriteContext>): NarrativeTimeline
  deleteTimeline(input: Omit<DeleteNarrativeTimelineInput, keyof NarrativeWriteContext>): NarrativeTimeline
  updateTimeline(input: Omit<UpdateNarrativeTimelineInput, keyof NarrativeWriteContext>): NarrativeTimeline
  updatePromptResources(input: Omit<UpdateNarrativePromptResourcesInput, keyof NarrativeWriteContext>): NarrativeTimeline
}

export type NarrativeSwipeCandidate = {
  id: string
  inputNodeId?: string
  agentSessionId: string
  runIds: string[]
  editBaseRunCount?: number
  headEntryId?: string
  headNodeId?: string
  stateRevisionId: string
  workspaceRevisionId?: string
  status: 'running' | 'suspended' | 'completed' | 'failed' | 'discarded'
  mode: 'initial' | 'swipe' | 'regenerate' | 'retry' | 'edit'
  replacesCandidateId?: string
  createdAt: string
}

export type NarrativeSwipeStore = ReturnType<typeof import('./swipes.js').createNarrativeSwipeStore>

export type NarrativeSwipeGroup = {
  id: string
  timelineId: string
  branchId: string
  /** Communication attempts reuse a prose anchor without creating a roleplay input. */
  inputKind?: 'communication'
  inputNodeId?: string
  input: string
  baselineStateRevisionId: string
  baselineWorkspaceRevisionId?: string
  agentSessionId: string
  baseEntryId?: string
  baseEntryCount: number
  candidates: NarrativeSwipeCandidate[]
  inputs?: Array<{
    nodeId: string
    input: string
    baselineStateRevisionId: string
    baselineWorkspaceRevisionId?: string
    selectedCandidateId?: string
  }>
  selectedCandidateId?: string
  activeCandidateId?: string
  activeRunId?: string
  excludedRunIds?: string[]
  generation: number
  revision: number
  closed: boolean
  createdAt: string
  updatedAt: string
}

export type CreateNarrativeTimelineResultWithoutCommit = Omit<CreateNarrativeTimelineResult, 'commit'>
export type AppendNarrativeNodeResultWithoutCommit = Omit<AppendNarrativeNodeResult, 'commit'>

export type NarrativeRecoveryPoint = { headEntryId?: string; branchId: string; nodeId: string; stateRevisionId: string; workspaceRevisionId: string }

export type NarrativeStore = {
  getRecoveryPoint(branchId: string, nodeId: string): Promise<NarrativeRecoveryPoint>

  listRecoveryPoints(timelineId: string): Promise<NarrativeRecoveryPoint[]>
  editBranchNode(input: EditBranchNodeInput): Promise<EditBranchNodeValue & { commit: DataCommitFact }>
  getTimeline(id: string, options?: { includeDeleted?: boolean }): Promise<NarrativeTimeline | null>
  listTimelines(input?: { createdFromCardId?: string; cursor?: string; limit?: number }): Promise<NarrativeTimelinePage>
  listSearchTimelines(): Promise<NarrativeSearchTimeline[]>
  getBranch(id: string, options?: { includeDeleted?: boolean }): Promise<NarrativeBranch | null>
  listBranches(timelineId: string): Promise<NarrativeBranch[]>
  getNode(id: string, options?: { includeDeleted?: boolean }): Promise<NarrativeNode | null>
  listNodes(timelineId: string): Promise<NarrativeNode[]>
  getPage(input: { timelineId: string; branchId?: string; cursor?: string; limit?: number }): Promise<NarrativePage>
  createTimeline(input: CreateNarrativeTimelineInput): Promise<CreateNarrativeTimelineResult>
  appendNode(input: AppendNarrativeNodeInput): Promise<AppendNarrativeNodeResult>
  appendInput(input: AppendNarrativeUserInput): Promise<AppendNarrativeUserInputResult>
  editNode(input: EditNarrativeNodeInput): Promise<EditNarrativeNodeResult>
  forkBranch(input: ForkNarrativeBranchInput): Promise<{ branch: NarrativeBranch; commit: DataCommitFact }>
  setBranchStateHead(input: SetNarrativeBranchStateHeadInput): Promise<{ branch: NarrativeBranch; commit: DataCommitFact }>
  switchBranch(input: SwitchNarrativeBranchInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  deleteTimeline(input: DeleteNarrativeTimelineInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  updateTimeline(input: UpdateNarrativeTimelineInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  updatePromptResources(input: UpdateNarrativePromptResourcesInput): Promise<{ timeline: NarrativeTimeline; commit: DataCommitFact }>
  transaction(tx: SqliteDataTransaction): NarrativeTransaction
}

export type EditBranchNodeInput = NarrativeWriteContext & {
  timelineId: string
  branchId: string
  nodeId: string
  expectedHeadNodeId: string
  expectedBody: NarrativeBody
  body: NarrativeBody
}

export type EditBranchNodeValue = {
  timeline: NarrativeTimeline
  branch: NarrativeBranch
  replacements: Array<{ previousNodeId: string; node: NarrativeNode }>
}
