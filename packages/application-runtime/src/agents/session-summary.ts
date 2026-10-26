import { isHistoricalRunPrefix } from './run-recovery.js'
import { applyPatch, parsePatch } from 'diff'
import { scanContentTools } from './tool-response-protocol.js'
import { countText } from '@loom-studio/tokenizer'
import type { AgentSession, AgentTranscriptEntry, NarrativeNode, SessionSummaryPolicy } from '@loom-studio/application-data'
import type { ChatMessage } from '@loom-studio/shared'
import { isRecord } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { ProviderModelSelection, RuntimeRequestContext } from '../types.js'
import { narrativeWriteContext, requireAgents } from '../runtime/context.js'

export const defaultSessionSummaryPolicy: SessionSummaryPolicy = {
  enabled: true, maxTokens: 5000, bufferFloors: 0, triggerFloors: 40,
  // A scheduling threshold, not a claim about a provider's context capacity.
  triggerTokens: 200000, asynchronous: false,
}
type Context = Pick<ApplicationRuntimeContext, 'agents' | 'narratives' | 'workspaces' | 'dataEngine' | 'gateway' | 'createId' | 'narrativeContext' | 'documents' | 'providerAdapters'>
type Boundary = NonNullable<Extract<AgentTranscriptEntry['entry'], { kind: 'work-summary' }>['boundary']>
export type SummaryPlan = {
  sessionId: string
  expectedEntryCount: number
  previous: string
  boundary: Boundary
  policy: SessionSummaryPolicy
  memory?: { id: string; text: string }
}
export type SessionSummaryStatus = {
  taskId?: string
  state: 'idle' | 'preparing' | 'ready' | 'adopted' | 'failed'
  error?: string
  sourceThroughSequence?: number
  retiredThroughSequence?: number
  summaryEntryId?: string
}
type Pending = { controller: AbortController; plan: SummaryPlan; status: SessionSummaryStatus; toolArguments?: string; result?: { summary: string; memory?: string }; promise?: Promise<void> }

