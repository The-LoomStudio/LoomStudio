import { createHash } from 'node:crypto'
import { createId } from '@loom-studio/shared'
import type { ApplicationRuntime, AgentRunEvent, AgentRunTask, RuntimeRequestContext, InvokeAgentTurnInput, VfsMutationDecision } from '@loom-studio/application-runtime'

type AgentRun = {
  id: string
  createdAt: string
  updatedAt: string
  reason?: string
  controller?: AbortController
  events: AgentRunEvent[]
  eventSizes: number[]
  eventBytes: number
  firstCursor: number
  nextCursor: number
  partialEvents: Extract<AgentRunEvent, { type: 'text-delta' | 'reasoning-delta' | 'tool-input-delta' }>[]
  sessionId: string
  pendingCompletion?: Extract<AgentRunEvent, { type: 'completed' }>
  replayTimer?: ReturnType<typeof setTimeout>
  state: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled'
  promise?: Promise<unknown>
  sendRequestDigest?: string
  request?: InvokeAgentTurnInput
  sourceRunId?: string
  continuationRunId?: string
  abandoned?: boolean
  receivedInterjections?: boolean
  checkpoint?: NonNullable<RuntimeRequestContext['agentRun']>['continuation']
  mutationApprovals: Map<string, {
    kind: 'mutation' | 'history-read'
    event: Extract<AgentRunEvent, { type: 'mutation-approval-requested' | 'history-read-approval-requested' }>
    resolve: (decision: VfsMutationDecision) => void
    reject: (error: Error) => void
  }>
}

type AgentRunSubscription = {
  reason?: string
  events: AgentRunEvent[]
  nextCursor: number
  done: boolean
  state: AgentRun['state']
  replayExpired?: boolean
  partialEvents?: AgentRun['partialEvents']
  pendingApprovals?: Extract<AgentRunEvent, { type: 'mutation-approval-requested' | 'history-read-approval-requested' }>[]
}

const receiptLocks = new WeakMap<ApplicationRuntime, Map<string, Promise<unknown>>>()
const runStores = new WeakMap<ApplicationRuntime, Map<string, AgentRun>>()
const maxRetainedRuns = 128
// ponytail: Serialized budgets bound replay payload, not total JS heap; tune with production workloads.
const maximumRunEventBytes = 1024 * 1024
const maximumReplayBytes = 8 * 1024 * 1024
const completedReplayMs = 2 * 60_000

