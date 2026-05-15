import type { JsonValue } from '@loom-studio/shared'

export type TraceRecord = {
  id: string
  content: JsonValue
}

export type AuditRecord = {
  id: string
  action: string
  at: string
}
