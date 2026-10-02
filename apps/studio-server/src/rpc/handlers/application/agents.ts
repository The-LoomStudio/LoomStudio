import type {
  ApplicationRuntime,
  AgentRunEvent,
  PresetToolMountInput,
  RuntimeRequestContext,
  ToolDefinition,
  InvokeAgentTurnInput,
  VfsMutationDecision,
} from '@loom-studio/application-runtime'
import { isPromptActivation } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readBoolean,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readNullableString,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

type AgentRun = {
  id: string
  controller?: AbortController
  events: AgentRunEvent[]
  eventSizes: number[]
  eventBytes: number
  firstCursor: number
  nextCursor: number
  partialText: string
  sessionId: string
  pendingCompletion?: Extract<AgentRunEvent, { type: 'completed' }>
  replayTimer?: ReturnType<typeof setTimeout>
  state: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled'
  promise?: Promise<unknown>
  request?: InvokeAgentTurnInput
  sourceRunId?: string
  continuationRunId?: string
  abandoned?: boolean
  checkpoint?: {
    sourceRunId: string
    messages: import('@loom-studio/shared').ChatMessage[]
    userEntry: import('@loom-studio/application-data').AgentTranscriptEntry
    partialEntryId?: string
  }
  mutationApprovals: Map<string, {
    kind: 'mutation' | 'history-read'
    event: AgentRunEvent
    resolve: (decision: VfsMutationDecision) => void
    reject: (error: Error) => void
  }>
}

const runStores = new WeakMap<ApplicationRuntime, Map<string, AgentRun>>()
const maxRetainedRuns = 128
// ponytail: Serialized budgets bound replay payload, not total JS heap; tune with production workloads.
const maximumRunEventBytes = 1024 * 1024
const maximumReplayBytes = 8 * 1024 * 1024
const completedReplayMs = 2 * 60_000

