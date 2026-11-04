import { expect, it } from 'vitest'
import { groupObservationMessages, groupedMessageDetail } from '../../../apps/studio-client/src/features/observability/model/observation-message-groups.js'
import type { ObservationMessage } from '../../../apps/studio-client/src/features/observability/model/observation-view.js'

const assistant: ObservationMessage = { id: 'a', role: 'assistant', content: 'Checking', raw: { role: 'assistant' }, exchanges: [{ callId: 'one', name: 'read', input: '{}', status: 'unknown' }, { callId: 'two', name: 'write', status: 'unknown' }] }
const tool: ObservationMessage = { id: 'b', role: 'tool', content: 'Result', raw: { role: 'tool', tool_call_id: 'one' }, exchanges: [{ callId: 'one', result: 'Result', status: 'completed' }] }
it('groups adjacent matched results without changing source messages and preserves all raw messages', () => {
  const second = { ...tool, id: 'c', exchanges: [{ callId: 'two', result: 'Failure', status: 'failed' }] }
  const groups = groupObservationMessages([assistant, tool, second])
  expect(groups).toEqual([[assistant, tool, second]])
  const detail = groupedMessageDetail(groups[0])
  expect(detail.content).toBe('Checking')
  expect(detail.raw).toEqual([assistant.raw, tool.raw, second.raw])
  expect(detail.exchanges?.map(item => item.status)).toEqual(['completed', 'failed'])
  expect(assistant.exchanges?.[0].status).toBe('unknown')
})
it('never crosses an intervening message or absorbs unrelated and duplicate results', () => {
  const user = { id: 'user', role: 'user', content: 'Next' }
  expect(groupObservationMessages([assistant, user, tool])).toEqual([[assistant], [user], [tool]])
  const unrelated = { ...tool, exchanges: [{ callId: 'other', status: 'unknown' }] }
  expect(groupObservationMessages([assistant, unrelated, tool])).toEqual([[assistant], [unrelated], [tool]])
  expect(groupObservationMessages([assistant, tool, tool])).toEqual([[assistant, tool], [tool]])
})
