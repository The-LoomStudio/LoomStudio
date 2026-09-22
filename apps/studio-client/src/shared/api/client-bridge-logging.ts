import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { readLogFailure, type Logger } from '@loom-studio/logging'

export function withClientBridgeLogging(bridge: ClientBridge, logger: Logger): ClientBridge {
  return {
    call: <T = ClientJsonValue>(method: string, params?: ClientJsonValue, options?: { signal?: AbortSignal }) => logRpcFailure(logger, method, () => options ? bridge.call<T>(method, params, options) : bridge.call<T>(method, params)),
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
  if (error instanceof Error && error.name === 'AbortError') return
  const durationMs = Number((performance.now() - startedAt).toFixed(2))
  const failure = readLogFailure(error)
  logger.error(`${method} failed · ${failure.failureReason}`, {
    event: 'rpc.failed',
    data: {
      method,
      durationMs,
      outcome: 'failed',
      detail: `${method} failed · ${failure.failureReason}`,
      ...failure,
      ...readErrorCode(error),
    },
  })
}

function readErrorCode(error: unknown): { errorCode?: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) return {}
  const code = error.code
  return typeof code === 'string' || typeof code === 'number' ? { errorCode: String(code) } : {}
}
