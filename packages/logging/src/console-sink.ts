import type { LogRecord, LogSink } from './types.js'

type ConsoleOutput = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>

export function createConsoleLogSink(options: {
  console?: ConsoleOutput
  filter?: (record: LogRecord) => boolean
} = {}): LogSink {
  const output = options.console ?? console

  return {
    name: 'console',
    write: record => {
      if (options.filter && !options.filter(record)) return
      const details = readDetails(record)
      const prefix = `[${record.timestamp}] ${record.level.toUpperCase()} ${record.service}/${record.namespace}`
      if (details) output[record.level](prefix, record.message, details)
      else output[record.level](prefix, record.message)
    },
  }
}

function readDetails(record: LogRecord): Record<string, unknown> | undefined {
  const details = {
    ...(record.event ? { event: record.event } : {}),
    ...(record.data ? { data: record.data } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(record.correlationId ? { correlationId: record.correlationId } : {}),
    ...(record.callId ? { callId: record.callId } : {}),
    ...(record.parentCallId ? { parentCallId: record.parentCallId } : {}),
  }
  return Object.keys(details).length > 0 ? details : undefined
}