// Run ownership stays in the server; the RPC adapter only translates requests.
export function getAgentRunService(runtime: ApplicationRuntime) {
  return {
    async list(input?: { timelineId?: string }): Promise<{ tasks: AgentRunTask[] }> {
      const summaries = await runtime.listAgentRunStates()
      const runs = getRunStore(runtime)
      const latestLive = new Map<string, { run: AgentRun; failedContinuation?: AgentRun }>()
      for (const run of runs.values()) {
        if (run.continuationRunId) continue
        const source = run.sourceRunId ? runs.get(run.sourceRunId) : undefined
        const retainedSource = run.state === 'failed' && source?.state === 'suspended'
          && !source.continuationRunId && (source.abandoned || source.checkpoint && source.request)
        latestLive.set(run.sessionId, retainedSource ? { run: source, failedContinuation: run } : { run })
      }
      const tasks: AgentRunTask[] = []
      for (const summary of summaries) {
        if (input?.timelineId !== undefined && summary.timelineId !== input.timelineId) continue
        const saved = summary.run
        const entry = latestLive.get(summary.agentSessionId)
        const live = entry?.run
        const retainedColdCheckpoint = live?.state === 'failed' && saved && live.checkpoint?.sourceRunId === saved.runId
        const current = live && !retainedColdCheckpoint && (!saved || live.id === saved.runId || entry?.failedContinuation?.id === saved.runId
          || live.createdAt >= saved.updatedAt) ? live : undefined
        if (!current && !saved) continue
        const state: AgentRunTask['state'] = current
          ? current.abandoned || (saved?.runId === current.id && saved.state === 'discarded') ? 'discarded' : current.state
          : saved!.state === 'running' || saved!.state === 'created' ? 'interrupted'
            : saved!.state === 'aborted' ? 'cancelled' : saved!.state
        const canResume = current
          ? !current.abandoned && !current.continuationRunId && state !== 'discarded'
            && Boolean(current.checkpoint && current.request)
          : state === 'suspended' || state === 'interrupted'
        const reason = current ? entry?.failedContinuation?.reason ?? current.reason
          ?? (saved?.runId === current.id ? saved.reason : undefined) : saved?.reason
        tasks.push({
          runId: current?.id ?? saved!.runId, agentSessionId: summary.agentSessionId,
          ...(summary.title === undefined ? {} : { title: summary.title }),
          ...(summary.timelineId === undefined ? {} : { timelineId: summary.timelineId }),
          state, updatedAt: current ? entry?.failedContinuation?.updatedAt ?? current.updatedAt : saved!.updatedAt,
          ...(reason === undefined ? {} : { reason }),
          canPause: Boolean(current?.controller && state === 'running'),
          canResume: state !== 'running' && state !== 'completed' && state !== 'cancelled' && canResume,
          canAbandon: current ? state === 'suspended' && !current.continuationRunId
            : state === 'suspended' || state === 'interrupted',
        })
      }
      tasks.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runId.localeCompare(right.runId))
      let ended = 0
      return { tasks: tasks.filter(task => {
        if (task.state === 'running' || task.state === 'suspended' || task.state === 'interrupted') return true
        ended += 1
        return ended <= 30
      }) }
    },
    async create(request: InvokeAgentTurnInput, context?: RuntimeRequestContext) {
      return withReceiptLock(runtime, request.agentSessionId, async () => {
      const runs = getRunStore(runtime)
      let runId: string | undefined
      if (request.requestId !== undefined) {
        if (!/^[a-zA-Z0-9-]{1,128}$/.test(request.requestId)) throw new Error('Invalid Agent send request ID')
        runId = request.requestId
        const digest = sendRequestDigest(request)
        const existing = runs.get(runId)
        if (existing) {
          if (existing.sendRequestDigest !== digest) throw new Error('Agent send request ID was reused with different input')
          return { runId }
        }
        // A lost acknowledgement may outlive the server process. The first durable
        // checkpoint records this request before tools or Provider calls can begin.
        const checkpoint = await runtime.findAgentRunCheckpoint({ agentSessionId: request.agentSessionId, runId })
        const saved = checkpoint?.entry
        if (saved?.kind === 'run-state' && saved.recovery) {
          const savedDigest = saved.recovery.sendRequestDigest ?? sendRequestDigest(saved.recovery.request)
          if (savedDigest !== digest) throw new Error('Agent send request ID was reused with different input')
          return { runId }
        }
        // Another create for this request may have completed while reading history.
        const concurrent = runs.get(runId)
        if (concurrent) {
          if (concurrent.sendRequestDigest !== digest) throw new Error('Agent send request ID was reused with different input')
          return { runId }
        }
      }
      const run = startAgentRun(runtime, context, request)
      runs.set(run.id, run)
      pruneCompletedRuns(runs)
      void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
      return { runId: run.id }
      })
    },
    async reviseInput(input: Parameters<ApplicationRuntime['reviseAgentInput']>[0], context?: RuntimeRequestContext) {
      return withReceiptLock(runtime, input.agentSessionId, async () => {
        const runs = getRunStore(runtime)
        const active = [...runs.values()].find(run => run.sessionId === input.agentSessionId && run.state === 'running')
        const entries = await readSessionEntries(runtime, input.agentSessionId)
        const target = entries.find(item => item.id === input.entryId)
        if (active && (target?.entry.kind !== 'user-interjection' || target.entry.requestId === active.request?.interjectionRequestId)) throw new Error('这条输入正在执行，请等待结束或暂停后再提交')
        const result = await runtime.reviseAgentInput(input, context)
        if (target?.entry.kind === 'message') for (const run of runs.values()) {
          if (run.sessionId === input.agentSessionId && run.state === 'suspended') {
            run.checkpoint = undefined; run.request = undefined; run.abandoned = true; run.state = 'cancelled'; clearRunReplay(run)
          }
        }
        if (active) appendRunEvent(active, { type: 'transcript-appended', runId: active.id, entries: [result.entry] })
        if (!result.rerun) return result
        const run = startAgentRun(runtime, context, interjectionRequest(input.agentSessionId, result.entry))
        runs.set(run.id, run)
        void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
        return { ...result, runId: run.id }
      })
    },
    async interject(input: Parameters<ApplicationRuntime['submitAgentInterjection']>[0], context?: RuntimeRequestContext) {
      return withReceiptLock(runtime, input.agentSessionId, async () => {
        const receipt = await runtime.submitAgentInterjection(input, context)
        const runs = getRunStore(runtime)
        const active = [...runs.values()].find(run => run.sessionId === input.agentSessionId && run.state === 'running')
        if (active) {
          active.receivedInterjections = true
          appendRunEvent(active, { type: 'transcript-appended', runId: active.id, entries: [receipt.entry] })
          return { ...receipt, runId: active.id }
        }
        if (!receipt.pending) return receipt
        const entries = await readSessionEntries(runtime, input.agentSessionId)
        const lastState = entries.findLast(item => item.entry.kind === 'run-state')?.entry
        if (lastState?.kind === 'run-state' && ['suspended', 'failed', 'aborted'].includes(lastState.state)) return receipt
        const run = startAgentRun(runtime, context, interjectionRequest(input.agentSessionId, receipt.entry))
        runs.set(run.id, run)
        void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
        return { ...receipt, runId: run.id }
      })
    },
    async subscribe(runId: string, cursor = 0, sessionId?: string): Promise<AgentRunSubscription> {
      const runs = getRunStore(runtime)
      const run = runs.get(runId)
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Agent run cursor must be a non-negative integer')
      if (!run) {
        if (!sessionId) throw new Error(`Agent run not found: ${runId}`)
        let pageCursor: string | undefined
        do {
          const page = await runtime.getAgentTranscriptPage({ agentSessionId: sessionId, limit: 100, cursor: pageCursor })
          const state = [...page.entries].reverse().find(entry => entry.runId === runId && entry.entry.kind === 'run-state')?.entry
          if (state?.kind === 'run-state') {
            if (state.state === 'running' || state.state === 'created') {
              const inspected = await runtime.inspectAgentRunState({ agentSessionId: sessionId, runId })
              if (inspected.state === 'running') throw new Error('Agent Run is executing in another process; reconnect to its owner')
              return { events: [], nextCursor: cursor, done: true, state: inspected.state, ...(inspected.reason ? { reason: inspected.reason } : {}), replayExpired: true, partialEvents: [], pendingApprovals: [] }
            }
            const terminal = state.state === 'completed' ? 'completed' : state.state === 'suspended' ? 'suspended'
              : state.state === 'aborted' || state.state === 'discarded' ? 'cancelled' : 'failed'
            return { events: [], nextCursor: cursor, done: true, state: terminal, ...(state.reason ? { reason: state.reason } : {}), replayExpired: true, partialEvents: [], pendingApprovals: [] }
          }
          pageCursor = page.nextCursor
        } while (pageCursor)
        throw new Error(`Agent run not found in Session: ${runId}`)
      }
      const replayExpired = cursor < run.firstCursor
      const events = replayExpired ? [] : run.events.slice(cursor - run.firstCursor)
      if (run.pendingCompletion && !events.some(event => event.type === 'completed')) {
        events.push(run.pendingCompletion)
      }
      return {
        events,
        nextCursor: run.nextCursor,
        done: run.state !== 'running',
        state: run.state,
        ...(run.reason ? { reason: run.reason } : {}),
        pendingApprovals: [...run.mutationApprovals.values()].map(pending => pending.event),
        ...(replayExpired ? {
          replayExpired: true,
          partialEvents: run.partialEvents.map(event => ({ ...event })),
        } : {}),
      }
    },
    acknowledgeCompletion(runId: string) {
      const runs = getRunStore(runtime)
      const run = runs.get(runId)
      const accepted = Boolean(run?.pendingCompletion)
      if (run) run.pendingCompletion = undefined
      pruneCompletedRuns(runs)
      return { runId, accepted }
    },
    cancel(runId: string, reason = 'cancelled') {
      const run = requireAgentRun(getRunStore(runtime), runId)
      if (run.state !== 'running') return { runId: run.id, accepted: false, state: run.state }
      run.controller!.abort(reason)
      return { runId: run.id, accepted: true, state: run.state }
    },
    approve(runId: string, requestId: string, kind: 'history-read' | 'mutation', allow: boolean, reason?: string) {
      const run = requireAgentRun(getRunStore(runtime), runId)
      const pending = run.mutationApprovals.get(requestId)
      if (!pending) return { runId: run.id, requestId, accepted: false }
      if (pending.kind !== kind)
        return { runId: run.id, requestId, accepted: false }
      run.mutationApprovals.delete(requestId)
      pending.resolve(allow
        ? { decision: 'allow' }
        : { decision: 'deny', ...(reason ? { reason } : {}) })
      return { runId: run.id, requestId, accepted: true }
    },
    async abandon(runId: string, context?: RuntimeRequestContext, agentSessionId?: string) {
      const run = getRunStore(runtime).get(runId)
      return withReceiptLock(runtime, run?.sessionId ?? agentSessionId ?? '', async () => {
      if (!run) {
        if (!agentSessionId) throw new Error(`Agent run not found: ${runId}`)
        const state = await runtime.inspectAgentRunState({ agentSessionId, runId })
        if (state.state !== 'suspended') return { runId, accepted: false, state: state.state }
        const pending = readPendingInterjections(await readSessionEntries(runtime, agentSessionId))
        await runtime.appendAgentTranscriptEntries({
          agentSessionId,
          expectedEntryCount: state.entryCount,
          entries: [{ runId, entry: { kind: 'run-state', state: 'discarded' } }, ...pending.map(item => ({ entry: { kind: 'interjection-discarded' as const, requestId: item.entry.kind === 'user-interjection' ? item.entry.requestId : '' } }))],
        }, context)
        return { runId, accepted: true, state: 'suspended' as const }
      }
      if (run.state === 'running') throw new Error('Cannot change the main receiver while an Agent run is generating')
      if (run.state !== 'suspended' || run.abandoned || run.continuationRunId) {
        return { runId: run.id, accepted: false, state: run.state }
      }
      const pending = readPendingInterjections(await readSessionEntries(runtime, run.sessionId))
      const transcript = await runtime.getAgentTranscriptPage({ agentSessionId: run.sessionId, limit: 100 })
      await runtime.appendAgentTranscriptEntries({
        agentSessionId: run.sessionId,
        expectedEntryCount: transcript.session.entryCount,
        entries: [{ runId: run.id, entry: { kind: 'run-state', state: 'discarded' } }, ...pending.map(item => ({ entry: { kind: 'interjection-discarded' as const, requestId: item.entry.kind === 'user-interjection' ? item.entry.requestId : '' } }))],
      }, context)
      run.checkpoint = undefined
      run.abandoned = true
      run.request = undefined
      clearRunReplay(run)
      return { runId: run.id, accepted: true, state: run.state }
      })
    },
    async resume(input: { runId?: string; agentSessionId?: string }, context?: RuntimeRequestContext): Promise<{ runId: string; accepted: boolean; state?: AgentRun['state']; sourceRunId?: string }> {
      return withReceiptLock(runtime, input.agentSessionId ?? (input.runId ? getRunStore(runtime).get(input.runId)?.sessionId : undefined) ?? '', async () => {
      const runs = getRunStore(runtime)
      let source: AgentRun | undefined
      if (input.runId !== undefined) {
        source = runs.get(input.runId)
      }
      if (source && !source.checkpoint && source.sourceRunId && source.state !== 'running' && source.state !== 'completed') {
        const original = runs.get(source.sourceRunId)
        if (original?.checkpoint) source = original
      }
      if (source) {
        if (source.state === 'running') return { runId: source.id, accepted: false, state: source.state }
        if (source.abandoned) return { runId: source.id, accepted: false, state: source.state }
        if (source.continuationRunId) return { runId: source.continuationRunId, sourceRunId: source.id, accepted: true }
        if (source.checkpoint && source.request) {
          const run = startAgentRun(runtime, context, source.request, source.id, source.checkpoint, source)
          runs.set(run.id, run)
          pruneCompletedRuns(runs)
          void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
          source.continuationRunId = run.id
          return { runId: run.id, sourceRunId: source.id, accepted: true, state: run.state }
        }
      }

      const sessionId = input.agentSessionId !== undefined
        ? input.agentSessionId
        : source?.sessionId
      if (sessionId) {
        const recovered = await runtime.prepareAgentRunRecovery({
          agentSessionId: sessionId,
          ...(input.runId !== undefined ? { runId: input.runId } : {}),
        })
        if (recovered) {
          const run = startAgentRun(runtime, context, recovered.request, recovered.continuation.sourceRunId, recovered.continuation)
          runs.set(run.id, run)
          pruneCompletedRuns(runs)
          void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
          return { runId: run.id, sourceRunId: recovered.continuation.sourceRunId, accepted: true, state: run.state }
        }
      }

      if (sessionId) {
        const pending = readPendingInterjections(await readSessionEntries(runtime, sessionId))
        if (pending.length) {
          const run = startAgentRun(runtime, context, interjectionRequest(sessionId, pending[0]!))
          runs.set(run.id, run)
          void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
          return { runId: run.id, accepted: true, state: run.state }
        }
      }
      return { runId: input.runId ?? '', accepted: false }
      })
    },
    state(runId: string, agentSessionId?: string) {
      const run = getRunStore(runtime).get(runId)
      if (run) return { runId: run.id, state: run.state, ...(run.reason ? { reason: run.reason } : {}) }
      if (!agentSessionId) throw new Error(`Agent run not found: ${runId}`)
      return runtime.inspectAgentRunState({ agentSessionId, runId }).then(({ state, reason }) => ({ runId, state, ...(reason ? { reason } : {}) }))
    },
  }
}

