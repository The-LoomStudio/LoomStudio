import type {
  ApplicationRuntime,
  AgentRunEvent,
  PresetToolMountInput,
  RuntimeRequestContext,
  ToolDefinition,
  InvokeAgentTurnInput,
} from '@loom-studio/application-runtime'
import { isPromptActivation } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalBooleanRecord,
  readNullableString,
  readOptionalString,
  readOptionalStringRecord,
  readString,
} from '../../rpc-params.js'

type AgentRun = {
  id: string
  controller: AbortController
  events: AgentRunEvent[]
  state: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled'
  promise: Promise<unknown>
  request: InvokeAgentTurnInput
  sourceRunId?: string
  continuationRunId?: string
  checkpoint?: {
    sourceRunId: string
    messages: import('@loom-studio/shared').ChatMessage[]
    userEntry: import('@loom-studio/application-data').AgentTranscriptEntry
    partialEntryId?: string
  }
}

const runStores = new WeakMap<ApplicationRuntime, Map<string, AgentRun>>()
const maxRetainedRuns = 128

export async function handleAgentsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createAgentProfile':
      return await runtime.createAgentProfile({
        name: readString(params, 'name'),
        presetId: readString(params, 'presetId'),
        model: readRequiredProviderModelSelection(params, 'model'),
        toolOverrides: readOptionalBooleanRecord(params, 'toolOverrides'),
        delivery: readOptionalDelivery(params),
      }) as unknown as JsonValue

    case 'application.getAgentProfile':
      return await runtime.getAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.listAgentProfiles':
      return await runtime.listAgentProfiles({ cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit') }) as unknown as JsonValue

    case 'application.updateAgentProfile':
      return await runtime.updateAgentProfile({
        agentProfileId: readString(params, 'agentProfileId'),
        name: readOptionalString(params, 'name'),
        presetId: readOptionalString(params, 'presetId'),
        model: readOptionalProviderModelSelection(params, 'model'),
        toolOverrides: readOptionalBooleanRecord(params, 'toolOverrides'),
        delivery: readOptionalDelivery(params),
      }) as unknown as JsonValue

    case 'application.deleteAgentProfile':
      return await runtime.deleteAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.listAgentTools':
      return await runtime.listAgentTools() as unknown as JsonValue

    case 'application.updateAgentTool':
      return await runtime.updateAgentTool({
        toolId: readString(params, 'toolId'),
        expectedVersion: readNumber(params, 'expectedVersion'),
        definition: readAgentToolDefinition(params),
      }) as unknown as JsonValue

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
        agentProfileId: readString(params, 'agentProfileId'),
        timelineId: readOptionalString(params, 'timelineId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.listAgentSessions':
      return await runtime.listAgentSessions({
        agentProfileId: readOptionalString(params, 'agentProfileId'),
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

    case 'application.updateAgentSession':
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
        macroSelections: readOptionalStringRecord(params, 'macroSelections'),
      }, context) as unknown as JsonValue

    case 'application.agent.run.create': {
      const runs = getRunStore(runtime)
      const request = {
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
        macroSelections: readOptionalStringRecord(params, 'macroSelections'),
      } satisfies InvokeAgentTurnInput
      const run = startAgentRun(runtime, context, request)
      runs.set(run.id, run)
      void run.promise.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
      return { runId: run.id }
    }

    case 'application.agent.run.subscribe': {
      const run = requireAgentRun(getRunStore(runtime), params)
      const cursor = readOptionalNumber(params, 'cursor') ?? 0
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Agent run cursor must be a non-negative integer')
      return {
        events: run.events.slice(cursor),
        nextCursor: run.events.length,
        done: run.state !== 'running',
        state: run.state,
      } as unknown as JsonValue
    }

    case 'application.agent.run.cancel': {
      const run = requireAgentRun(getRunStore(runtime), params)
      if (run.state !== 'running') return { runId: run.id, accepted: false, state: run.state }
      run.controller.abort(isRecord(params) && typeof params.reason === 'string' ? params.reason : 'cancelled')
      return { runId: run.id, accepted: true, state: run.state }
    }

    case 'application.agent.run.pause': {
      const run = requireAgentRun(getRunStore(runtime), params)
      if (run.state !== 'running') return { runId: run.id, accepted: false, state: run.state }
      run.controller.abort('user-pause')
      return { runId: run.id, accepted: true, state: run.state }
    }

    case 'application.agent.run.resume': {
      const source = requireAgentRun(getRunStore(runtime), params)
      if (source.state !== 'suspended') return { runId: source.id, accepted: false, state: source.state }
      if (!source.checkpoint) return { runId: source.id, accepted: false, state: source.state }
      if (source.continuationRunId) return { runId: source.continuationRunId, sourceRunId: source.id, accepted: true }
      const run = startAgentRun(runtime, context, { ...source.request, input: '' }, source.id, source.checkpoint)
      const runs = getRunStore(runtime)
      runs.set(run.id, run)
      void run.promise.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
      source.continuationRunId = run.id
      return { runId: run.id, sourceRunId: source.id, accepted: true, state: run.state }
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
        macroSelections: readOptionalStringRecord(params, 'macroSelections'),
      }, context) as unknown as JsonValue

    case 'application.inspectMacros':
      return await runtime.inspectMacros({
        cardId: readOptionalString(params, 'cardId'),
        presetId: readOptionalString(params, 'presetId'),
        timelineTarget: readOptionalMacroTimelineTarget(params),
        macroSelections: readOptionalStringRecord(params, 'macroSelections'),
      }) as unknown as JsonValue

    default:
      return undefined
  }
}

