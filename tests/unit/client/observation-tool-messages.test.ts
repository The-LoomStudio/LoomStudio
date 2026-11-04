import { expect, it } from 'vitest'
import { toolMessageExchanges } from '../../../apps/studio-client/src/features/observability/model/observation-tool-messages.js'

const request = { role: 'assistant', content: 'checking', tool_calls: [{ id: 'a', function: { name: 'read', arguments: '{"path":"x"}' } }] }
const result = { role: 'tool', tool_call_id: 'a', content: 'Saved changes; error mentioned in documentation' }
it('pairs requests and outputs by ID and uses explicit execution status', () => {
  const paired = toolMessageExchanges([request, result], [{ callId: 'a', status: 'completed' }])
  expect(paired[1]?.[0]).toMatchObject({ name: 'read', input: '{"path":"x"}', result: result.content, status: 'completed' })
  expect(paired[0]?.[0].result).toBe(result.content)
})
it('does not infer success or failure from tool output prose or unrelated executions', () => {
  expect(toolMessageExchanges([request, result], [{ callId: 'other', status: 'failed' }])[1]?.[0].status).toBe('unknown')
})
it('shows unmatched output without inventing request parameters', () => {
  expect(toolMessageExchanges([result], [])[0]?.[0]).toMatchObject({ input: undefined, name: undefined, status: 'unknown', result: result.content })
})
