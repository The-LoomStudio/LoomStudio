import type { Fragment } from '../fragment/types.js'
import type { Pass } from '../pass/types.js'
import type { TraceOptions } from '../trace/types.js'
import type { RunResult } from './runner.js'
import { runPasses } from './runner.js'

export interface Pipeline<M = unknown> {
  run(fragments: readonly Fragment<M>[], options?: TraceOptions): RunResult<M>
}

export function pipeline<M = unknown>(passes: readonly Pass<M>[]): Pipeline<M> {
  return {
    run(fragments, options) {
      return runPasses({
        fragments,
        passes,
        ...(options ? { trace: options } : {}),
      })
    },
  }
}
