import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'

export type TraceRecord = {
  id: string
  content: JsonValue
  createdAt: string
}

export type AuditRecord = {
  id: string
  action: string
  at: string
  details?: JsonValue
}

export type TraceAuditStore = {
  appendTrace(content: JsonValue): TraceRecord
  listTraces(): TraceRecord[]
  appendAudit(action: string, details?: JsonValue): AuditRecord
  listAudit(): AuditRecord[]
}

export function createInMemoryTraceAuditStore(): TraceAuditStore {
  const traces: TraceRecord[] = []
  const audit: AuditRecord[] = []

  return {
    appendTrace: content => {
      const trace = {
        id: createId('trace'),
        content,
        createdAt: nowIso(),
      }
      traces.push(trace)
      return structuredClone(trace) as TraceRecord
    },
    listTraces: () => traces.map(trace => structuredClone(trace) as TraceRecord),
    appendAudit: (action, details) => {
      const entry = {
        id: createId('audit'),
        action,
        at: nowIso(),
        details,
      }
      audit.push(entry)
      return structuredClone(entry) as AuditRecord
    },
    listAudit: () => audit.map(entry => structuredClone(entry) as AuditRecord),
  }
}
