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

let fallbackIdCounter = 0

export function createId(prefix = 'id'): string {
  fallbackIdCounter += 1
  return `${prefix}-${fallbackIdCounter}`
}

export function serializeError(error: unknown, code = 'internal.error'): SerializedError {
  if (error instanceof Error) {
    return {
      code,
      message: error.message,
    }
  }

  return {
    code,
    message: String(error),
  }
}
