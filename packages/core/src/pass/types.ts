import type { DiagnosticInput } from '../diagnostic/types.js'
import type { Fragment } from '../fragment/types.js'

export interface PassContext {
  readonly passName: string
  readonly passIndex: number
  diagnose(diagnostic: DiagnosticInput): void
}

export interface Pass<M = unknown> {
  readonly name: string
  run(fragments: readonly Fragment<M>[], ctx: PassContext): readonly Fragment<M>[]
}

export interface PassFactory<P = unknown, M = unknown> {
  readonly name: string
  create(params: P): Pass<M>
}

export interface PassConfig<P = unknown> {
  readonly name: string
  readonly params?: P
}
