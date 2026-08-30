import type { JsonObject, JsonValue } from '@loom-studio/shared'

export function isRecord(value: JsonValue | undefined): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readString(params: JsonValue | undefined, key: string): string {
  if (!isRecord(params) || typeof params[key] !== 'string') {
    throw new Error(`Expected string param: ${key}`)
  }

  return params[key]
}

export function readOptionalString(params: JsonValue | undefined, key: string): string | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  if (typeof params[key] !== 'string') {
    throw new Error(`Expected optional string param: ${key}`)
  }

  return params[key]
}

export function readNullableString(params: JsonValue | undefined, key: string): string | null {
  if (!isRecord(params) || params[key] === undefined || params[key] === null) return null
  if (typeof params[key] !== 'string') {
    throw new Error(`Expected nullable string param: ${key}`)
  }

  return params[key]
}

export function readNumber(params: JsonValue | undefined, key: string): number {
  if (!isRecord(params) || typeof params[key] !== 'number') {
    throw new Error(`Expected number param: ${key}`)
  }

  return params[key]
}

export function readOptionalNumber(params: JsonValue | undefined, key: string): number | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  if (typeof params[key] !== 'number') {
    throw new Error(`Expected optional number param: ${key}`)
  }

  return params[key]
}

export function readBoolean(params: JsonValue | undefined, key: string): boolean {
  if (!isRecord(params) || typeof params[key] !== 'boolean') {
    throw new Error(`Expected boolean param: ${key}`)
  }

  return params[key]
}

export function readOptionalBoolean(params: JsonValue | undefined, key: string): boolean | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  if (typeof params[key] !== 'boolean') {
    throw new Error(`Expected optional boolean param: ${key}`)
  }

  return params[key]
}

export function readOptionalObject(params: JsonValue | undefined, key: string): JsonObject | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  if (!isRecord(params[key])) {
    throw new Error(`Expected optional object param: ${key}`)
  }

  return params[key]
}

export function readOptionalStringRecord(params: JsonValue | undefined, key: string): Record<string, string> | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected optional string record param: ${key}`)
  const entries = Object.entries(value)
  if (!entries.every(([, item]) => typeof item === 'string')) {
    throw new Error(`Expected optional string record param: ${key}`)
  }

  return Object.fromEntries(entries) as Record<string, string>
}
