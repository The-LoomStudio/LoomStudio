import type { LogGap, LogLevel, LogPage, LogRecord } from '@loom-studio/logging'
import type { StudioApi } from '../../shared/api/studio-api.js'

export type LogStreamItem = {
  kind: 'group'
  namespace: string
  records: LogRecord[]
  firstTimestamp: string
  lastTimestamp: string
} | {
  kind: 'record'
  record: LogRecord
}

export function matchesLogSearch(record: LogRecord, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return JSON.stringify(record).toLocaleLowerCase().includes(normalizedQuery)
}

export function buildLogStream(records: LogRecord[]): LogStreamItem[] {
  const orderedRecords = [...records].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const runs: LogRecord[][] = []

  for (const record of orderedRecords) {
    const currentRun = runs.at(-1)
    if (currentRun && currentRun[0]?.namespace === record.namespace) currentRun.push(record)
    else runs.push([record])
  }

  return runs.map(run => run.length === 1
    ? { kind: 'record', record: run[0]! }
    : {
        kind: 'group',
        namespace: run[0]!.namespace,
        records: run,
        firstTimestamp: run[0]!.timestamp,
        lastTimestamp: run.at(-1)!.timestamp,
      })
}

export async function readLogPages(list: StudioApi['logs']['list'], initialCursor?: string): Promise<{
  items: LogRecord[]
  cursor: string
  gap?: LogGap
  truncated: boolean
}> {
  const items: LogRecord[] = []
  let cursor = initialCursor
  let gap: LogGap | undefined

  // ponytail: 防止持续高速写入时刷新永不结束；日志缓冲区当前最多 5000 条，20 页留有一倍余量。
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page: LogPage = await list({ cursor, limit: 500 })
    items.push(...page.items)
    gap ??= page.gap
    if (!page.hasMore) return { items, cursor: page.cursor, gap, truncated: false }
    if (page.cursor === cursor) throw new Error('Log pagination cursor did not advance')
    cursor = page.cursor
  }

  return { items: items.slice(-5_000), cursor: cursor!, gap, truncated: true }
}

export function highestLogLevel(records: LogRecord[]): LogLevel | undefined {
  let highest: LogLevel | undefined
  for (const record of records) {
    highest = moreSevereLogLevel(highest, record.level)
  }
  return highest
}

export function moreSevereLogLevel(left: LogLevel | undefined, right: LogLevel | undefined): LogLevel | undefined {
  if (!left) return right
  if (!right) return left
  return levelWeight[right] > levelWeight[left] ? right : left
}

const levelWeight: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}
