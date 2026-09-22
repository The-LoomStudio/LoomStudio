import type { LogRecord } from './types.js'

export function formatLogDuration(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds * 100) / 100} ms`
    : `${Math.round(milliseconds / 10) / 100} s`
}

export function readLogPresentation(record: LogRecord) {
  const data = record.data
  const usage = data?.usage
  return {
    detail: typeof data?.detail === 'string' ? data.detail : undefined,
    duration: typeof data?.durationMs === 'number' ? formatLogDuration(data.durationMs) : undefined,
    inputTokens: usage && typeof usage === 'object' && !Array.isArray(usage) && typeof usage.inputTokens === 'number' ? usage.inputTokens : undefined,
    outputTokens: usage && typeof usage === 'object' && !Array.isArray(usage) && typeof usage.outputTokens === 'number' ? usage.outputTokens : undefined,
    technical: record.level !== 'warn' && record.level !== 'error' && (record.level === 'debug' || data?.technical === true),
  }
}
