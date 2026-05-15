import type { JsonValue, SerializedError } from '@loom-studio/shared'
import { serializeError } from '@loom-studio/shared'

export type RpcId = string | number | null

export type RpcRequest = {
  jsonrpc: '2.0'
  id: RpcId
  method: string
  params?: JsonValue
}

export type RpcResponse = {
  jsonrpc: '2.0'
  id: RpcId
  result?: JsonValue
  error?: SerializedError
}

export type EventMeta = {
  eventId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  emittedAt: string
  source: string
}

export type StudioEvent = {
  name: string
  payload: JsonValue
  meta: EventMeta
}

export type ServerEventMessage = {
  jsonrpc: '2.0'
  method: 'event'
  params: {
    event: StudioEvent
  }
}

export function createSuccessResponse(id: RpcId, result: JsonValue): RpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

export function createErrorResponse(id: RpcId, error: unknown, code = 'rpc.handler_failed'): RpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: error instanceof Error ? serializeError(error, code) : normalizeSerializedError(error, code),
  }
}

export function parseRpcRequest(value: unknown): RpcRequest {
  if (!value || typeof value !== 'object') {
    throw new Error('RPC request must be an object')
  }

  const request = value as Partial<RpcRequest>

  if (request.jsonrpc !== '2.0') {
    throw new Error('RPC request must use jsonrpc 2.0')
  }

  if (typeof request.method !== 'string' || request.method.length === 0) {
    throw new Error('RPC request method is required')
  }

  if (!('id' in request)) {
    throw new Error('RPC request id is required')
  }

  return request as RpcRequest
}

function normalizeSerializedError(error: unknown, code: string): SerializedError {
  if (error && typeof error === 'object' && 'message' in error) {
    return {
      code,
      message: String((error as { message: unknown }).message),
    }
  }

  return {
    code,
    message: String(error),
  }
}
