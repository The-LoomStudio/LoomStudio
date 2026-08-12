import { randomUUID } from 'node:crypto'

export type { AssistantChatMessage, ChatMessage, ChatToolCall } from './chat.js'

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
export type JsonArray = JsonValue[]

export type SerializedError = {
  code: string
  message: string
  details?: JsonValue
}

export type Clock = {
  now(): Date
}

export type IdGenerator = {
  next(prefix?: string): string
}

export function nowIso(clock: Clock = { now: () => new Date() }): string {
  return clock.now().toISOString()
}

export function createId(prefix = 'id'): string {
  return `${prefix}-${randomUUID()}`
}

export function serializeError(error: unknown, code = 'internal.error'): SerializedError {
  if (error instanceof Error) {
    return {
      code: 'code' in error && typeof error.code === 'string' ? error.code : code,
      message: error.message,
    }
  }

  return {
    code,
    message: String(error),
  }
}
