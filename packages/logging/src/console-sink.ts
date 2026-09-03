import type { LogRecord, LogSink } from './types.js'

type ConsoleOutput = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>

export function createConsoleLogSink(options: {
  console?: ConsoleOutput
  filter?: (record: LogRecord) => boolean
  colorize?: boolean
} = {}): LogSink {
  const output = options.console ?? console
  const colorize = options.colorize ?? false

  return {
    name: 'console',
    write: record => {
      if (options.filter && !options.filter(record)) return
      const details = readDetails(record)
      let prefix: string
      if (colorize) {
        const dim = '\x1b[2m'
        const bold = '\x1b[1m'
        const reset = '\x1b[0m'
        let levelColor = '\x1b[36m'
        if (record.level === 'error') levelColor = '\x1b[1;31m'
        else if (record.level === 'warn') levelColor = '\x1b[1;33m'
        else if (record.level === 'info') levelColor = '\x1b[32m'
        else if (record.level === 'debug') levelColor = '\x1b[35m'
        const slate = '\x1b[38;2;140;155;175m'
        prefix = `${dim}[${record.timestamp}]${reset} ${levelColor}${record.level.toUpperCase()}${reset} ${slate}${record.service}/${reset}${bold}${record.namespace}${reset}`
      } else {
        prefix = `[${record.timestamp}] ${record.level.toUpperCase()} ${record.service}/${record.namespace}`
      }
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