export async function planSessionSummary(ctx: Context, input: {
  session: AgentSession; entries: AgentTranscriptEntry[]; branchId?: string; sourceNodeId?: string | null; force?: boolean; allowFloorTrigger?: boolean
}): Promise<SummaryPlan | undefined> {
  const policy = input.session.summaryPolicy ?? defaultSessionSummaryPolicy
  if (!policy.enabled && !input.force) return
  const previous = input.entries.find(entry => entry.entry.kind === 'work-summary')
  const prior = previous?.entry.kind === 'work-summary' ? previous.entry : undefined
  const tail = input.entries.filter(entry => entry.entry.kind !== 'work-summary')
  if (!tail.length) return
  const latestState = [...tail].reverse().find(entry => entry.entry.kind === 'run-state')
  if (latestState && !(input.session.kind === 'timeline' && isHistoricalRunPrefix(latestState, input.branchId))
    && latestState.entry.kind === 'run-state'
    && ['running', 'created', 'suspended'].includes(latestState.entry.state)) throw new Error('Cannot summarize an active Session')
  const measurement = [...tail].reverse().find(entry => entry.entry.kind === 'request-measurement')
  const tokenDue = measurement?.entry.kind === 'request-measurement'
    && measurement.entry.count.estimatedTokens >= policy.triggerTokens
  const sourceThroughSequence = Math.max(...input.entries.map(entry => entry.sequence))
  let retiredThroughSequence = sourceThroughSequence
  let narrative: Boundary['narrative']
  let memory: SummaryPlan['memory']
  let floorsDue = false
  const retiredBefore = prior?.boundary?.retiredThroughSequence ?? previous?.sequence ?? 0
  if (input.session.kind === 'timeline') {
    // Root buffers retain whole story rounds, including every Run and discussion
    // between successive roleplay inputs. Preparation has no round counter.
    let starts = tail.flatMap((entry, index) => entry.entry.kind === 'message'
      && entry.entry.role === 'user' && entry.entry.purpose === 'narrative' ? [index] : [])
    if (!starts.length) {
      const seen = new Set<string>()
      starts = tail.flatMap((entry, index) => {
        if (!entry.roundId || seen.has(entry.roundId)) return []
        seen.add(entry.roundId)
        return [index]
      })
    }
    const rounds = starts.map((start, index) => {
      const end = starts[index + 1] ?? tail.length
      const entries = tail.slice(start, end)
      const state = entries.findLast(entry => entry.entry.kind === 'run-state')
      const complete = index < starts.length - 1 || Boolean(state && isHistoricalRunPrefix(state, input.branchId))
        || state?.entry.kind === 'run-state'
        && ['completed', 'failed', 'aborted', 'discarded'].includes(state.entry.state)
      return { start, end, complete }
    })
    const completed = rounds.filter(round => round.complete)
    floorsDue = completed.filter(round => tail[round.end - 1]!.sequence > retiredBefore).length >= policy.triggerFloors
    if (!rounds.length) {
      const lastCompleted = tail.findLast(entry => entry.entry.kind === 'run-state'
        && ['completed', 'failed', 'aborted', 'discarded'].includes(entry.entry.state))
      retiredThroughSequence = lastCompleted?.sequence ?? 0
    } else {
      const retained = completed.slice(-policy.bufferFloors)
      const firstRetained = policy.bufferFloors ? retained[0] : undefined
      const firstIncomplete = rounds.find(round => !round.complete)
      const retainIndex = Math.min(firstRetained?.start ?? tail.length, firstIncomplete?.start ?? tail.length)
      retiredThroughSequence = retainIndex ? tail[retainIndex - 1]!.sequence : 0
    }
  }
  if (input.session.timelineId && input.branchId && ctx.narratives) {
    const branch = await ctx.narratives.getBranch(input.branchId)
    if (!branch || branch.timelineId !== input.session.timelineId) throw new Error('Summary branch is unavailable')
    const sourceNodeId = input.sourceNodeId === undefined ? branch.headNodeId ?? null : input.sourceNodeId
    const nodes: NarrativeNode[] = []
    let id = input.session.kind === 'timeline' ? null : sourceNodeId
    while (id) {
      const node = await ctx.narratives.getNode(id)
      if (!node) throw new Error('Summary source is unavailable')
      nodes.push(node)
      id = node.parentNodeId ?? null
    }
    const source = sourceNodeId ? await ctx.narratives.getRecoveryPoint(branch.id, sourceNodeId) : undefined
    narrative = { timelineId: branch.timelineId, branchId: branch.id, nodeId: sourceNodeId,
      stateRevisionId: source?.stateRevisionId ?? branch.stateHeadRevisionId,
      workspaceRevisionId: source?.workspaceRevisionId ?? branch.workspaceHeadRevisionId }
    const sourceFloor = nodes[0]?.floor ?? 0
    const sessionRuns = new Set(tail.flatMap(entry => entry.runId ? [entry.runId] : []))
    const firstOwnNode = [...nodes].reverse().find(node => node.source?.runId && sessionRuns.has(node.source.runId))
    const priorFloor = nodes.find(node => node.id === prior?.boundary?.narrative?.nodeId)?.floor
      ?? (firstOwnNode ? Math.max(0, firstOwnNode.floor - 2) : sourceFloor)
    if (input.session.kind !== 'timeline') floorsDue = input.allowFloorTrigger !== false && sourceFloor - priorFloor >= policy.triggerFloors
    if (!input.force && !tokenDue && !floorsDue) return
    if (input.session.kind !== 'timeline' && policy.bufferFloors && nodes.length) {
      const retainedRuns = new Set(nodes.filter(node => node.floor > sourceFloor - policy.bufferFloors)
        .flatMap(node => node.source?.runId ? [node.source.runId] : []))
      const firstRetained = tail.find(entry => entry.runId && retainedRuns.has(entry.runId))
      // No exact Run mapping means no safe compression, never guess from a floor number.
      if (!firstRetained) throw new Error('No complete Session Run maps to the configured Narrative buffer')
      retiredThroughSequence = firstRetained.sequence - 1
    }
    const workspace = await ctx.workspaces.get(branch.workspaceHeadRevisionId)
    const file = workspace?.entries.find(entry => !entry.parentId && entry.name === 'MEMORY.md')
    if (!file || file.kind !== 'file' || !('text' in file.content)) throw new Error('Shared MEMORY.md must be an available text file for handoff')
    memory = { id: file.id, text: file.content.text }
  }
  if (!input.force && !tokenDue && !floorsDue) return
  if (retiredThroughSequence <= retiredBefore) return
  return { sessionId: input.session.id, expectedEntryCount: input.session.entryCount, previous: prior?.content ?? '', policy,
    boundary: { sourceThroughSequence, retiredThroughSequence, ...(narrative ? { narrative } : {}) }, memory }
}

