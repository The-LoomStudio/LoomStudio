import type { RpcId, RpcRequest, RpcResponse } from '@loom-studio/transport'

export type ClientJsonValue = null | boolean | number | string | ClientJsonValue[] | { [key: string]: ClientJsonValue }

export type ClientConnectionState = 'idle' | 'connected' | 'disconnected'

export type ClientBridgeOptions = {
  endpoint: string
  fetch?: typeof fetch
  source?: string
}

export type ClientBridgeCallEnvelope<T = ClientJsonValue> = {
  result: T
  meta: RpcResponse['meta']
}

export type ClientBridge = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  call<T = ClientJsonValue>(method: string, params?: ClientJsonValue): Promise<T>
  callWithMeta<T = ClientJsonValue>(method: string, params?: ClientJsonValue): Promise<ClientBridgeCallEnvelope<T>>
  request(request: RpcRequest): Promise<RpcResponse>
  getConnectionState(): ClientConnectionState
}

export function createClientBridge(options: ClientBridgeOptions): ClientBridge {
  const fetchImpl = options.fetch ?? globalThis.fetch
  let state: ClientConnectionState = 'idle'
  let nextId = 1

  if (!fetchImpl) {
    throw new Error('ClientBridge requires fetch')
  }

  return {
    connect: async () => {
      state = 'connected'
    },
    disconnect: async () => {
      state = 'disconnected'
    },
    call: async <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => {
      const response = await callRpc(fetchImpl, options.endpoint, nextRpcId(nextId++), method, params, options.source)

      if (response.error) {
        throw new Error(response.error.message)
      }

      return response.result as T
    },
    callWithMeta: async <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => {
      const response = await callRpc(fetchImpl, options.endpoint, nextRpcId(nextId++), method, params, options.source)

      if (response.error) {
        throw new Error(response.error.message)
      }

      return {
        result: response.result as T,
        meta: response.meta,
      }
    },
    request: request => sendRequest(fetchImpl, options.endpoint, request),
    getConnectionState: () => state,
  }
}

function callRpc(fetchImpl: typeof fetch, endpoint: string, id: RpcId, method: string, params: ClientJsonValue | undefined, source: string | undefined): Promise<RpcResponse> {
  return sendRequest(fetchImpl, endpoint, {
    jsonrpc: '2.0',
    id,
    method,
    params,
    meta: source ? { source } : undefined,
  })
}

async function sendRequest(fetchImpl: typeof fetch, endpoint: string, request: RpcRequest): Promise<RpcResponse> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    throw new Error(`RPC HTTP request failed: ${response.status}`)
  }

  return await response.json() as RpcResponse
}

function nextRpcId(value: number): RpcId {
  return `client-${value}`
}
