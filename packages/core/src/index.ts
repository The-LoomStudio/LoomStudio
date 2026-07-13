export type { Fragment } from './fragment/types.js'
export { cloneFragment, cloneFragments } from './fragment/clone.js'
export { validateFragments } from './fragment/validate.js'

export type { Diagnostic, DiagnosticInput, DiagnosticSeverity } from './diagnostic/types.js'

export type { Mutation } from './mutation/types.js'
export { computeMutation, computeMutations } from './mutation/diff.js'
export { applyMutation, replayTrace } from './mutation/replay.js'

export type {
  Capability,
  FieldPath,
  Pass,
  PassConfig,
  PassContext,
  PassFactory,
} from './pass/types.js'
export { factoryDiagnostic, PassRegistry } from './pass/registry.js'

export type {
  SnapshotMode,
  Trace,
  TraceExecution,
  TraceMode,
  TraceOptions,
  TraceSink,
} from './trace/types.js'
export { TraceCollector } from './trace/collector.js'
export { deserializeTrace, deserializeTraceChecked, serializeTrace } from './trace/serialize.js'

export { annotateOwners, assertOwnerNotMutated, detectCrossOwnerWrites } from './owner/owner.js'

export { pipeline } from './pipeline/pipeline.js'
export type { Pipeline } from './pipeline/pipeline.js'
export { run, runPasses } from './pipeline/runner.js'
export type { RunConfig, RunResult } from './pipeline/runner.js'
export {
  LoomError,
  PipelineError,
  PipelineValidationError,
  serializeError,
} from './pipeline/errors.js'
export type { SerializedError } from './pipeline/errors.js'
