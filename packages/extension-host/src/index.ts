import type { Diagnostic } from '@loom-studio/diagnostics'

export type ExtensionState = 'discovered' | 'active' | 'degraded' | 'disabled'

export type ExtensionSummary = {
  id: string
  version: string
  state: ExtensionState
}

export type ExtensionHost = {
  list(): ExtensionSummary[]
  diagnostics(extensionId?: string): Diagnostic[]
}
