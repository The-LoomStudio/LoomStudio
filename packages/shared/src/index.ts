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