export function summaryInstruction(plan: SummaryPlan): string {
  const { sourceThroughSequence: source, retiredThroughSequence: retired } = plan.boundary
  return `这是宿主安排的 Session 工作交接任务，不是新的剧情输入。不要继续写剧情。\n`
    + `依据完整源上下文（Session 记录截至 ${source}）更新当前任务状态、必要发现和接续位置。`
    + (retired < source ? `历史过程仅压缩至记录 ${retired}，后续完整工作段保留；当前状态仍以 ${source} 为准。\n` : '本次不设历史缓冲，概括已有工作过程。\n')
    + `Session 摘要最多 ${plan.policy.maxTokens} Token，提交完整 Markdown 或针对旧摘要的单文件 unified diff。\n旧摘要：\n${plan.previous || '（无）'}\n`
    + (plan.memory ? `共享暗线、大纲和其他 Session 需要知道的安排必须更新到 MEMORY.md；它与 Session 私有接续信息分开。可保留未变化内容。\n当前 MEMORY.md：\n${plan.memory.text}\n` : '这是独立 Session，没有共享 MEMORY.md。\n')
    + '只调用 submit_session_summary 提交两项结果；工具参数不接受楼层、来源或压缩边界。'
}

function editText(value: unknown, before: string): string {
  if (!isRecord(value) || !['replace', 'patch'].includes(String(value.mode)) || typeof value.text !== 'string')
    throw new Error('Summary edit requires mode and text')
  if (value.mode === 'replace') return value.text
  const patches = parsePatch(value.text)
  if (patches.length !== 1) throw new Error('Summary patch must target one document')
  const result = applyPatch(before, patches[0]!, { fuzzFactor: 0 })
  if (result === false) throw new Error('Summary patch does not match its source')
  return result
}
const editSchema = { type: 'object', properties: { mode: { type: 'string', enum: ['replace', 'patch'] }, text: { type: 'string' } }, required: ['mode', 'text'], additionalProperties: false }

function markHistoryBoundary(plan: SummaryPlan, messages: ChatMessage[], entries: AgentTranscriptEntry[]): ChatMessage[] {
  const sequences = new Map(entries.map(entry => [`runtime.session:${entry.id}`, entry.sequence]))
  let region: 'retired' | 'retained' | undefined
  const marked: ChatMessage[] = []
  for (const message of messages) {
    const positions = ((message as ChatMessage & { fragmentIds?: string[] }).fragmentIds ?? [])
      .flatMap(id => sequences.has(id) ? [sequences.get(id)!] : [])
    if (positions.length) {
      const regions = new Set(positions.map(sequence => sequence <= plan.boundary.retiredThroughSequence ? 'retired' : 'retained'))
      if (regions.size !== 1) throw new Error('Prompt merges work across the summary boundary')
      const next = regions.values().next().value!
      if (region !== next) {
        marked.push({ role: 'user', content: next === 'retired'
          ? '[宿主交接范围：以下工作历史需要压缩进 Session 摘要。]'
          : '[宿主交接范围：以下近期工作历史将完整保留。请据此更新当前状态，不必重复总结这些工作过程。]' })
        region = next
      }
    }
    marked.push(message)
  }
  if (!region) throw new Error('Session history is not mounted in the summary Prompt')
  return marked
}

