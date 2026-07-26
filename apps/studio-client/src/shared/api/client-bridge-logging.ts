import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { Logger } from '@loom-studio/logging'

export function withClientBridgeLogging(bridge: ClientBridge, logger: Logger): ClientBridge {
  return {
    ...bridge,
    call: <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => logRpcFailure(logger, method, () => bridge.call<T>(method, params)),
    callWithMeta: <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => logRpcFailure(logger, method, () => bridge.callWithMeta<T>(method, params)),
    request: async request => {
      const startedAt = performance.now()
      try {
        const response = await bridge.request(request)
        if (response.error) logRpcError(logger, request.method, startedAt, response.error)
        return response
      } catch (error) {
        logRpcError(logger, request.method, startedAt, error)
        throw error
      }
    },
  }
}

async function logRpcFailure<T>(logger: Logger, method: string, call: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    return await call()
  } catch (error) {
    logRpcError(logger, method, startedAt, error)
    throw error
  }
}

function logRpcError(logger: Logger, method: string, startedAt: number, error: unknown): void {
  const durationMs = Number((performance.now() - startedAt).toFixed(2))
  logger.error(`${method} failed after ${durationMs} ms`, {
    event: 'rpc.failed',
    data: {
      method,
      durationMs,
      failureType: readFailureType(error),
      ...readErrorCode(error),
    },
  })
}

function readFailureType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

function readErrorCode(error: unknown): { errorCode?: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) return {}
  const code = error.code
  return typeof code === 'string' || typeof code === 'number' ? { errorCode: String(code) } : {}
}
