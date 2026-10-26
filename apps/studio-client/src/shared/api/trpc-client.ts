import { readLogFailure, type Logger } from '@loom-studio/logging'
import { createTRPCClient, httpLink, loggerLink, type TRPCClient } from '@trpc/client'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@loom-studio/studio-server/trpc'
import { createSessionFetch } from './session-fetch.js'

export type StudioRpcInputs = inferRouterInputs<AppRouter>
export type StudioRpcOutputs = inferRouterOutputs<AppRouter>

export function createStudioTrpcClient(options: { endpoint?: string; fetch?: typeof fetch; logger?: Logger } = {}): TRPCClient<AppRouter> {
  const endpoint = options.endpoint ?? '/trpc'
  const authEndpoint = `${endpoint.slice(0, endpoint.lastIndexOf('/'))}/auth/session`
  return createTRPCClient<AppRouter>({
    links: [loggerLink({
      enabled: event => event.direction === 'down' && event.result instanceof Error,
      logger: event => {
        if (event.direction !== 'down' || !(event.result instanceof Error) || event.signal?.aborted) return
        const failure = readLogFailure(event.result)
        options.logger?.error(`${event.path} failed · ${failure.failureReason}`, {
          event: 'rpc.failed',
          correlationId: event.result.data?.correlationId,
          callId: event.result.data?.callId,
          data: { method: `${event.path}`, durationMs: event.elapsedMs, outcome: 'failed', ...failure },
        })
      },
    }), httpLink({ url: endpoint, methodOverride: 'POST', fetch: createSessionFetch(options.fetch, authEndpoint) })],
  })
}
export type StudioTrpcClient = ReturnType<typeof createStudioTrpcClient>
