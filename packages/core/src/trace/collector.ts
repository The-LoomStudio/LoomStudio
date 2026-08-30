import type { Diagnostic } from '../diagnostic/types.js'
import type { Fragment } from '../fragment/types.js'
import { cloneFragments } from '../fragment/clone.js'
import type { Mutation } from '../mutation/types.js'
import type { PassConfig } from '../pass/types.js'
import type { SerializedError } from '../pipeline/errors.js'
import type { Trace, TraceExecution, TraceOptions } from './types.js'

export class TraceCollector<M = unknown> {
  private readonly mode: 'on' | 'off'
  private readonly snapshotMode: 'off' | 'boundaries' | 'after-only'
  private readonly executions: TraceExecution<M>[] = []
  private readonly diagnostics: Diagnostic[] = []
  private finalFragments: readonly Fragment<M>[] = []

  constructor(
    private readonly initialFragments: readonly Fragment<M>[],
    private readonly options: TraceOptions = {},
    private readonly passConfigs?: readonly PassConfig[]
  ) {
    this.mode = options.mode ?? 'on'
    this.snapshotMode = options.snapshot ?? 'off'
  }

  addDiagnostic(diagnostic: Diagnostic): void {
    this.diagnostics.push(diagnostic)
  }

  endPass(input: {
    readonly passName: string
    readonly passIndex: number
    readonly durationMs: number
    readonly diagnostics: readonly Diagnostic[]
    readonly mutations: readonly Mutation<M>[]
    readonly beforeFragments: readonly Fragment<M>[]
    readonly afterFragments: readonly Fragment<M>[]
  }): void {
    if (this.mode === 'off') return

    const execution: TraceExecution<M> = {
      passName: input.passName,
      passIndex: input.passIndex,
      durationMs: input.durationMs,
      diagnostics: [...input.diagnostics],
      mutations: [...input.mutations],
      ...(this.snapshotMode !== 'off'
        ? {
            snapshot: {
              ...(this.snapshotMode === 'boundaries'
                ? { before: cloneFragments(input.beforeFragments) }
                : {}),
              after: cloneFragments(input.afterFragments),
            },
          }
        : {}),
    }

    this.executions.push(execution)
  }

  endTrace(finalFragments: readonly Fragment<M>[], status: 'ok' | 'error' = 'ok', error?: SerializedError): Trace<M> {
    this.finalFragments = cloneFragments(finalFragments)
    return {
      version: '1',
      mode: this.mode,
      status,
      ...(error ? { error } : {}),
      initialFragments: this.mode === 'off' ? [] : cloneFragments(this.initialFragments),
      finalFragments: this.mode === 'off' ? [] : this.finalFragments,
      ...(this.passConfigs ? { passConfigs: this.passConfigs } : {}),
      executions: this.mode === 'off' ? [] : [...this.executions],
      diagnostics: [...this.diagnostics],
    }
  }
}