function startAgentRun(
  runtime: ApplicationRuntime,
  context: RuntimeRequestContext | undefined,
  request: InvokeAgentTurnInput,
  sourceRunId?: string,
  continuation?: AgentRun['checkpoint'],
  source?: AgentRun,
): AgentRun {
  if ([...getRunStore(runtime).values()].some(run => run.state === 'running' && run.sessionId === request.agentSessionId))
    throw Object.assign(new Error('Agent Session already has an executing Run'), { code: 'agent.session_busy' })
  const id = !continuation && !sourceRunId && request.requestId ? request.requestId : createId('run', id => getRunStore(runtime).has(id))
  const controller = new AbortController()
  const timestamp = new Date().toISOString()
  const run: AgentRun = {
    id, createdAt: timestamp, updatedAt: timestamp, controller, request, sourceRunId, sessionId: request.agentSessionId,
    receivedInterjections: Boolean(request.interjectionRequestId),
    ...(continuation ? { checkpoint: continuation } : {}),
    events: [], eventSizes: [], eventBytes: 0, firstCursor: 0, nextCursor: 0, partialEvents: [], state: 'running', promise: Promise.resolve(), mutationApprovals: new Map(),
    ...(request.requestId ? { sendRequestDigest: continuation?.recovery?.sendRequestDigest ?? source?.sendRequestDigest ?? sendRequestDigest(request) } : {}),
  }
  const transferCheckpoint = () => {
    run.checkpoint = undefined
    if (!source) return
    source.checkpoint = undefined
    source.request = undefined
  }
  const emit = (event: AgentRunEvent) => {
    run.updatedAt = new Date().toISOString()
    if (event.type === 'failed') run.reason = event.error.message
    if (event.type === 'suspended' || event.type === 'cancelled') run.reason = event.reason
    if (event.type === 'text-delta' || event.type === 'reasoning-delta' || event.type === 'tool-input-delta') {
      const existing = run.partialEvents.find(item => item.type === event.type && item.streamId === event.streamId)
      if (existing) {
        existing.delta += event.delta
        if (existing.type === 'tool-input-delta' && event.type === 'tool-input-delta' && event.toolName !== undefined) existing.toolName = event.toolName
      } else run.partialEvents.push({ ...event })
    }
    if (event.type === 'transcript-appended') {
      const committed = new Set(event.entries.flatMap(item => item.entry.streamId ? [item.entry.streamId] : []))
      run.partialEvents = run.partialEvents.filter(item => !committed.has(item.streamId!))
    }
    if (event.type === 'transcript-appended' && event.entries.some(entry =>
      entry.entry.kind === 'run-state' && entry.entry.state === 'running',
    )) transferCheckpoint()
    appendRunEvent(run, event)
    pruneCompletedRuns(getRunStore(runtime))
  }
  emit({ type: 'started', runId: id })
  const invoke = (nextRequest: InvokeAgentTurnInput) => runtime.invokeAgentTurn(nextRequest, {
    ...context,
    abortSignal: controller.signal,
    agentRun: {
      runId: id,
      ...(run.sendRequestDigest ? { sendRequestDigest: run.sendRequestDigest } : {}),
      onEvent: emit,
      ...(continuation && nextRequest === request ? { continuation } : {}),
      onSuspended: checkpoint => {
        transferCheckpoint()
        run.checkpoint = checkpoint
        run.request = checkpoint.recovery?.request ?? run.request
      },
      onHistoryReadApproval: (action, signal) => new Promise((resolve, reject) => {
        const approvalSignal = signal ?? controller.signal
        approvalSignal.throwIfAborted()
        const requestId = createId('history-read-approval', id => run.mutationApprovals.has(id))
        const event: AgentRunEvent = { type: 'history-read-approval-requested', runId: id, requestId, action }
        const abort = () => {
          run.mutationApprovals.delete(requestId)
          reject(new Error('History read approval was cancelled.'))
        }
        approvalSignal.addEventListener('abort', abort, { once: true })
        run.mutationApprovals.set(requestId, {
          kind: 'history-read', event,
          resolve: decision => {
            approvalSignal.removeEventListener('abort', abort)
            resolve(decision)
          },
          reject: error => {
            approvalSignal.removeEventListener('abort', abort)
            reject(error)
          },
        })
        emit(event)
      }),
      onMutationApproval: (preview, signal) => new Promise((resolve, reject) => {
        signal.throwIfAborted()
        const requestId = createId('mutation-approval', id => run.mutationApprovals.has(id))
        const event: AgentRunEvent = { type: 'mutation-approval-requested', runId: id, requestId, preview }
        const abort = () => {
          run.mutationApprovals.delete(requestId)
          reject(new Error('Mutation approval was cancelled.'))
        }
        signal.addEventListener('abort', abort, { once: true })
        run.mutationApprovals.set(requestId, {
          kind: 'mutation', event,
          resolve: decision => {
            signal.removeEventListener('abort', abort)
            resolve(decision)
          },
          reject: error => {
            signal.removeEventListener('abort', abort)
            reject(error)
          },
        })
        emit(event)
      }),
    },
  })
  run.promise = (async () => {
    let result = await invoke(request)
    for (;;) {
      const next = await withReceiptLock(runtime, run.sessionId, async () => {
        controller.signal.throwIfAborted()
        const entries = run.receivedInterjections ? await readSessionEntries(runtime, run.sessionId) : []
        const pending = readPendingInterjections(entries)
        if (pending.length) return interjectionRequest(run.sessionId, pending[0]!)
        // Receipt and terminal publication share this boundary. Later receipts see idle.
        run.state = 'completed'
        transferCheckpoint()
        run.pendingCompletion = { type: 'completed', runId: id, result }
        emit(run.pendingCompletion)
        return undefined
      })
      if (!next) return
      run.request = next
      result = await invoke(next)
    }
  })().catch(error => {
    for (const pending of run.mutationApprovals.values()) pending.reject(new Error('Agent run ended before mutation approval.'))
    run.mutationApprovals.clear()
    const ownerDeleted = error instanceof Error && 'code' in error && error.code === 'agent.session_deleted'
    if (ownerDeleted) {
      transferCheckpoint()
      run.abandoned = true
      if (source) source.abandoned = true
    }
    const suspended = !ownerDeleted && (controller.signal.reason === 'user-pause' || Boolean(run.checkpoint && run.checkpoint !== continuation))
    const cancelled = ownerDeleted || controller.signal.aborted
    run.state = suspended ? 'suspended' : cancelled ? 'cancelled' : 'failed'
    if (source?.checkpoint && source.continuationRunId === run.id) source.continuationRunId = undefined
    const reason = controller.signal.reason === 'user-pause' ? 'user-pause' : error instanceof Error ? error.message : String(error)
    emit(suspended
      ? { type: 'suspended', runId: id, reason }
      : cancelled
        ? { type: 'cancelled', runId: id, reason }
        : { type: 'failed', runId: id, error: { name: error instanceof Error ? error.name : 'UnknownError', message: reason } })
  }).finally(() => {
    run.controller = undefined
    run.promise = undefined
    run.partialEvents = []
    const retainedColdCheckpoint = !source && continuation !== undefined && run.checkpoint === continuation
    if (run.state !== 'suspended' && !retainedColdCheckpoint || !run.checkpoint && source?.checkpoint) {
      run.request = undefined
      run.checkpoint = undefined
    }
    run.replayTimer = setTimeout(() => {
      clearRunReplay(run)
      run.pendingCompletion = undefined
      run.replayTimer = undefined
      pruneCompletedRuns(getRunStore(runtime))
    }, completedReplayMs)
    run.replayTimer.unref()
  })
  return run
}

