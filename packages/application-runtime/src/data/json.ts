import type { JsonValue } from '@loom-studio/shared'

export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype) return false
  }

  ancestors.add(value)
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (!isJsonValue(child, ancestors)) {
      ancestors.delete(value)
      return false
    }
  }
  ancestors.delete(value)
  return true
}
