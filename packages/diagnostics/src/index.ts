export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

export type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  code: string
  message: string
  source?: string
}

export type DiagnosticsRegistry = {
  list(): Diagnostic[]
  add(diagnostic: Diagnostic): void
}

export function createInMemoryDiagnosticsRegistry(): DiagnosticsRegistry {
  const diagnostics: Diagnostic[] = []

  return {
    list: () => [...diagnostics],
    add: diagnostic => {
      diagnostics.push(diagnostic)
    },
  }
}
