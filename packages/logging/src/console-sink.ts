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
        const reset = '\x1b[0m'
        let levelBadge = `\x1b[7;32m INFO  \x1b[0m`
        if (record.level === 'error') levelBadge = `\x1b[7;1;31m ERROR \x1b[0m`
        else if (record.level === 'warn') levelBadge = `\x1b[7;1;33m WARN  \x1b[0m`
        else if (record.level === 'debug') levelBadge = `\x1b[7;35m DEBUG \x1b[0m`
        const time = record.timestamp.length >= 23 ? record.timestamp.slice(11, 23) : record.timestamp
        const namespaceColor = '\x1b[38;2;130;165;200m'
        const nsPadded = record.namespace.padEnd(16, ' ')
        prefix = `${dim}[${time}]${reset} ${levelBadge} ${namespaceColor}${nsPadded}${reset}`
        if (details) {
          output[record.level](`${prefix} ${record.message}\n${renderTreeDetails(details)}`)
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

function renderTreeDetails(val: unknown, prefix = '  '): string {
  const reset = '\x1b[0m'
  const dim = '\x1b[2m'
  const green = '\x1b[32m'
  const yellow = '\x1b[33m'
  const magenta = '\x1b[35m'
  const cyan = '\x1b[36m'
  const red = '\x1b[31m'

  function formatScalar(v: unknown): string {
    if (v === null) return `${dim}null${reset}`
    if (v === undefined) return `${dim}undefined${reset}`
    if (typeof v === 'string') return `${green}'${v}'${reset}`
    if (typeof v === 'number') return `${yellow}${v}${reset}`
    if (typeof v === 'boolean') return `${magenta}${v}${reset}`
    if (v instanceof Error) return `${red}${v.name}: ${v.message}${reset}`
    return String(v)
  }

  function renderNode(node: unknown, currentPrefix: string): string[] {
    if (node === null || node === undefined || typeof node !== 'object') {
      return [`${currentPrefix}${formatScalar(node)}`]
    }

    if (Array.isArray(node)) {
      if (node.length === 0) return [`${currentPrefix}[]`]
      const lines: string[] = []
      node.forEach((item, idx) => {
        const isLast = idx === node.length - 1
        const branch = isLast ? '└─ ' : '├─ '
        const childPrefix = isLast ? '   ' : '│  '
        if (item !== null && typeof item === 'object') {
          lines.push(`${currentPrefix}${dim}${branch}${reset}[${idx}]`)
          lines.push(...renderNode(item, `${currentPrefix}${dim}${childPrefix}${reset}`))
        } else {
          lines.push(`${currentPrefix}${dim}${branch}${reset}[${idx}]: ${formatScalar(item)}`)
        }
      })
      return lines
    }

    const keys = Object.keys(node as object)
    if (keys.length === 0) return [`${currentPrefix}{}`]
    const lines: string[] = []
    keys.forEach((key, idx) => {
      const isLast = idx === keys.length - 1
      const branch = isLast ? '└─ ' : '├─ '
      const childPrefix = isLast ? '   ' : '│  '
      const v = (node as Record<string, unknown>)[key]

      if (v !== null && typeof v === 'object') {
        lines.push(`${currentPrefix}${dim}${branch}${reset}${cyan}${key}${reset}:`)
        lines.push(...renderNode(v, `${currentPrefix}${dim}${childPrefix}${reset}`))
      } else {
        lines.push(`${currentPrefix}${dim}${branch}${reset}${cyan}${key}${reset}: ${formatScalar(v)}`)
      }
    })
    return lines
  }

  return renderNode(val, prefix).join('\n')
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
