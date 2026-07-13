import type { Diagnostic } from '../diagnostic/types.js'
import { cloneFragments } from '../fragment/clone.js'
import type { Fragment } from '../fragment/types.js'
import { validateFragments } from '../fragment/validate.js'
import { computeMutations } from '../mutation/diff.js'
import { annotateOwners, assertOwnerNotMutated, detectCrossOwnerWrites } from '../owner/owner.js'
import type { Pass, PassConfig } from '../pass/types.js'
import { factoryDiagnostic, PassRegistry } from '../pass/registry.js'
import { TraceCollector } from '../trace/collector.js'
import type { Trace, TraceOptions } from '../trace/types.js'
import { now } from '../utils/time.js'
import { createPassContext } from './context.js'
import { PipelineValidationError, serializeError, type SerializedError } from './errors.js'

export interface RunConfig<M = unknown> {
  readonly fragments: readonly Fragment<M>[]
  readonly passes: readonly PassConfig[]
  readonly registry: PassRegistry<M>
  readonly trace?: TraceOptions
}

export interface RunResult<M = unknown> {
  readonly fragments: readonly Fragment<M>[]
  readonly trace: Trace<M>
  readonly diagnostics: readonly Diagnostic[]
  readonly status: 'ok' | 'error'
  readonly error?: SerializedError
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return !!value && typeof value === 'object' && typeof (value as { then?: unknown }).then === 'function'
}

function suppressPromiseRejection(value: PromiseLike<unknown>): void {
  Promise.resolve(value).catch(() => {
    // Unsupported async pass rejections are intentionally swallowed after
    // Core has already emitted a synchronous async-pass diagnostic.
  })
}

function validatePasses(passes: readonly Pass[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i]
    if (!pass || typeof pass !== 'object') {
      diagnostics.push({
        severity: 'error',
        code: 'loom/invalid-pass',
        message: `Pass at index ${i} must be an object`,
        pass: 'core',
      })
      continue
    }
    if (typeof pass.name !== 'string' || pass.name.length === 0) {
      diagnostics.push({
        severity: 'error',
        code: 'loom/invalid-pass',
        message: `Pass at index ${i} must have a non-empty name`,
        pass: 'core',
      })
    }
    if (typeof pass.run !== 'function') {
      diagnostics.push({
        severity: 'error',
        code: 'loom/invalid-pass',
        message: `Pass "${pass.name}" at index ${i} must have run()`,
        pass: 'core',
      })
    }
  }
  return diagnostics
}

function validationError(message: string, diagnostics: readonly Diagnostic[]): PipelineValidationError {
  return new PipelineValidationError(
    message,
    diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message }))
  )
}

function normalizeInitialFragments<M>(fragments: readonly Fragment<M>[]): Fragment<M>[] {
  return fragments.map((fragment) => {
    const meta = fragment.meta && typeof fragment.meta === 'object' && !Array.isArray(fragment.meta)
      ? fragment.meta as Record<string, unknown>
      : {}
    const rest = { ...meta }
    delete rest.__owner
    return {
      ...fragment,
      meta: {
        ...rest,
        __owner: 'input',
      } as M,
    }
  })
}

function toValidationDiagnostics(error: PipelineValidationError, passName: string): Diagnostic[] {
  return error.diagnostics.map((item): Diagnostic => ({
    severity: 'error',
    code: item.code,
    message: item.message,
    pass: passName,
  }))
}

function errorDiagnostic(error: unknown, passName: string): Diagnostic {
  return {
    severity: 'error',
    code: error instanceof Error && error.message.includes('meta.__owner')
      ? 'loom/owner-mutation'
      : error instanceof Error && error.message.includes('returned a Promise')
        ? 'loom/async-pass-result'
        : 'loom/pass-threw',
    message: error instanceof Error ? error.message : String(error),
    pass: passName,
  }
}

