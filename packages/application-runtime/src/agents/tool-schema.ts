import type { JsonObject, JsonValue } from '@loom-studio/shared'

/** Clone each schema path independently so later descriptions cannot affect aliased siblings. */
export function cloneToolSchema(schema: JsonObject): JsonObject {
  return cloneJsonValue(schema) as JsonObject
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(cloneJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
    )
  }
  return value
}