export async function handleAgentsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createAgentPreset':
      return await runtime.createAgentPreset({
        name: readString(params, 'name'),
        model: readOptionalProviderModelSelection(params, 'model'),
        delivery: readOptionalDelivery(params),
        historyPolicy: readOptionalHistoryPolicy(params),
      }, context) as unknown as JsonValue

    case 'application.getAgentPreset':
      return await runtime.getAgentPreset({ agentPresetId: readString(params, 'agentPresetId') }) as unknown as JsonValue

    case 'application.listAgentPresets':
      return await runtime.listAgentPresets({
        cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateAgentPreset':
      return await runtime.updateAgentPreset({
        agentPresetId: readString(params, 'agentPresetId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        name: readOptionalString(params, 'name'),
        model: isRecord(params) && params.model === null ? null : readOptionalProviderModelSelection(params, 'model'),
        delivery: readOptionalDelivery(params),
        historyPolicy: readOptionalHistoryPolicy(params),
        useCardSettings: readOptionalBoolean(params, 'useCardSettings'),
        textUses: readPresetTextUses(params),
      }, context) as unknown as JsonValue

    case 'application.deleteAgentPreset':
      return await runtime.deleteAgentPreset({ agentPresetId: readString(params, 'agentPresetId') }, context) as unknown as JsonValue

    case 'application.listAgentTools':
      return await runtime.listAgentTools() as unknown as JsonValue

    case 'application.updateAgentTool':
      return await runtime.updateAgentTool({
        toolId: readString(params, 'toolId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        definition: readAgentToolDefinition(params),
      }, context) as unknown as JsonValue

    case 'application.listPresetToolMounts':
      return await runtime.listPresetToolMounts({
        presetId: readOptionalString(params, 'presetId'),
        toolId: readOptionalString(params, 'toolId'),
      }) as unknown as JsonValue

    case 'application.replacePresetToolMounts':
      return await runtime.replacePresetToolMounts({
        presetId: readString(params, 'presetId'),
        mounts: readPresetToolMountInputs(params, 'mounts'),
      }, context) as unknown as JsonValue

    case 'application.createAgentSession':
      return await runtime.createAgentSession({
        agentPresetId: readString(params, 'agentPresetId'),
        timelineId: readOptionalString(params, 'timelineId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.listAgentSessions':
      return await runtime.listAgentSessions({
        agentPresetId: readOptionalString(params, 'agentPresetId'),
        timelineId: readOptionalString(params, 'timelineId'),
        standalone: readOptionalBoolean(params, 'standalone'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.getAgentSession':
      return await runtime.getAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }) as unknown as JsonValue

    case 'application.getAgentTranscriptPage':
      return await runtime.getAgentTranscriptPage({
        agentSessionId: readString(params, 'agentSessionId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.deleteAgentSession':
      return await runtime.deleteAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }, context) as unknown as JsonValue

    case 'application.completeAgentSessionHandoff':
      return await runtime.completeAgentSessionHandoff({
        agentSessionId: readString(params, 'agentSessionId'),
        expectedEntryCount: readNumber(params, 'expectedEntryCount'),
        summary: readString(params, 'summary'),
        branchId: readOptionalString(params, 'branchId'),
      }, context) as unknown as JsonValue

    case 'application.updateAgentSession':
      if (isRecord(params) && 'agentPresetId' in params) throw new Error('Agent Session preset binding is immutable')
      return await runtime.updateAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
        title: readOptionalString(params, 'title'),
        ...(isRecord(params) && params.timelineId !== undefined
          ? { timelineId: readNullableString(params, 'timelineId') }
          : {}),
      }, context) as unknown as JsonValue

    case 'application.invokeAgentTurn':
      return await runtime.invokeAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
        macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
        promptAddition: readOptionalObject(params, 'promptAddition') as InvokeAgentTurnInput['promptAddition'],
      }, context) as unknown as JsonValue

    case 'application.agent.run.create': {
      const runs = getRunStore(runtime)
      const request = {
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
        macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
        promptAddition: readOptionalObject(params, 'promptAddition') as InvokeAgentTurnInput['promptAddition'],
      } satisfies InvokeAgentTurnInput
      const run = startAgentRun(runtime, context, request)
      runs.set(run.id, run)
      pruneCompletedRuns(runs)
      void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
      return { runId: run.id }
    }

    case 'application.agent.run.subscribe': {
      const runs = getRunStore(runtime)
      const runId = readString(params, 'runId')
      const run = runs.get(runId)
      const cursor = readOptionalNumber(params, 'cursor') ?? 0
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Agent run cursor must be a non-negative integer')
      if (!run) {
        const sessionId = readOptionalString(params, 'agentSessionId')
        if (!sessionId) throw new Error(`Agent run not found: ${runId}`)
        let pageCursor: string | undefined
        do {
          const page = await runtime.getAgentTranscriptPage({ agentSessionId: sessionId, limit: 100, cursor: pageCursor })
          const state = [...page.entries].reverse().find(entry => entry.runId === runId && entry.entry.kind === 'run-state')?.entry
          if (state?.kind === 'run-state') {
            if (state.state === 'running' || state.state === 'created')
              throw new Error('Agent Run execution is unavailable; its persisted Transcript is still accessible')
            const terminal = state.state === 'completed' ? 'completed' : state.state === 'suspended' ? 'suspended'
              : state.state === 'aborted' || state.state === 'discarded' ? 'cancelled' : 'failed'
            return { events: [], nextCursor: cursor, done: true, state: terminal, replayExpired: true, partialText: '', pendingApprovals: [] }
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
        ...(replayExpired ? {
          replayExpired: true,
          partialText: run.partialText,
          pendingApprovals: [...run.mutationApprovals.values()].map(pending => pending.event),
        } : {}),
      } as unknown as JsonValue
    }

    case 'application.agent.run.acknowledge-completion': {
      const runId = readString(params, 'runId')
      const runs = getRunStore(runtime)
      const run = runs.get(runId)
      const accepted = Boolean(run?.pendingCompletion)
      if (run) run.pendingCompletion = undefined
      pruneCompletedRuns(runs)
      return { runId, accepted }
    }

    case 'application.agent.run.cancel': {
      const run = requireAgentRun(getRunStore(runtime), params)
      if (run.state !== 'running') return { runId: run.id, accepted: false, state: run.state }
      run.controller!.abort(isRecord(params) && typeof params.reason === 'string' ? params.reason : 'cancelled')
      return { runId: run.id, accepted: true, state: run.state }
    }

    case 'application.agent.run.history-read-approval':
    case 'application.agent.run.mutation-approval': {
      const run = requireAgentRun(getRunStore(runtime), params)
      const requestId = readString(params, 'requestId')
      const pending = run.mutationApprovals.get(requestId)
      if (!pending) return { runId: run.id, requestId, accepted: false }
      if (pending.kind !== (method === 'application.agent.run.history-read-approval' ? 'history-read' : 'mutation'))
        return { runId: run.id, requestId, accepted: false }
      const allow = readBoolean(params, 'allow')
      const reason = readOptionalString(params, 'reason')
      run.mutationApprovals.delete(requestId)
      pending.resolve(allow
        ? { decision: 'allow' }
        : { decision: 'deny', ...(reason ? { reason } : {}) })
      return { runId: run.id, requestId, accepted: true }
    }

    case 'application.agent.run.pause': {
      const run = requireAgentRun(getRunStore(runtime), params)
      if (run.state !== 'running') return { runId: run.id, accepted: false, state: run.state }
      run.controller!.abort('user-pause')
      return { runId: run.id, accepted: true, state: run.state }
    }

    case 'application.agent.run.abandon': {
      const run = requireAgentRun(getRunStore(runtime), params)
      if (run.state === 'running') throw new Error('Cannot change the main receiver while an Agent run is generating')
      if (run.state !== 'suspended' || run.abandoned || run.continuationRunId) {
        return { runId: run.id, accepted: false, state: run.state }
      }
      const transcript = await runtime.getAgentTranscriptPage({ agentSessionId: run.sessionId, limit: 100 })
      await runtime.appendAgentTranscriptEntries({
        agentSessionId: run.sessionId,
        expectedEntryCount: transcript.session.entryCount,
        entries: [{ runId: run.id, entry: { kind: 'run-state', state: 'discarded' } }],
      }, context)
      run.checkpoint = undefined
      run.abandoned = true
      run.request = undefined
      clearRunReplay(run)
      return { runId: run.id, accepted: true, state: run.state }
    }

    case 'application.agent.run.resume': {
      const runs = getRunStore(runtime)
      let source: AgentRun | undefined
      if (isRecord(params) && typeof params.runId === 'string') {
        source = runs.get(params.runId)
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
          const run = startAgentRun(runtime, context, { ...source.request, input: '' }, source.id, source.checkpoint, source)
          runs.set(run.id, run)
          pruneCompletedRuns(runs)
          void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
          source.continuationRunId = run.id
          return { runId: run.id, sourceRunId: source.id, accepted: true, state: run.state }
        }
      }

      const sessionId = isRecord(params) && typeof params.agentSessionId === 'string'
        ? params.agentSessionId
        : source?.sessionId
      if (sessionId) {
        const transcript = await runtime.getAgentTranscriptPage({ agentSessionId: sessionId, limit: 100 })
        const summary = [...transcript.entries].reverse().find(entry => entry.entry.kind === 'work-summary')
        const entries = summary
          ? transcript.entries.filter(entry => entry.sequence > summary.sequence)
          : transcript.entries
        const lastUser = entries.slice().reverse().find(e => e.entry.kind === 'message' && e.entry.role === 'user')
        if (lastUser) {
          const userIdx = entries.indexOf(lastUser)
          const laterEntries = entries.slice(userIdx + 1)
          const hasCompletedReply = laterEntries.some(
            e => e.entry.kind === 'message' && e.entry.role === 'assistant' && e.entry.state !== 'partial' && e.entry.content.trim()
          )
          const hasCompletedRun = laterEntries.some(
            e => e.entry.kind === 'run-state' && e.entry.state === 'completed'
          )
          if (laterEntries.some(e => e.entry.kind === 'run-state' && e.entry.state === 'discarded')) {
            return { runId: source?.id ?? '', accepted: false }
          }
          if (!hasCompletedReply || !hasCompletedRun) {
            const partialAssistant = laterEntries.find(
              e => e.entry.kind === 'message' && e.entry.role === 'assistant' && e.entry.state === 'partial'
            )
            const checkpoint = {
              sourceRunId: String(lastUser.runId || lastUser.id),
              messages: partialAssistant?.entry.kind === 'message' ? [{
                role: 'system' as const,
                content: `The previous assistant response was interrupted. Continue from this partial response without repeating it:\n${partialAssistant.entry.content}`,
              }] : [],
              userEntry: lastUser,
              ...(partialAssistant ? { partialEntryId: partialAssistant.id } : {}),
            }
            const run = startAgentRun(
              runtime,
              context,
              { agentSessionId: sessionId, input: '' },
              String(lastUser.runId || lastUser.id),
              checkpoint,
            )
            runs.set(run.id, run)
            pruneCompletedRuns(runs)
            void run.promise!.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
            return { runId: run.id, sourceRunId: String(lastUser.runId || lastUser.id), accepted: true, state: run.state }
          }
        }
      }

      return { runId: isRecord(params) && typeof params.runId === 'string' ? params.runId : '', accepted: false }
    }

    case 'application.agent.run.state': {
      const run = requireAgentRun(getRunStore(runtime), params)
      return { runId: run.id, state: run.state }
    }

    case 'application.previewAgentTurn':
      return await runtime.previewAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
        macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
        promptAddition: readOptionalObject(params, 'promptAddition') as InvokeAgentTurnInput['promptAddition'],
      }, context) as unknown as JsonValue

    case 'application.inspectMacros':
      return await runtime.inspectMacros({
        cardId: readOptionalString(params, 'cardId'),
        presetId: readOptionalString(params, 'presetId'),
        timelineTarget: readOptionalMacroTimelineTarget(params),
        macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap | undefined,
      }) as unknown as JsonValue

    case 'application.getTimelinePresetConfig':
      return await runtime.getTimelinePresetConfig({
        timelineId: readString(params, 'timelineId'),
        presetId: readString(params, 'presetId'),
      }) as unknown as JsonValue

    case 'application.updateTimelinePresetConfig':
      return await runtime.updateTimelinePresetConfig({
        timelineId: readString(params, 'timelineId'),
        presetId: readString(params, 'presetId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        macroSelections: readOptionalObject(params, 'macroSelections') as import('@loom-studio/shared').MacroSelectionMap,
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readPresetTextUses(params: JsonValue | undefined): Array<{ id: string; kind: 'rule' | 'extractor'; enabled: boolean; orderIndex?: number }> | undefined {
  if (!isRecord(params) || params.textUses === undefined) return undefined
  if (!Array.isArray(params.textUses)) throw new Error('Preset textUses must be an array')
  return params.textUses.map(value => {
    if (!isRecord(value) || (value.kind !== 'rule' && value.kind !== 'extractor')) throw new Error('Invalid Preset text use')
    return {
      id: readString(value, 'id'),
      kind: value.kind,
      enabled: readBoolean(value, 'enabled'),
      orderIndex: readOptionalNumber(value, 'orderIndex'),
    }
  })
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
  const id = `agent-run-${crypto.randomUUID()}`
  const controller = new AbortController()
  const run: AgentRun = {
    id, controller, request, sourceRunId, sessionId: request.agentSessionId,
    events: [], eventSizes: [], eventBytes: 0, firstCursor: 0, nextCursor: 0, partialText: '',
    state: 'running', promise: Promise.resolve(), mutationApprovals: new Map(),
  }
  const transferCheckpoint = () => {
    if (!source) return
    source.checkpoint = undefined
    source.request = undefined
  }
  const emit = (event: AgentRunEvent) => {
    if (event.type === 'text-delta') run.partialText += event.delta
    if (event.type === 'transcript-appended' && event.entries.some(entry =>
      entry.entry.kind === 'message' && entry.entry.role === 'assistant' || entry.entry.kind === 'tool-invocation',
    )) run.partialText = ''
    if (event.type === 'transcript-appended' && event.entries.some(entry =>
      entry.entry.kind === 'run-state' && entry.entry.state === 'running',
    )) transferCheckpoint()
    appendRunEvent(run, event)
    pruneCompletedRuns(getRunStore(runtime))
  }
  emit({ type: 'started', runId: id })
  run.promise = runtime.invokeAgentTurn(request, {
    ...context,
    abortSignal: controller.signal,
    agentRun: {
      runId: id,
      onEvent: emit,
      ...(continuation ? { continuation } : {}),
      onSuspended: checkpoint => { run.checkpoint = checkpoint; transferCheckpoint() },
      onHistoryReadApproval: (action, signal) => new Promise((resolve, reject) => {
        const approvalSignal = signal ?? controller.signal
        approvalSignal.throwIfAborted()
        const requestId = `history-read-approval-${crypto.randomUUID()}`
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
        const requestId = `mutation-approval-${crypto.randomUUID()}`
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
  }).then(result => {
    if (controller.signal.aborted) throw new Error(String(controller.signal.reason ?? 'Agent run cancelled'))
    run.state = 'completed'
    transferCheckpoint()
    // ponytail: Required delivery state may exceed replay budgets until acknowledged
    // or the two-minute expiry. Never discard an undelivered Inspector result.
    run.pendingCompletion = { type: 'completed', runId: id, result }
    emit(run.pendingCompletion)
  }).catch(error => {
    for (const pending of run.mutationApprovals.values()) pending.reject(new Error('Agent run ended before mutation approval.'))
    run.mutationApprovals.clear()
    const suspended = controller.signal.reason === 'user-pause' || Boolean(run.checkpoint)
    run.state = suspended ? 'suspended' : controller.signal.aborted ? 'cancelled' : 'failed'
    if (source?.checkpoint && source.continuationRunId === run.id) source.continuationRunId = undefined
    const reason = error instanceof Error ? error.message : String(error)
    emit(suspended
      ? { type: 'suspended', runId: id, reason }
      : controller.signal.aborted
        ? { type: 'cancelled', runId: id, reason }
        : { type: 'failed', runId: id, error: { name: error instanceof Error ? error.name : 'UnknownError', message: reason } })
  }).finally(() => {
    run.controller = undefined
    run.promise = undefined
    run.partialText = ''
    if (run.state !== 'suspended' || !run.checkpoint && source?.checkpoint) {
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
  if (run.state !== 'running') run.partialText = ''
}

function requireAgentRun(runs: Map<string, AgentRun>, params: JsonValue | undefined): AgentRun {
  if (!isRecord(params) || typeof params.runId !== 'string') throw new Error('Agent run is not available')
  const run = runs.get(params.runId)
  if (!run) throw new Error(`Agent run not found: ${params.runId}`)
  return run
}

function readAgentToolDefinition(params: JsonValue | undefined): ToolDefinition {
  const definition = readOptionalObject(params, 'definition')
  if (!definition) throw new Error('Expected agent tool definition: definition')
  return definition as unknown as ToolDefinition
}

function readPresetToolMountInputs(params: JsonValue | undefined, key: string): PresetToolMountInput[] {
  if (!isRecord(params) || !Array.isArray(params[key])) throw new Error(`Expected Preset Tool mount array param: ${key}`)
  return params[key].map((value, index) => {
    if (!isRecord(value)) throw new Error(`Expected Preset Tool mount object: ${key}[${index}]`)
    const activation = value.activation
    if (activation !== undefined && !isPromptActivation(activation)) {
      throw new Error(`Expected Preset Tool mount activation: ${key}[${index}].activation`)
    }
    const provider = value.provider
    if (provider !== undefined && (!isRecord(provider) || (provider.order !== undefined && typeof provider.order !== 'number'))) {
      throw new Error(`Expected Preset Tool provider placement: ${key}[${index}].provider`)
    }
    const content = value.content
    if (content !== undefined && (!isRecord(content)
      || (content.zone !== undefined && typeof content.zone !== 'string')
      || (content.slot !== undefined && typeof content.slot !== 'string')
      || (content.rankKey !== undefined && typeof content.rankKey !== 'string')
      || (content.orderHint !== undefined && typeof content.orderHint !== 'number'))) {
      throw new Error(`Expected Preset Tool content placement: ${key}[${index}].content`)
    }
    if (typeof value.toolId !== 'string' || typeof value.orderIndex !== 'number' || typeof value.defaultEnabled !== 'boolean') {
      throw new Error(`Expected Preset Tool mount fields: ${key}[${index}]`)
    }
    return {
      toolId: value.toolId,
      orderIndex: value.orderIndex,
      defaultEnabled: value.defaultEnabled,
      ...(activation === undefined ? {} : { activation }),
      ...(provider === undefined ? {} : { provider: provider as PresetToolMountInput['provider'] }),
      ...(content === undefined ? {} : { content: content as PresetToolMountInput['content'] }),
    }
  })
}

function readOptionalProviderModelSelection(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || typeof value.providerProfileId !== 'string' || typeof value.modelId !== 'string') {
    throw new Error(`Expected Provider model selection param: ${key}`)
  }
  return { providerProfileId: value.providerProfileId, modelId: value.modelId }
}

function readOptionalDelivery(params: JsonValue | undefined): 'stream' | 'complete' | undefined {
  if (!isRecord(params) || params.delivery === undefined) return undefined
  if (params.delivery !== 'stream' && params.delivery !== 'complete') {
    throw new Error('Expected Agent delivery: stream or complete')
  }
  return params.delivery
}

function readOptionalHistoryPolicy(params: JsonValue | undefined): 'persistent' | 'ephemeral' | undefined {
  if (!isRecord(params) || params.historyPolicy === undefined) return undefined
  if (params.historyPolicy !== 'persistent' && params.historyPolicy !== 'ephemeral') {
    throw new Error('Expected Agent historyPolicy: persistent or ephemeral')
  }
  return params.historyPolicy
}

function readOptionalNarrativeTarget(params: JsonValue | undefined): {
  timelineId: string
  branchId?: string
  inputNodeId?: string
} | undefined {
  const value = readOptionalObject(params, 'narrativeTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: narrativeTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.branchId')
  }
  if (value.inputNodeId !== undefined && typeof value.inputNodeId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.inputNodeId')
  }
  return {
    timelineId: value.timelineId,
    ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}),
    ...(typeof value.inputNodeId === 'string' ? { inputNodeId: value.inputNodeId } : {}),
  }
}

function readOptionalMacroTimelineTarget(params: JsonValue | undefined): { timelineId: string; branchId?: string } | undefined {
  const value = readOptionalObject(params, 'timelineTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: timelineTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') throw new Error('Expected optional string param: timelineTarget.branchId')
  return { timelineId: value.timelineId, ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}) }
}
