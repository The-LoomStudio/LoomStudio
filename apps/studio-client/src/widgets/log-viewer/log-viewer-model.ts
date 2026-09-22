import type { LogLevel, LogRecord } from '@loom-studio/logging'

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
