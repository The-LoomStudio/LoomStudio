import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

export type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  code: string
  message: string
  source: string
  extensionId?: string
  documentId?: string
  correlationId?: string
  callId?: string
  createdAt: string
  details?: JsonValue
}

export type DiagnosticInput = Omit<Diagnostic, 'id' | 'createdAt'> & {
  id?: string
  createdAt?: string
}

export type DiagnosticFilter = {
  severity?: DiagnosticSeverity
  source?: string
  extensionId?: string
}

export type DiagnosticsRegistry = {
  list(filter?: DiagnosticFilter): Diagnostic[]
  add(diagnostic: DiagnosticInput): Diagnostic
  clear(): void
}

export function createInMemoryDiagnosticsRegistry(): DiagnosticsRegistry {
  const diagnostics: Diagnostic[] = []

  return {
    list: filter => {
      return diagnostics.filter(diagnostic => {
        if (filter?.severity && diagnostic.severity !== filter.severity) return false
        if (filter?.source && diagnostic.source !== filter.source) return false
        if (filter?.extensionId && diagnostic.extensionId !== filter.extensionId) return false
        return true
      })
    },
    add: input => {
      const diagnostic: Diagnostic = {
        ...input,
        id: input.id ?? createId('diag'),
        createdAt: input.createdAt ?? nowIso(),
      }

      diagnostics.push(diagnostic)
      return diagnostic
    },
    clear: () => {
      diagnostics.length = 0
    },
  }
}
