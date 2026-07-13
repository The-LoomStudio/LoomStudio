import type { Diagnostic } from '../diagnostic/types.js'
import type { Fragment } from '../fragment/types.js'
import type { Mutation } from '../mutation/types.js'
import type { PassConfig } from '../pass/types.js'
import type { SerializedError } from '../pipeline/errors.js'

export type TraceMode = 'on' | 'off'
export type SnapshotMode = 'off' | 'boundaries' | 'after-only'
export type TraceStatus = 'ok' | 'error'

export interface TraceOptions {
  readonly mode?: TraceMode
  readonly snapshot?: SnapshotMode
  readonly sink?: TraceSink | readonly TraceSink[]
}

export interface TraceSink {
  onPassStart?(passName: string, passIndex: number): void
  onPassEnd?(execution: TraceExecution): void
  onDiagnostic?(diagnostic: Diagnostic): void
}

export interface TraceExecution<M = unknown> {
  readonly passName: string
  readonly passIndex: number
  readonly durationMs: number
  readonly diagnostics: readonly Diagnostic[]
  readonly mutations: readonly Mutation<M>[]
  readonly snapshot?: {
    readonly before?: readonly Fragment<M>[]
    readonly after?: readonly Fragment<M>[]
  }
}

export interface Trace<M = unknown> {
  readonly version: '1'
  readonly mode: TraceMode
  readonly status: TraceStatus
  readonly error?: SerializedError
  readonly initialFragments: readonly Fragment<M>[]
  readonly finalFragments: readonly Fragment<M>[]
  readonly passConfigs?: readonly PassConfig[]
  readonly executions: readonly TraceExecution<M>[]
  readonly diagnostics: readonly Diagnostic[]
}
