import type { LogPage, LogQuery } from './memory-sink.js'

export type LogHistoryQuery = LogQuery & { since: string; until: string }
export type LogHistoryPage = Omit<LogPage, 'gap'> & {
  scannedBytes: number
  scannedRecords: number
  issues: { reason: 'missing-file' | 'changed-file' | 'invalid-line' | 'incomplete-line' | 'oversized-line'; count: number }[]
}
export type LogHistoryReader = {
  query(input: LogHistoryQuery, signal?: AbortSignal): Promise<LogHistoryPage>
}