function getRunStore(runtime: ApplicationRuntime): Map<string, AgentRun> {
  const existing = runStores.get(runtime)
  if (existing) return existing
  const created = new Map<string, AgentRun>()
  runStores.set(runtime, created)
  return created
}

function pruneCompletedRuns(runs: Map<string, AgentRun>): void {
  let totalBytes = [...runs.values()].reduce((sum, run) => sum + run.eventBytes, 0)
  for (const run of [...runs.values()].sort((a, b) => Number(a.state === 'running') - Number(b.state === 'running'))) {
    if (totalBytes <= maximumReplayBytes) break
    totalBytes -= run.eventBytes
    clearRunReplay(run)
  }
  if (runs.size <= maxRetainedRuns) return
  for (const [runId, run] of runs) {
    if (runs.size <= maxRetainedRuns) return
    if (run.pendingCompletion || run.state === 'running' || run.state === 'suspended' && !run.abandoned && (run.checkpoint || !run.continuationRunId && !run.sourceRunId)) continue
    clearTimeout(run.replayTimer)
    clearRunReplay(run)
    runs.delete(runId)
  }
}

function appendRunEvent(run: AgentRun, event: AgentRunEvent): void {
  const bytes = Buffer.byteLength(JSON.stringify(event))
  run.events.push(event)
  run.eventSizes.push(bytes)
  run.eventBytes += bytes
  run.nextCursor += 1
  while (run.eventBytes > maximumRunEventBytes && run.events.length) {
    run.eventBytes -= run.eventSizes.shift()!
    run.events.shift()
    run.firstCursor += 1
  }
}

