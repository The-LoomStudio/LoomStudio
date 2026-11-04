import type { ObservationToolExchange } from './observation-view.js'

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Pair by recorded IDs only. Result prose is never evidence of execution status. */
export function toolMessageExchanges(messages: unknown[], evidence: unknown[]): Array<ObservationToolExchange[] | undefined> {
  const executions = new Map<string, Record<string, unknown>>()
  for (const value of evidence) {
    const entry = object(value)
    const id = entry?.callId ?? object(entry?.input)?.providerItemId
    if (typeof id === 'string' && entry) executions.set(id, entry)
  }
  const calls = new Map<string, { name?: string; input?: unknown; index: number }>()
  const output: Array<ObservationToolExchange[] | undefined> = messages.map(() => undefined)
  messages.forEach((value, index) => {
    const message = object(value)
    if (message?.role === 'assistant' && Array.isArray(message.tool_calls)) {
      output[index] = message.tool_calls.flatMap(value => {
        const call = object(value), fn = object(call?.function)
        if (typeof call?.id !== 'string') return []
        const execution = executions.get(call.id)
        const name = typeof fn?.name === 'string' ? fn.name : undefined
        calls.set(call.id, { name, input: fn?.arguments, index })
        return [{ callId: call.id, name, input: fn?.arguments, status: typeof execution?.status === 'string' ? execution.status : 'unknown' }]
      })
    }
    if (message?.role === 'tool') {
      const id = typeof message.tool_call_id === 'string' ? message.tool_call_id : undefined
      const call = id ? calls.get(id) : undefined
      const execution = id ? executions.get(id) : undefined
      const exchange: ObservationToolExchange = {
        callId: id, name: call?.name ?? (typeof execution?.name === 'string' ? execution.name : undefined),
        input: call?.input ?? execution?.input, result: message.content,
        status: typeof execution?.status === 'string' ? execution.status : 'unknown',
      }
      output[index] = [exchange]
      if (call) {
        const invocation = output[call.index]?.find(item => item.callId === id)
        if (invocation) Object.assign(invocation, { result: message.content, status: exchange.status })
      }
    }
  })
  return output
}