/** A transient task per Session; a restart discards preparation, never adopted history. */
export function createSessionSummaryCoordinator(ctx: Context) {
  const pending = new Map<string, Pending>()
  const status = (sessionId: string): SessionSummaryStatus => ({ ...(pending.get(sessionId)?.status ?? { state: 'idle' }) })
  async function record(task: Pending, state: 'preparing' | 'submitted' | 'failed', content: string, request?: RuntimeRequestContext, toolArguments?: string) {
    await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.sessionSummaryAudit'), async tx => {
      const store = requireAgents(ctx).transaction(tx)
      const session = store.getSession(task.plan.sessionId)
      // Session deletion owns removal; do not recreate a deleted Session through audit writes.
      if (!session || session.deletedAt) return
      if (toolArguments !== undefined) task.toolArguments = toolArguments
      store.writeSummaryTask({ agentSessionId: session.id, taskId: task.status.taskId!, state, content,
        sourceThroughSequence: task.plan.boundary.sourceThroughSequence, toolArguments: task.toolArguments })
    })
  }
  async function start(plan: SummaryPlan, source: { messages: ChatMessage[]; model: ProviderModelSelection; entries: AgentTranscriptEntry[]; entryCount: number }, request?: RuntimeRequestContext) {
    const existing = pending.get(plan.sessionId)
    if (existing && ['preparing', 'ready'].includes(existing.status.state)) return existing.promise
    const task: Pending = { controller: new AbortController(), plan, status: { taskId: ctx.createId('session-summary'), state: 'preparing', sourceThroughSequence: plan.boundary.sourceThroughSequence,
      retiredThroughSequence: plan.boundary.retiredThroughSequence } }
    pending.set(plan.sessionId, task)
    const signal = request?.abortSignal ? AbortSignal.any([request.abortSignal, task.controller.signal]) : task.controller.signal
    task.promise = (async () => {
      try {
        if (source.entryCount !== plan.expectedEntryCount
          || Math.max(...source.entries.map(entry => entry.sequence)) !== plan.boundary.sourceThroughSequence) throw new Error('Session changed while preparing its summary snapshot')
        await record(task, 'preparing', '正在整理此 Session 的工作交接。', request)
        const messages = markHistoryBoundary(plan, source.messages, source.entries)
        const profile = await ctx.documents.get(source.model.providerProfileId)
        const providerId = isRecord(profile?.content) ? profile.content.providerExtensionId : undefined
        if (typeof providerId !== 'string') throw new Error('Summary provider profile is unavailable')
        const native = ctx.providerAdapters.getCapability(providerId).nativeFunctionTools
        const schema = { type: 'object', properties: { summary: editSchema, ...(plan.memory ? { memory: editSchema } : {}) },
          required: plan.memory ? ['summary', 'memory'] : ['summary'], additionalProperties: false }
        const result = await ctx.gateway.invokeChat({ model: source.model, sessionId: plan.sessionId,
          runId: task.status.taskId!, branchId: plan.boundary.narrative?.branchId ?? 'agent-only',
          abortSignal: signal, context: { ...request, abortSignal: signal }, delivery: 'complete', request: {
            messages: native ? messages : [...messages, { role: 'user', content:
              `使用 Content 工具提交：<loom_tool name="submit_session_summary"><metadata>{}</metadata><content>JSON参数</content></loom_tool>。参数 Schema：${JSON.stringify(schema)}` }],
            ...(native ? { tools: [{ name: 'submit_session_summary', description: '提交本次交接摘要及共享 MEMORY 草稿；宿主校验后采用。', inputSchema: schema }],
              toolChoice: { type: 'tool' as const, toolName: 'submit_session_summary' } } : {}),
            metadata: { purpose: 'session-summary', agentSessionId: plan.sessionId },
          } })
        signal.throwIfAborted()
        if (result.finishReason === 'length' || result.finishReason === 'error') throw new Error('Summary task did not complete')
        let args: unknown
        if (native) {
          const calls = result.message.tool_calls ?? []
          if (calls.length !== 1 || calls[0]!.function.name !== 'submit_session_summary') throw new Error('Summary task did not submit a complete result')
          args = JSON.parse(calls[0]!.function.arguments)
        } else {
          const calls = scanContentTools(result.message.content ?? '', ['submit_session_summary']).invocations
          if (calls.length !== 1) throw new Error('Summary task did not submit a complete result')
          args = JSON.parse(calls[0]!.content)
        }
        await record(task, 'submitted', '模型已调用 submit_session_summary；等待校验和采用。', request, JSON.stringify(args))
        if (!isRecord(args) || Object.keys(args).some(key => key !== 'summary' && !(plan.memory && key === 'memory')))
          throw new Error('Invalid summary submission')
        const summary = editText(args.summary, plan.previous)
        if (!summary.trim() || countText(summary).estimatedTokens > plan.policy.maxTokens) throw new Error('Session summary is empty or exceeds its Token limit')
        const memory = plan.memory ? editText(args.memory, plan.memory.text) : undefined
        task.result = { summary, memory }
        task.status.state = 'ready'
      } catch (error) {
        task.status = { ...task.status, state: 'failed', error: error instanceof Error ? error.message : String(error) }
        await record(task, 'failed', task.status.error!)
      }
    })()
    return task.promise
  }
  async function adopt(sessionId: string, request?: RuntimeRequestContext) {
    const task = pending.get(sessionId)
    if (!task || task.status.state !== 'ready' || !task.result) return status(sessionId)
    const { plan, result } = task
    try {
      request?.abortSignal?.throwIfAborted()
      const agents = requireAgents(ctx)
      const committed = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.adoptSessionSummary'), async tx => {
        task.controller.signal.throwIfAborted()
        const store = agents.transaction(tx)
        const latest = store.getLatestWorkSummary(sessionId)
        if (latest && latest.sequence > plan.boundary.sourceThroughSequence) throw new Error('Session summary changed during preparation')
        const session = store.getSession(sessionId)
        if (!session || session.deletedAt) throw new Error('Summary Session is unavailable')
        const boundary = structuredClone(plan.boundary)
        const source = boundary.narrative
        if (source) {
          const narratives = ctx.narratives!.transaction(tx)
          const branch = narratives.getBranch(source.branchId)
          const timeline = narratives.getTimeline(source.timelineId)
          if (!branch || !timeline || timeline.activeBranchId !== branch.id || session.timelineId !== source.timelineId)
            throw new Error('Summary Timeline source changed')
          let origin = branch.headNodeId ? narratives.getNode(branch.headNodeId) : null
          if (source.nodeId === null) while (origin?.parentNodeId) origin = narratives.getNode(origin.parentNodeId)
          const point = source.nodeId ? narratives.getRecoveryPoint(branch.id, source.nodeId) : {
            stateRevisionId: origin?.stateRevisionId ?? branch.stateHeadRevisionId,
            workspaceRevisionId: origin?.workspaceRevisionId ?? branch.workspaceHeadRevisionId,
          }
          if (point.stateRevisionId !== source.stateRevisionId || point.workspaceRevisionId !== source.workspaceRevisionId)
            throw new Error('Summary source was restored or edited')
          const workspaces = ctx.workspaces.transaction(tx)
          const workspace = workspaces.get(branch.workspaceHeadRevisionId)!
          const file = workspace.entries.find(entry => entry.id === plan.memory!.id)
          if (!file || file.kind !== 'file' || file.parentId || file.name !== 'MEMORY.md'
            || !('text' in file.content) || file.content.text !== plan.memory!.text) throw new Error('Shared MEMORY.md changed during summary preparation')
          if (result.memory !== plan.memory!.text) {
            const entries = structuredClone(workspace.entries)
            const updated = entries.find(entry => entry.id === file.id)!
            if (updated.kind === 'file') updated.content = { text: result.memory! }
            const revision = workspaces.create({ timelineId: source.timelineId, parentRevisionId: workspace.id, entries })
            boundary.adoptedWorkspaceRevisionId = revision.id
            if (source.nodeId === (branch.headNodeId ?? null)) source.workspaceRevisionId = revision.id
            narratives.setBranchWorkspaceHead({ timelineId: source.timelineId, branchId: branch.id, expectedRevisionId: workspace.id, revisionId: revision.id })
          }
        } else if (session.timelineId) throw new Error('Summary Session binding changed')
        store.writeSummaryTask({ agentSessionId: sessionId, taskId: task.status.taskId!, state: 'adopted',
          content: '交接摘要已采用；后续工作将使用新摘要和保留的上下文。',
          sourceThroughSequence: plan.boundary.sourceThroughSequence, toolArguments: task.toolArguments })
        return store.appendEntries({ agentSessionId: sessionId, expectedEntryCount: session.entryCount,
          entries: [{ entry: { kind: 'work-summary', content: result.summary, boundary } }] })
      })
      task.status = { ...task.status, state: 'adopted', summaryEntryId: committed.value.entries[0]!.id }
      // Optional plot-memory consumer failure does not invalidate the committed handoff.
      if (plan.boundary.narrative) {
        const source = plan.boundary.narrative
        try { await ctx.narrativeContext.notifySessionHandoff({ ...source,
          cardId: (await ctx.narratives!.getTimeline(source.timelineId))?.createdFrom?.cardId, agentSessionId: sessionId,
          summaryEntryId: committed.value.entries[0]!.id, rawHeadNodeId: source.nodeId }) }
        catch (error) { task.status.error = `Memory notification failed: ${String(error)}` }
      }
    } catch (error) {
      task.status = { ...task.status, state: 'failed', error: error instanceof Error ? error.message : String(error) }
      await record(task, 'failed', task.status.error!)
    }
    return status(sessionId)
  }
  return { status, start, adopt, forget: (sessionId: string) => {
    pending.get(sessionId)?.controller.abort('Session deleted')
    pending.delete(sessionId)
  }, cancel: async (sessionId: string) => {
    const task = pending.get(sessionId)
    if (task && ['preparing', 'ready'].includes(task.status.state)) {
      task.controller.abort('Session summary cancelled')
      task.status = { ...task.status, state: 'failed', error: 'Session summary cancelled' }
      await record(task, 'failed', task.status.error!)
    }
    return status(sessionId)
  } }
}
