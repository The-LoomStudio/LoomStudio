import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  code: string
  message: string
  source: string
  packageId?: string
  moduleId?: string
  extensionId?: string
  instanceId?: string
  documentId?: string
  correlationId?: string
  callId?: string
  createdAt: string
  details?: JsonValue
  occurrences?: number
  lastSeenAt?: string
}

export type DiagnosticInput = Omit<Diagnostic, 'id' | 'createdAt' | 'occurrences' | 'lastSeenAt'> & {
  id?: string
  createdAt?: string
}

export type DiagnosticFilter = {
  severity?: DiagnosticSeverity
  source?: string
  packageId?: string
  moduleId?: string
  extensionId?: string
  instanceId?: string
}

export type DiagnosticsRegistry = {
  list(filter?: DiagnosticFilter): Diagnostic[]
  add(diagnostic: DiagnosticInput): Diagnostic
  clear(): void
}

export function createInMemoryDiagnosticsRegistry(): DiagnosticsRegistry {
  // ponytail: Current diagnostic context is bounded; complete failure history belongs in Logging.
  const maximumDiagnostics = 1000
  const maximumPerSource = 100
  const diagnostics: Array<{ key: string; source: string; value: Diagnostic }> = []

  return {
    list: filter => {
      return diagnostics.map(entry => entry.value).filter(diagnostic => {
        if (filter?.severity && diagnostic.severity !== filter.severity) return false
        if (filter?.source && diagnostic.source !== filter.source) return false
        if (filter?.packageId && diagnostic.packageId !== filter.packageId) return false
        if (filter?.moduleId && diagnostic.moduleId !== filter.moduleId) return false
        if (filter?.extensionId && diagnostic.extensionId !== filter.extensionId) return false
        if (filter?.instanceId && diagnostic.instanceId !== filter.instanceId) return false
        return true
      })
    },
    add: input => {
      const source = JSON.stringify([input.source, input.packageId, input.extensionId])
      const key = JSON.stringify([
        source, input.moduleId, input.instanceId, input.documentId,
        input.severity, input.code, input.id,
      ])
      const existingIndex = diagnostics.findIndex(entry => entry.key === key)
      const existing = existingIndex < 0 ? undefined : diagnostics.splice(existingIndex, 1)[0]?.value
      const timestamp = input.createdAt ?? nowIso()
      const diagnostic: Diagnostic = {
        ...input,
        id: existing?.id ?? input.id ?? createId('diag'),
        createdAt: existing?.createdAt ?? timestamp,
        occurrences: Math.min(Number.MAX_SAFE_INTEGER, (existing?.occurrences ?? 0) + 1),
        lastSeenAt: timestamp,
      }

      if (diagnostics.filter(entry => entry.source === source).length >= maximumPerSource) {
        diagnostics.splice(diagnostics.findIndex(entry => entry.source === source), 1)
      }
      if (diagnostics.length >= maximumDiagnostics) diagnostics.shift()
      diagnostics.push({ key, source, value: diagnostic })
      return diagnostic
    },
    clear: () => {
      diagnostics.length = 0
    },
  }
}
