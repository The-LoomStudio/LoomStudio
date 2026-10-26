import { createTRPCUntypedClient, httpLink } from '@trpc/client'
import type { JsonValue } from '@loom-studio/shared'
import { createSessionFetch } from './session-fetch.js'

export type ClientBridgeOptions = { endpoint: string; fetch?: typeof fetch }
export type ClientBridge = {
  call<T = JsonValue>(method: string, params?: JsonValue, options?: { signal?: AbortSignal }): Promise<T>
}

// Untyped bridge for dynamic extension/SDK consumers. Main application code
// uses AppRouter via createStudioTrpcClient and cannot nominate return types.
export function createClientBridge(options: ClientBridgeOptions): ClientBridge {
  const rawFetch = options.fetch ?? globalThis.fetch
  if (!rawFetch) throw new Error('ClientBridge requires fetch')
  const authEndpoint = `${options.endpoint.slice(0, options.endpoint.lastIndexOf('/'))}/auth/session`
  const client = createTRPCUntypedClient({ links: [httpLink({
    url: options.endpoint, methodOverride: 'POST', fetch: createSessionFetch(rawFetch, authEndpoint),
  })] })
  return { call: <T = JsonValue>(method: string, params?: JsonValue, requestOptions?: { signal?: AbortSignal }) => {
    const platform = ['application', 'official', 'directories', 'settings', 'logs', 'ai', 'system', 'docs', 'extensions', 'diagnostics', 'kernel'].includes(method.split('.')[0]!)
    return client.mutation(platform ? method : 'kernel.invoke', platform ? params : { method, params }, requestOptions) as Promise<T>
  } }
}
