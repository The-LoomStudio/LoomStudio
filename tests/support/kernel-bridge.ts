import { createClientBridge } from '../../apps/studio-client/src/shared/api/client-bridge.js'
import type { Kernel } from '@loom-studio/kernel'
import { createId, type JsonValue } from '@loom-studio/shared'

// In-process JSON transport for Kernel/Bridge tests; this does not run the HTTP server.
export function createKernelBridge(kernel: Kernel, calls?: Array<{ method: string; params?: JsonValue }>) {
  const fetch: typeof globalThis.fetch = async (input, init) => {
    let response: unknown
    try {
      const path = new URL(String(input)).pathname.split('/').at(-1)!
      const data = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      const request = path === 'kernel.invoke' ? data : { method: path, params: data }
      calls?.push(request)
      const result = await kernel.callRpc(request.method, request.params, {
        clientId: 'kernel-bridge-test', correlationId: createId('corr'), callId: createId('call'),
      })
      response = { result: { data: result } }
    } catch (error) {
      response = { error: { message: error instanceof Error ? error.message : String(error), code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }
    }
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return createClientBridge({ endpoint: 'http://kernel/trpc', fetch })
}
