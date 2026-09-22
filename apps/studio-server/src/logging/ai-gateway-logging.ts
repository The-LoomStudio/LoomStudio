import type { AiGateway, GatewayInvokeChatInput } from '@loom-studio/application-runtime'
import { readLogFailure, type Logger } from '@loom-studio/logging'
import { createId } from '@loom-studio/shared'

export function withAiGatewayLogging(gateway: AiGateway, logger: Logger): AiGateway {
  return {
    ...(gateway.listModels ? { listModels: input => gateway.listModels!(input) } : {}),
    invokeChat: async input => {
      const invocationId = createId('invoke')
      const startedAt = performance.now()
      let firstOutputMs: number | undefined
      const references = buildInvocationReferences(input, invocationId)
      const model = input.model?.modelId ?? 'default model'
      const logContext = {
        ...(input.context?.correlationId ? { correlationId: input.context.correlationId } : {}),
        ...(input.context?.callId ? { callId: input.context.callId } : {}),
        ...(input.context?.parentCallId ? { parentCallId: input.context.parentCallId } : {}),
      }

      logger.info(`${model} · request started`, {
        event: 'provider.invoke.started',
        data: { ...references, outcome: 'running' },
        ...logContext,
      })

      try {
        const result = await gateway.invokeChat({
          ...input,
          // Do not force streaming on callers that did not request event delivery.
          ...(input.onEvent ? { onEvent: event => {
            if (firstOutputMs === undefined && (event.type === 'text-delta' || event.type === 'tool-input-delta')) {
              firstOutputMs = readDurationMs(startedAt)
            }
            input.onEvent!(event)
          } } : {}),
        })
        logger.info(`${result.model} · response completed${result.finishReason ? ` · ${result.finishReason}` : ''}`, {
          event: 'provider.invoke.completed',
          data: {
            ...references,
            provider: result.provider,
            model: result.model,
            outcome: 'completed',
            outputCharacters: result.text.length,
            toolCallCount: result.message.tool_calls?.length ?? 0,
            detail: `${references.detail} · ${result.text.length} output characters · ${result.message.tool_calls?.length ?? 0} native tool calls`,
            ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
            ...(result.providerCallId ? { providerCallId: result.providerCallId } : {}),
            ...(result.finishReason ? { finishReason: result.finishReason } : {}),
            ...(result.usage ? {
              usage: {
                ...(result.usage.inputTokens === undefined ? {} : { inputTokens: result.usage.inputTokens }),
                ...(result.usage.outputTokens === undefined ? {} : { outputTokens: result.usage.outputTokens }),
              },
            } : {}),
            durationMs: readDurationMs(startedAt),
          },
          ...logContext,
        })
        return result
      } catch (error) {
        const cancelled = input.abortSignal?.aborted || (error instanceof Error && error.name === 'AbortError')
        const failure = readLogFailure(error)
        logger[cancelled ? 'info' : 'error'](`${model} · ${cancelled ? 'request cancelled' : failure.failureReason}`, {
          event: cancelled ? 'provider.invoke.cancelled' : 'provider.invoke.failed',
          data: {
            ...references,
            durationMs: readDurationMs(startedAt),
            outcome: cancelled ? 'cancelled' : 'failed',
            ...failure,
            ...(firstOutputMs === undefined ? {} : { firstOutputMs }),
          },
          ...logContext,
        })
        throw error
      }
    },
  }
}

function buildInvocationReferences(input: GatewayInvokeChatInput, invocationId: string) {
  const providerStep = input.request.metadata?.providerStep
  return {
    invocationId,
    runId: input.runId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    ...(input.model ? {
      providerProfileId: input.model.providerProfileId,
      modelId: input.model.modelId,
    } : {}),
    messageCount: input.request.messages.length,
    toolCount: input.request.tools?.length ?? 0,
    delivery: input.delivery ?? 'complete',
    ...(typeof providerStep === 'number' ? { providerStep } : {}),
    detail: `${typeof providerStep === 'number' ? `Step ${providerStep} · ` : ''}${input.request.messages.length} messages · ${input.request.tools?.length ?? 0} native tools · ${input.delivery ?? 'complete'}`,
  }
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}
