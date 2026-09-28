import type { LogQuery, LogReader } from './memory-sink.js'
import type { LogHistoryReader } from './history-types.js'
import type { ExtensionLogQuery, ExtensionLogPage } from './extension-logger.js'

const stringKeys = ['cursor', 'namespacePrefix', 'service', 'instanceId', 'text', 'event', 'runId', 'packageId', 'moduleId'] as const
const allowedKeys = new Set<string>([...stringKeys, 'limit', 'levels', 'since', 'until', 'installationId'])

export function readLogQuery(value: unknown): LogQuery {
  if (value === undefined) return { limit: 100 }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Log query must be an object')
  const input = value as Record<string, unknown>
  for (const key of Object.keys(input)) if (!allowedKeys.has(key)) throw new Error(`Unknown log query field: ${key}`)
  const limit = input.limit ?? 100
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0 || limit > 500) throw new Error('Log query limit must be an integer between 1 and 500')
  const query: LogQuery = { limit }
  if (input.installationId !== undefined) {
    if (input.installationId !== null && (typeof input.installationId !== 'string' || !input.installationId || input.installationId.length > 2048)) throw new Error('Invalid log query installationId')
    query.installationId = input.installationId
  }
  for (const key of stringKeys) {
    const item = input[key]
    if (item === undefined) continue
    if (typeof item !== 'string' || !item || item.length > (key === 'text' ? 512 : 256)) throw new Error(`Invalid log query ${key}`)
    query[key] = item
  }
  if (input.levels !== undefined) {
    if (!Array.isArray(input.levels) || !input.levels.length || input.levels.length > 4 || !input.levels.every(level => ['debug', 'info', 'warn', 'error'].includes(level))) throw new Error('Log query levels must contain debug, info, warn, or error')
    query.levels = input.levels
  }
  for (const key of ['since', 'until'] as const) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string' || !Number.isFinite(Date.parse(input[key]))) throw new Error(`Invalid log query ${key}`)
    query[key] = new Date(input[key]).toISOString()
  }
  if (query.since && query.until && query.since > query.until) throw new Error('Log query since must not be after until')
  return query
}

export async function queryExtensionLogs(
  readers: { current?: LogReader; history?: LogHistoryReader },
  packageId: string,
  input: ExtensionLogQuery,
  sourceName: string,
  installationId?: string,
): Promise<ExtensionLogPage> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Log query must be an object')
  for (const key of ['packageId', 'service', 'instanceId', 'installationId']) if (Object.hasOwn(input, key)) throw new Error(`Extension cannot set log ${key}`)
  const { source = 'current', ...fields } = input
  const query = readLogQuery({ ...fields, packageId, installationId: installationId ?? null })
  if (source === 'history') {
    if (!readers.history) throw new Error('History logs are not available in this host')
    if (!query.since || !query.until) throw new Error('History queries require since and until')
    return { ...await readers.history.query({ ...query, since: query.since, until: query.until }), sources: [sourceName] }
  }
  if (source !== 'current') throw new Error('Invalid log source')
  if (!readers.current) throw new Error('Current logs are not available in this host')
  return { ...readers.current.query(query), sources: [sourceName] }
}
