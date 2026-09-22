import { readLogPresentation, type LogLevel, type LogRecord } from '@loom-studio/logging'
import { normalizeSearchText } from '../../../shared/lib/text.js'

export function logSource(record: LogRecord): string {
  const prefix = record.namespace
  if (prefix === 'runtime.run') return 'Agent'
  if (prefix === 'runtime.step') return 'Step'
  if (prefix === 'runtime.provider') return 'Provider'
  if (prefix === 'runtime.tool') return 'Tool'
  if (prefix === 'runtime.commit') return 'Commit'
  if (prefix === 'prompt.build') return 'Prompt'
  if (prefix === 'transport.rpc') return 'RPC'
  if (prefix === 'document.store') return 'Document'
  if (prefix.startsWith('extension.')) return 'Extension'
  return prefix
}

export function filterLogRecords(records: LogRecord[], input: {
  query: string
  level: LogLevel | 'all'
  technical: boolean
  runId?: string
}): LogRecord[] {
  const query = normalizeSearchText(input.query)
  return records.filter(record =>
    (input.level === 'all' || record.level === input.level)
    && (input.technical || input.level === 'debug' || !readLogPresentation(record).technical)
    && (!input.runId || record.data?.runId === input.runId)
    && (!query || JSON.stringify(record).toLocaleLowerCase().includes(query)),
  )
}