function clearRunReplay(run: AgentRun): void {
  run.events = []
  run.eventSizes = []
  run.eventBytes = 0
  run.firstCursor = run.nextCursor
  if (run.state !== 'running') run.partialEvents = []
}

function requireAgentRun(runs: Map<string, AgentRun>, runId: string): AgentRun {
  const run = runs.get(runId)
  if (!run) throw new Error(`Agent run not found: ${runId}`)
  return run
}

function sendRequestDigest(request: unknown): string {
  const canonical = JSON.stringify(request, (_key, value: unknown) => {
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    return value
  })
  return createHash('sha256').update(canonical).digest('hex')
}

async function withReceiptLock<T>(runtime: ApplicationRuntime, sessionId: string, work: () => Promise<T>): Promise<T> {
  let sessions = receiptLocks.get(runtime)
  if (!sessions) { sessions = new Map(); receiptLocks.set(runtime, sessions) }
  const previous = sessions.get(sessionId) ?? Promise.resolve()
  const pending = previous.catch(() => undefined).then(work)
  sessions.set(sessionId, pending)
  try { return await pending }
  finally { if (sessions.get(sessionId) === pending) sessions.delete(sessionId) }
}

type TranscriptEntry = Awaited<ReturnType<ApplicationRuntime['getAgentTranscriptPage']>>['entries'][number]
async function readSessionEntries(runtime: ApplicationRuntime, agentSessionId: string): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = []
  let cursor: string | undefined
  do {
    const page = await runtime.getAgentTranscriptPage({ agentSessionId, cursor, limit: 100 })
    entries.push(...page.entries)
    cursor = page.nextCursor
  } while (cursor)
  return entries.sort((left, right) => left.sequence - right.sequence)
}
function readPendingInterjections(entries: TranscriptEntry[]) {
  const settled = new Set(entries.flatMap(item => item.entry.kind === 'interjection-applied' || item.entry.kind === 'interjection-discarded' ? [item.entry.requestId] : []))
  return entries.filter(item => item.entry.kind === 'user-interjection' && !item.entry.withdrawn && !settled.has(item.entry.requestId))
}
function interjectionRequest(agentSessionId: string, entry: TranscriptEntry): InvokeAgentTurnInput {
  if (entry.entry.kind !== 'user-interjection') throw new Error('Expected persisted user interjection')
  return { agentSessionId, input: entry.entry.content, attachments: entry.entry.attachments,
    interjectionRequestId: entry.entry.requestId, narrativeTarget: entry.entry.narrativeTarget,
    macroSelections: entry.entry.macroSelections, activationFacts: entry.entry.activationFacts }
}