export function run<M = unknown>(config: RunConfig<M>): RunResult<M> {
  const diagnostics: Diagnostic[] = []
  let passes: readonly Pass<M>[]

  try {
    passes = config.registry.createAll(config.passes)
  } catch (error) {
    const diagnostic = factoryDiagnostic('unknown', error)
    diagnostics.push(diagnostic)
    const trace = new TraceCollector(config.fragments, config.trace, config.passes)
    trace.addDiagnostic(diagnostic)
    return {
      fragments: config.fragments,
      trace: trace.endTrace(config.fragments, 'error', serializeError(error)),
      diagnostics,
      status: 'error',
      error: serializeError(error),
    }
  }

  return runPasses({
    fragments: config.fragments,
    passes,
    passConfigs: config.passes,
    ...(config.trace ? { trace: config.trace } : {}),
  })
}

export function runPasses<M = unknown>(input: {
  readonly fragments: readonly Fragment<M>[]
  readonly passes: readonly Pass<M>[]
  readonly trace?: TraceOptions
  readonly passConfigs?: readonly PassConfig[]
}): RunResult<M> {
  const diagnostics: Diagnostic[] = []
  let current = normalizeInitialFragments(input.fragments)
  const collector = new TraceCollector(current, input.trace, input.passConfigs)

  const constructionDiagnostics = [
    ...validatePasses(input.passes as readonly Pass[]),
    ...validateFragments(current as readonly Fragment[], 'core'),
  ]
  for (const diagnostic of constructionDiagnostics) {
    diagnostics.push(diagnostic)
    collector.addDiagnostic(diagnostic)
  }
  if (constructionDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    const error = validationError('Pipeline construction failed', constructionDiagnostics)
    const serialized = serializeError(error)
    return {
      fragments: current,
      trace: collector.endTrace(current, 'error', serialized),
      diagnostics,
      status: 'error',
      error: serialized,
    }
  }

  for (let passIndex = 0; passIndex < input.passes.length; passIndex++) {
    const pass = input.passes[passIndex]!
    const passDiagnostics: Diagnostic[] = []
    const logs: { readonly message: string; readonly data?: unknown; readonly at: number }[] = []
    const before = cloneFragments(current)
    const startedAt = now()

    collector.startPass(pass.name, passIndex)

    try {
      const ctx = createPassContext({
        passName: pass.name,
        passIndex,
        diagnostics: passDiagnostics,
        logs,
      })
      const result = pass.run(current, ctx)
      if (isPromiseLike(result)) {
        suppressPromiseRejection(result)
        throw new Error(`Pass "${pass.name}" returned a Promise; Core v0.1 requires synchronous passes`)
      }

      let next = [...result]
      const resultDiagnostics = validateFragments(next as readonly Fragment[], pass.name)
      for (const diagnostic of resultDiagnostics) passDiagnostics.push(diagnostic)
      if (resultDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        throw validationError(`Pass "${pass.name}" returned invalid fragments`, resultDiagnostics)
      }

      assertOwnerNotMutated(before, next)
      next = annotateOwners(before, next, pass.name)
      passDiagnostics.push(...detectCrossOwnerWrites(before, next, pass.name))

      const mutations = computeMutations(before, next)
      const durationMs = now() - startedAt

      for (const diagnostic of passDiagnostics) {
        diagnostics.push(diagnostic)
        collector.addDiagnostic(diagnostic)
      }

      collector.endPass({
        passName: pass.name,
        passIndex,
        durationMs,
        diagnostics: passDiagnostics,
        mutations,
        beforeFragments: before,
        afterFragments: next,
      })

      current = next
    } catch (error) {
      const errorDiagnostics = error instanceof PipelineValidationError
        ? toValidationDiagnostics(error, pass.name)
        : [errorDiagnostic(error, pass.name)]
      const allPassDiagnostics = [...passDiagnostics, ...errorDiagnostics]

      for (const diagnostic of allPassDiagnostics) {
        diagnostics.push(diagnostic)
        collector.addDiagnostic(diagnostic)
      }

      const safeFragments = before
      const serialized = serializeError(error)
      return {
        fragments: safeFragments,
        trace: collector.endTrace(safeFragments, 'error', serialized),
        diagnostics,
        status: 'error',
        error: serialized,
      }
    }
  }

  return {
    fragments: current,
    trace: collector.endTrace(current),
    diagnostics,
    status: 'ok',
  }
}
