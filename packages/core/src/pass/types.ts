import type { DiagnosticInput } from '../diagnostic/types.js'
import type { Fragment } from '../fragment/types.js'

export type FieldPath = string
export type Capability = string

export interface PassContext {
  readonly passName: string
  readonly passIndex: number
  diagnose(diagnostic: DiagnosticInput): void
  log(message: string, data?: unknown): void
}

export interface Pass<M = unknown> {
  readonly name: string
  readonly version?: string
  readonly reads?: readonly FieldPath[]
  readonly writes?: readonly FieldPath[]
  readonly requires?: readonly Capability[]
  readonly provides?: readonly Capability[]
  run(fragments: readonly Fragment<M>[], ctx: PassContext): readonly Fragment<M>[]
}

export interface PassFactory<P = unknown, M = unknown> {
  readonly name: string
  readonly version?: string
  readonly paramsSchema?: unknown
  readonly reads?: readonly FieldPath[]
  readonly writes?: readonly FieldPath[]
  readonly requires?: readonly Capability[]
  readonly provides?: readonly Capability[]
  create(params: P): Pass<M>
}

export interface PassConfig<P = unknown> {
  readonly name: string
  readonly params?: P
}
