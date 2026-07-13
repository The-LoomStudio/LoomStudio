export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly pass: string
  readonly fragmentId?: string
  readonly at?: number
  readonly meta?: Record<string, unknown>
  readonly relatedFragmentIds?: readonly string[]
}

export type DiagnosticInput = Omit<Diagnostic, 'pass' | 'at'>
