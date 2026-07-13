import type { Trace } from './types.js'

export function serializeTrace(trace: Trace): string {
  return JSON.stringify(trace)
}

function isTrace(value: unknown): value is Trace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === '1'
    && (record.mode === 'on' || record.mode === 'off')
    && (record.status === 'ok' || record.status === 'error')
    && Array.isArray(record.initialFragments)
    && Array.isArray(record.finalFragments)
    && Array.isArray(record.executions)
    && Array.isArray(record.diagnostics)
}

export function deserializeTrace<M = unknown>(input: string): Trace<M> {
  return JSON.parse(input) as Trace<M>
}

export function deserializeTraceChecked<M = unknown>(input: string): Trace<M> {
  const parsed = JSON.parse(input) as unknown
  if (!isTrace(parsed)) {
    throw new Error('Invalid Loom Trace v1 payload')
  }
  return parsed as Trace<M>
}