function startAgentRun(
  runtime: ApplicationRuntime,
  context: RuntimeRequestContext | undefined,
  request: InvokeAgentTurnInput,
  sourceRunId?: string,
  continuation?: AgentRun['checkpoint'],
): AgentRun {
  const id = `agent-run-${crypto.randomUUID()}`
  const controller = new AbortController()
  const run: AgentRun = {
    id, controller, request, sourceRunId, events: [{ type: 'started', runId: id }],
    state: 'running', promise: Promise.resolve(),
  }
  run.promise = runtime.invokeAgentTurn(request, {
    ...context,
    abortSignal: controller.signal,
    agentRun: {
      runId: id,
      onEvent: event => run.events.push(event),
      ...(continuation ? { continuation } : {}),
      onSuspended: checkpoint => { run.checkpoint = checkpoint },
    },
  }).then(result => {
    if (controller.signal.aborted) throw new Error(String(controller.signal.reason ?? 'Agent run cancelled'))
    run.state = 'completed'
    run.events.push({ type: 'completed', runId: id, result })
  }).catch(error => {
    const suspended = controller.signal.reason === 'user-pause'
    run.state = suspended ? 'suspended' : controller.signal.aborted ? 'cancelled' : 'failed'
    const reason = error instanceof Error ? error.message : String(error)
    run.events.push(suspended
      ? { type: 'suspended', runId: id, reason }
      : controller.signal.aborted
        ? { type: 'cancelled', runId: id, reason }
        : { type: 'failed', runId: id, error: { name: error instanceof Error ? error.name : 'UnknownError', message: reason } })
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
  if (runs.size <= maxRetainedRuns) return
  for (const [runId, run] of runs) {
    if (runs.size <= maxRetainedRuns) return
    if (run.state === 'running') continue
    runs.delete(runId)
  }
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

function readRequiredProviderModelSelection(params: JsonValue | undefined, key: string) {
  const value = readOptionalProviderModelSelection(params, key)
  if (!value) throw new Error(`Expected Provider model selection param: ${key}`)
  return value
}

function readOptionalDelivery(params: JsonValue | undefined): 'stream' | 'complete' | undefined {
  if (!isRecord(params) || params.delivery === undefined) return undefined
  if (params.delivery !== 'stream' && params.delivery !== 'complete') {
    throw new Error('Expected Agent Profile delivery: stream or complete')
  }
  return params.delivery
}

function readOptionalNarrativeTarget(params: JsonValue | undefined): {
  timelineId: string
  branchId?: string
  commit: boolean
} | undefined {
  const value = readOptionalObject(params, 'narrativeTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: narrativeTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.branchId')
  }
  if (typeof value.commit !== 'boolean') throw new Error('Expected boolean param: narrativeTarget.commit')
  return {
    timelineId: value.timelineId,
    ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}),
    commit: value.commit,
  }
}

function readOptionalMacroTimelineTarget(params: JsonValue | undefined): { timelineId: string; branchId?: string } | undefined {
  const value = readOptionalObject(params, 'timelineTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: timelineTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') throw new Error('Expected optional string param: timelineTarget.branchId')
  return { timelineId: value.timelineId, ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}) }
}
