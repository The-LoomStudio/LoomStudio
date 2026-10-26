import type { JsonValue } from '@loom-studio/shared'

export type EventMeta = {
  installationId?: string
  eventId: string
  definitionVersion: number
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
