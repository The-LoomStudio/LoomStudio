import type { JsonValue, SerializedError } from '@loom-studio/shared'

export type RpcRequest = {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: JsonValue
}

export type RpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: JsonValue
  error?: SerializedError
}
