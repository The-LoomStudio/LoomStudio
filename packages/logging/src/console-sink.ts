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
        let levelBadge = `\x1b[32mINFO \x1b[0m`
        if (record.level === 'error') levelBadge = `\x1b[1;31mERROR\x1b[0m`
        else if (record.level === 'warn') levelBadge = `\x1b[1;33mWARN \x1b[0m`
        else if (record.level === 'debug') levelBadge = `\x1b[35mDEBUG\x1b[0m`
        const time = record.timestamp.length >= 23 ? record.timestamp.slice(11, 23) : record.timestamp
        const namespaceColor = '\x1b[38;2;130;165;200m'
        prefix = `${dim}[${time}]${reset} ${levelBadge} ${namespaceColor}${record.namespace}${reset}:`
        if (details) {
          output[record.level](`${prefix} ${record.message}\n${colorizeObject(details, 1)}`)
        } else {
          output[record.level](`${prefix} ${record.message}`)
        }
      } else {
        prefix = `[${record.timestamp}] ${record.level.toUpperCase()} ${record.service}/${record.namespace}`
        if (details) output[record.level](prefix, record.message, details)
        else output[record.level](prefix, record.message)
      }
    },
  }
}

function colorizeObject(val: unknown, depth = 0, indent = '  '): string {
  const reset = '\x1b[0m'
  const dim = '\x1b[2m'
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const magenta = '\x1b[35m'
  const cyan = '\x1b[36m'
  const red = '\x1b[31m'

  if (val === null) return `${dim}null${reset}`
  if (val === undefined) return `${dim}undefined${reset}`
  if (typeof val === 'string') return `${green}'${val}'${reset}`
  if (typeof val === 'number') return `${yellow}${val}${reset}`
  if (typeof val === 'boolean') return `${magenta}${val}${reset}`
  if (val instanceof Error) {
    return `${red}${val.name}: ${val.message}${reset}`
  }

  const spaces = indent.repeat(depth)
  const nextSpaces = indent.repeat(depth + 1)

  if (Array.isArray(val)) {
    if (val.length === 0) return '[]'
    const items = val.map(item => `${nextSpaces}${colorizeObject(item, depth + 1, indent)}`).join(',\n')
    return `[\n${items}\n${spaces}]`
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val)
    if (keys.length === 0) return '{}'
    const entries = keys.map(k => {
      const v = (val as Record<string, unknown>)[k]
      return `${nextSpaces}${cyan}${k}${reset}: ${colorizeObject(v, depth + 1, indent)}`
    }).join(',\n')
    return `{\n${entries}\n${spaces}}`
  }

  return String(val)
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
