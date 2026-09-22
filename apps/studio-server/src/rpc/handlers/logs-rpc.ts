import { readLogQuery, type LogReader, type LogHistoryReader } from '@loom-studio/logging'
import type { JsonValue } from '@loom-studio/shared'

export function callLogsRpc(logs: LogReader, method: string, params: JsonValue | undefined, history?: LogHistoryReader, signal?: AbortSignal): JsonValue | Promise<JsonValue> {
  const query = readLogQuery(params)
  if (method === 'logs.list') return logs.query(query) as unknown as JsonValue
  if (method === 'logs.history') {
    if (!history) throw new Error('History logs are not available')
    if (!query.since || !query.until) throw new Error('History queries require since and until')
    return history.query({ ...query, since: query.since, until: query.until }, signal) as unknown as Promise<JsonValue>
  }
  throw new Error(`Logs RPC method not found: ${method}`)
}
