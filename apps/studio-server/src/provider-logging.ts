import type { AiGateway, GatewayInvokeChatInput } from '@loom-studio/application-runtime'
import type { Logger } from '@loom-studio/logging'
import { createId } from '@loom-studio/shared'

export function withAiGatewayLogging(gateway: AiGateway, logger: Logger): AiGateway {
  return {
    invokeChat: async input => {
      const invocationId = createId('invoke')
      const startedAt = performance.now()
      const references = readReferences(input, invocationId)
      const logContext = {
        ...(input.context?.correlationId ? { correlationId: input.context.correlationId } : {}),
        ...(input.context?.callId ? { callId: input.context.callId } : {}),
        ...(input.context?.parentCallId ? { parentCallId: input.context.parentCallId } : {}),
      }

      logger.info('Provider invocation started', {
        event: 'provider.invoke.started',
        data: references,
        ...logContext,
      })

      try {
        const result = await gateway.invokeChat(input)
        logger.info('Provider invocation completed', {
          event: 'provider.invoke.completed',
          data: {
            ...references,
            provider: result.provider,
            model: result.model,
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
        logger.error('Provider invocation failed', {
          event: 'provider.invoke.failed',
          data: {
            ...references,
            durationMs: readDurationMs(startedAt),
            failureType: error instanceof Error ? error.name : 'UnknownError',
          },
          ...logContext,
        })
        throw error
      }
    },
  }
}

function readReferences(input: GatewayInvokeChatInput, invocationId: string) {
  return {
    invocationId,
    runId: input.runId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
    messageCount: input.request.messages.length,
  }
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}
