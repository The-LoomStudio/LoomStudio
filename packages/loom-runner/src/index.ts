import type { Diagnostic } from '@loom-studio/diagnostics'
import type { JsonValue } from '@loom-studio/shared'
import type { TraceAuditStore } from '@loom-studio/trace-audit'
import { PassRegistry, run, type Diagnostic as CoreDiagnostic, type Fragment, type PassConfig, type PassFactory } from '@loom/core'

export type LoomRunInput = {
  fragments: JsonValue[]
  passes: JsonValue[]
  options?: JsonValue
  trace?: {
    enabled?: boolean
    strictPersist?: boolean
  }
}

export type LoomRunResult = {
  fragments: JsonValue[]
  traceId?: string
  diagnostics?: Diagnostic[]
}

export type LoomRunner = {
  run(input: LoomRunInput): Promise<LoomRunResult>
}

export type LoomRunnerOptions = {
  traceAudit?: TraceAuditStore
  factories?: readonly PassFactory[]
}

export function createLoomRunner(options: LoomRunnerOptions = {}): LoomRunner {
  const registry = new PassRegistry()
  for (const factory of (options.factories ?? [])) {
    registry.register(factory)
  }

  return {
    run: async input => {
      const fragments = readFragments(input.fragments)
      const passes = readPassConfigs(input.passes)
      const result = run({
        fragments,
        passes,
        registry,
        trace: { mode: input.trace?.enabled === false ? 'off' : 'on' },
      })
      const diagnostics = result.diagnostics.map(toStudioDiagnostic)
      let traceId: string | undefined

      if (input.trace?.enabled) {
        try {
          traceId = options.traceAudit?.appendTrace(result.trace as unknown as JsonValue).id
        } catch (error) {
          const diagnostic = toRunnerDiagnostic('loom.trace_persist_failed', error)
          diagnostics.push(diagnostic)
          if (input.trace.strictPersist) {
            throw new Error(diagnostic.message, { cause: error })
          }
        }
      }

      return {
        fragments: result.fragments as unknown as JsonValue[],
        ...(traceId ? { traceId } : {}),
        diagnostics,
      }
    },
  }
}

export function createSamplePassFactories(): PassFactory[] {
  return [
    {
      name: 'noop',
      create: () => ({
        name: 'noop',
        run: (fragments: readonly Fragment[]) => fragments,
      }),
    },
    {
      name: 'uppercase',
      create: () => ({
        name: 'uppercase',
        run: (fragments: readonly Fragment[]) => fragments.map(fragment => ({ ...fragment, content: fragment.content.toUpperCase() })),
      }),
    },
    {
      name: 'throw',
      create: () => ({
        name: 'throw',
        run: () => {
          throw new Error('throw pass failed')
        },
      }),
    },
  ]
}

function readFragments(value: JsonValue[]): Fragment[] {
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Fragment at index ${index} must be an object`)
    if (typeof item.id !== 'string') throw new Error(`Fragment at index ${index} must have string id`)
    if (typeof item.content !== 'string') throw new Error(`Fragment at index ${index} must have string content`)

    return {
      id: item.id,
      content: item.content,
      meta: isRecord(item.meta) ? item.meta : {},
    }
  })
}

function readPassConfigs(value: JsonValue[]): PassConfig[] {
  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Pass at index ${index} must be an object`)
    if (typeof item.name !== 'string') throw new Error(`Pass at index ${index} must have string name`)

    return {
      name: item.name,
      ...(item.params === undefined ? {} : { params: item.params }),
    }
  })
}

function toStudioDiagnostic(diagnostic: CoreDiagnostic): Diagnostic {
  return {
    severity: diagnostic.severity === 'hint' ? 'info' : diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    source: 'loom-runner',
    details: diagnostic as unknown as JsonValue,
    createdAt: new Date().toISOString(),
    id: `${diagnostic.code}:${Math.random().toString(36).slice(2)}`,
  }
}

function toRunnerDiagnostic(code: string, error: unknown): Diagnostic {
  return {
    id: `${code}:${Math.random().toString(36).slice(2)}`,
    severity: 'error',
    code,
    message: error instanceof Error ? error.message : String(error),
    source: 'loom-runner',
    createdAt: new Date().toISOString(),
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
