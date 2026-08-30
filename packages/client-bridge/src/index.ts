import type { RpcId, RpcRequest, RpcResponse } from '@loom-studio/transport'

export type ClientJsonValue = null | boolean | number | string | ClientJsonValue[] | { [key: string]: ClientJsonValue }

export type ClientBridgeOptions = {
  endpoint: string
  fetch?: typeof fetch
}

export type ClientBridge = {
  call<T = ClientJsonValue>(method: string, params?: ClientJsonValue): Promise<T>
}

export function createClientBridge(options: ClientBridgeOptions): ClientBridge {
  const fetchImpl = options.fetch ?? globalThis.fetch
  let nextId = 1

  if (!fetchImpl) {
    throw new Error('ClientBridge requires fetch')
  }

  return {
    call: async <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => {
      const response = await callRpc(fetchImpl, options.endpoint, nextRpcId(nextId++), method, params)

      if (response.error) {
        throw new Error(response.error.message)
      }

      return response.result as T
    },
  }
}

function callRpc(fetchImpl: typeof fetch, endpoint: string, id: RpcId, method: string, params: ClientJsonValue | undefined): Promise<RpcResponse> {
  return sendRequest(fetchImpl, endpoint, {
    jsonrpc: '2.0',
    id,
    method,
    params,
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
