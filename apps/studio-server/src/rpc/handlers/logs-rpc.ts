import type { LogLevel, LogReader } from '@loom-studio/logging'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord, readOptionalNumber, readOptionalString } from '../rpc-params.js'

const logLevels: LogLevel[] = ['debug', 'info', 'warn', 'error']

export function callLogsRpc(logs: LogReader, method: string, params: JsonValue | undefined): JsonValue {
  if (method !== 'logs.list') throw new Error(`Logs RPC method not found: ${method}`)
  const limit = readOptionalNumber(params, 'limit') ?? 100
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error('logs.list limit must be an integer between 1 and 500')
  }

  const since = readOptionalDate(params, 'since')
  const until = readOptionalDate(params, 'until')
  const namespacePrefix = readOptionalString(params, 'namespacePrefix')
  if (namespacePrefix !== undefined && namespacePrefix.length === 0) {
    throw new Error('logs.list namespacePrefix must be non-empty')
  }
  if (since && until && since > until) throw new Error('logs.list since must not be after until')

  return logs.query({
    limit,
    cursor: readOptionalString(params, 'cursor'),
    levels: readOptionalLogLevels(params),
    namespacePrefix,
    service: readOptionalString(params, 'service'),
    instanceId: readOptionalString(params, 'instanceId'),
    since,
    until,
  }) as unknown as JsonValue
}

function readOptionalLogLevels(params: JsonValue | undefined): LogLevel[] | undefined {
  if (!isRecord(params) || params.levels === undefined) return undefined
  if (!Array.isArray(params.levels) || params.levels.length === 0 || !params.levels.every(level => typeof level === 'string' && logLevels.includes(level as LogLevel))) {
    throw new Error('logs.list levels must contain only debug, info, warn, or error')
  }
  return params.levels as LogLevel[]
}

function readOptionalDate(params: JsonValue | undefined, key: string): string | undefined {
  const value = readOptionalString(params, key)
  if (value === undefined) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`logs.list ${key} must be an ISO timestamp`)
  return date.toISOString()
}
