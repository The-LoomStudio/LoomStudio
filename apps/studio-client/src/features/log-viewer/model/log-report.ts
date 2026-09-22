import { readLogPresentation, type LogRecord } from '@loom-studio/logging'

export function selectDiagnosticContext(records: LogRecord[]): LogRecord[] {
  let failure = -1
  for (let index = records.length - 1; index >= 0; index--) {
    if (records[index]!.level === 'error' || records[index]!.level === 'warn') { failure = index; break }
  }
  return failure < 0 ? records.slice(-100) : records.slice(Math.max(0, failure - 30), failure + 21)
}

export function formatLogReport(input: {
  records: LogRecord[]
  version: string
  capturedAt: string
  scope: string
  notices: string[]
}): string {
  const rows: string[] = []
  let omitted = 0
  let length = 0
  for (const record of input.records.slice(-200)) {
    const view = readLogPresentation(record)
    const text = (key: string) => typeof record.data?.[key] === 'string' ? record.data[key].slice(0, 512) : undefined
    const number = (key: string) => typeof record.data?.[key] === 'number' ? record.data[key] : undefined
    const facts = {
      event: record.event, service: record.service, instanceId: record.instanceId,
      extension: record.extension, correlationId: record.correlationId, callId: record.callId,
      runId: text('runId'), invocationId: text('invocationId'), providerStep: number('providerStep'),
      outcome: text('outcome'), durationMs: number('durationMs'),
      usage: { inputTokens: view.inputTokens, outputTokens: view.outputTokens },
      failureType: text('failureType'), failureReason: text('failureReason'), statusCode: number('statusCode'),
    }
    const row = `${record.timestamp} ${record.level.toUpperCase()} ${record.namespace} ${record.message.slice(0, 2000)}${view.duration ? ` (${view.duration})` : ''}\n${JSON.stringify(facts)}`
    if (length + row.length > 60_000) { omitted++; continue }
    rows.push(row)
    length += row.length
  }
  return [
    'Loom Studio diagnostic report',
    `Version: ${input.version}`,
    `Captured: ${input.capturedAt}`,
    `Scope: ${input.scope}`,
    `Records: ${rows.length}; omitted by report limits: ${omitted + Math.max(0, input.records.length - 200)}`,
    `Available timestamps: ${input.records[0]?.timestamp ?? '-'} .. ${input.records.at(-1)?.timestamp ?? '-'}`,
    'Only available records are included. Browser logs are not persistent. Extension/legacy messages may contain private information; review before sharing.',
    ...input.notices.map(notice => `Notice: ${notice}`),
    '', ...rows,
  ].join('\n')
}
