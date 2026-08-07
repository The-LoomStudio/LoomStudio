import type { ClientJsonValue } from '@loom-studio/client-bridge'

export function toClientJsonObject(
  value: Record<string, ClientJsonValue | undefined>,
): Record<string, ClientJsonValue> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ClientJsonValue] => entry[1] !== undefined),
  )
}
