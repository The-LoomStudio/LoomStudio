import { createId } from '@loom-studio/shared'
import type { AiGateway, CanonicalChatRequest } from '../types.js'
import type { ObservationStore } from './types.js'

const requestIds = new WeakMap<CanonicalChatRequest, string>()
const wrappers = new WeakMap<AiGateway, WeakMap<ObservationStore, AiGateway>>()

/** Runtime-only identity; public metadata cannot impersonate an existing request. */
export function observationRequest<T extends CanonicalChatRequest>(request: T, id: string): T {
  requestIds.set(request, id)
  return request
}

/** Only explicitly supported non-secret generation settings enter historical evidence. */
export function safeGenerationConfiguration(config: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of ['temperature', 'topP', 'topK', 'maxTokens', 'maxOutputTokens', 'frequencyPenalty', 'presencePenalty', 'seed', 'reasoningEffort', 'serviceTier', 'store', 'model', 'modelId']) {
    const value = config?.[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value
  }
  for (const [key, fields] of [['thinking', ['type', 'budgetTokens']], ['thinkingConfig', ['thinkingBudget', 'includeThoughts']]] as const) {
    const value = config?.[key]
    if (!value || typeof value !== 'object') continue
    const settings: Record<string, unknown> = {}
    for (const field of fields) {
      const item = (value as Record<string, unknown>)[field]
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') settings[field] = item
    }
    result[key] = settings
  }
  return result
}

export function createObservedAiGateway(gateway: AiGateway, observations: ObservationStore): AiGateway {
  const existing = wrappers.get(gateway)?.get(observations)
  if (existing) return existing
  const wrapped: AiGateway = {
    ...(gateway.listModels ? { listModels: input => gateway.listModels!(input) } : {}),
    invokeChat: async input => {
      const existingId = requestIds.get(input.request)
      const id = typeof existingId === 'string' ? existingId : createId('api')
      const startedAt = performance.now()
      let firstOutputMs: number | undefined
      observations.capture(() => {
        if (typeof existingId !== 'string') observations.write({
          id, kind: 'api', title: input.model?.modelId ?? 'Model API', status: 'running',
          timelineId: input.context?.observationOrigin?.timelineId,
          ...(input.context ? { origin: {
            ...input.context.observationOrigin, actor: input.context.actor?.id, correlationId: input.context.correlationId,
            callId: input.context.callId, parentCallId: input.context.parentCallId,
          } } : {}),
          request: { preparedMessages: input.request.messages, messages: input.request.messages, tools: input.request.tools, toolChoice: input.request.toolChoice,
            model: input.model, delivery: input.delivery ?? 'complete', phase: 'prepared',
            configuration: safeGenerationConfiguration(input.request.providerOptions) },
        })
        observations.patch(id, { request: { phase: 'invoking' } })
      })
      try {
        const result = await gateway.invokeChat({
          ...input,
          request: { ...input.request, metadata: { ...input.request.metadata, observationRequestId: id } },
          ...(input.onEvent ? { onEvent: event => {
            observations.capture(() => {
              if (firstOutputMs === undefined && (event.type === 'text-delta' || event.type === 'reasoning-delta' || event.type === 'tool-input-delta')) firstOutputMs = performance.now() - startedAt
            })
            input.onEvent!(event)
          } } : {}),
        })
        observations.capture(() => observations.patch(id, {
          status: 'completed', durationMs: performance.now() - startedAt,
          request: { phase: 'completed', usage: result.usage, finishReason: result.finishReason,
            providerCallId: result.providerCallId, firstOutputMs,
            response: { message: result.message, reasoning: result.reasoning, model: result.model, provider: result.provider } },
        }))
        return result
      } catch (error) {
        observations.capture(() => {
          const status = input.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError') ? 'aborted' : 'failed'
          observations.patch(id, { status, durationMs: performance.now() - startedAt,
            diagnostic: error instanceof Error ? error.message : String(error), request: { phase: status, firstOutputMs } })
        })
        throw error
      }
    },
  }
  const byStore = wrappers.get(gateway) ?? new WeakMap<ObservationStore, AiGateway>()
  byStore.set(observations, wrapped)
  wrappers.set(gateway, byStore)
  const wrappedStores = new WeakMap<ObservationStore, AiGateway>()
  wrappedStores.set(observations, wrapped)
  wrappers.set(wrapped, wrappedStores)
  return wrapped
}
