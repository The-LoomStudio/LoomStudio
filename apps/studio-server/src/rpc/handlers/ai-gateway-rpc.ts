import type { AiGatewayCapabilityRegistry, AiGatewayRunState, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord, readString } from '../rpc-params.js'

const runStores = new WeakMap<ProfiledAiGateway, Map<string, ReturnType<ProfiledAiGateway['createRun']>>>()
const maxRetainedRuns = 128

export async function callAiGatewayRpc(
  services: { registry: AiGatewayCapabilityRegistry; gateway: ProfiledAiGateway },
  method: string,
  params: JsonValue | undefined,
): Promise<JsonValue> {
  switch (method) {
    case 'ai.providers.list':
      return { providers: services.registry.list() as unknown as JsonValue }
    case 'ai.invoke': {
      if (!isRecord(params)) throw new Error('Expected AI Gateway invoke params')
      if (params.input === undefined) throw new Error('Expected AI Gateway input')
      return await services.gateway.invoke({
        profileId: readString(params, 'profileId'),
        input: params.input as JsonValue,
        caller: { kind: 'studio-client' },
      }) as unknown as JsonValue
    }
    case 'ai.run.create': {
      if (!isRecord(params) || params.input === undefined) throw new Error('Expected AI Gateway run params')
      const run = services.gateway.createRun({ profileId: readString(params, 'profileId'), input: params.input as JsonValue, caller: { kind: 'studio-client' } })
      const runs = getRunStore(services.gateway)
      runs.set(run.id, run)
      void run.result.catch(() => undefined).finally(() => pruneCompletedRuns(runs))
      return { runId: run.id }
    }
    case 'ai.run.subscribe': {
      const run = requireRun(getRunStore(services.gateway), params)
      const cursor = isRecord(params) && typeof params.cursor === 'number' && Number.isSafeInteger(params.cursor) && params.cursor >= 0
        ? params.cursor
        : 0
      const batch = run.readEvents(cursor)
      return { ...batch, state: run.getState() }
    }
    case 'ai.run.cancel': {
      const run = requireRun(getRunStore(services.gateway), params)
      if (!isRecord(params)) throw new Error('Expected run params')
      run.cancel(typeof params.reason === 'string' ? params.reason : undefined)
      return { runId: run.id, state: run.getState() }
    }
    case 'ai.run.state': {
      const run = requireRun(getRunStore(services.gateway), params)
      return { runId: run.id, state: run.getState() }
    }
    default:
      throw new Error(`AI Gateway RPC method not found: ${method}`)
  }
}

function pruneCompletedRuns(runs: Map<string, ReturnType<ProfiledAiGateway['createRun']>>): void {
  if (runs.size <= maxRetainedRuns) return
  for (const [runId, run] of runs) {
    if (runs.size <= maxRetainedRuns) return
    if (run.getState() === 'running') continue
    runs.delete(runId)
  }
}

function getRunStore(gateway: ProfiledAiGateway) {
  const existing = runStores.get(gateway)
  if (existing) return existing
  const created = new Map<string, ReturnType<ProfiledAiGateway['createRun']>>()
  runStores.set(gateway, created)
  return created
}

function requireRun(runs: Map<string, ReturnType<ProfiledAiGateway['createRun']>> | undefined, params: JsonValue | undefined) {
  if (!runs || !isRecord(params) || typeof params.runId !== 'string') throw new Error('Gateway run is not available')
  const run = runs.get(params.runId)
  if (!run) throw new Error(`Gateway run not found: ${params.runId}`)
  return run
}
