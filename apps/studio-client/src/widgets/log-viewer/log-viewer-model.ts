import type { LogLevel, LogRecord } from '@loom-studio/logging'

type LogStreamItem = {
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
