import { expect, it } from 'vitest'
import { projectTimelinePositions } from '../../../packages/application-runtime/src/agents/timeline-position.js'
import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import { retainRunPresentation } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-run-observer.js'
import { mapObservationStep } from '../../../apps/studio-client/src/features/observability/model/observation-mapping.js'
import type { AgentTranscriptEntry, NarrativeNode } from '@loom-studio/application-data'

const entry = (id: string, sequence: number, runId: string, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
  id, sequence, agentSessionId: 'story', createdAt: '', runId, roundId: 'shared-candidate', entry: data,
})
const node = (id: string, entryId: string, floor: number): NarrativeNode => ({
  id, entryId, floor, stateRevisionId: 'state', workspaceRevisionId: 'workspace', kind: 'narrative', timelineId: 'story', body: { format: 'loom-markdown.v1', raw: id }, createdAt: '',
})

it('keeps separate inputs in order even when they share a candidate and identical replies', () => {
  const history = [
    entry('opening', 1, 'writer', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'prose', content: 'prose' }),
    entry('first', 2, 'run-1', { kind: 'message', role: 'user', content: 'edit' }),
    entry('reply-1', 3, 'run-1', { kind: 'message', role: 'assistant', content: 'done' }),
    entry('second', 4, 'run-2', { kind: 'message', role: 'user', content: 'read image' }),
    entry('reply-2', 5, 'run-2', { kind: 'message', role: 'assistant', content: 'done' }),
  ]
  const projected = projectTimelinePositions(history)
  const group = projectTimelineRounds(projected, [node('prose', 'opening', 1)], 'Writer')[0]!.communications[0]!
  expect(group.discussions.map(item => [item.inputEntryId, item.steps.map(step => step.id)])).toEqual([
    ['first', ['reply-1']], ['second', ['reply-2']],
  ])
  expect(projectTimelinePositions(structuredClone(history))).toEqual(projected)
})

it('anchors post-prose reasoning after prose and keeps resumed work in the same exchange', () => {
  const history = [
    entry('user', 1, 'run', { kind: 'message', role: 'user', content: 'write' }),
    entry('prose-entry', 2, 'run', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'prose', content: 'story' }),
    entry('resume', 3, 'resumed', { kind: 'run-state', state: 'running', sourceRunId: 'run' }),
    entry('thought', 4, 'resumed', { kind: 'reasoning', content: 'after', source: 'provider-native', visibility: 'collapsed', replay: 'omit' }),
  ]
  expect(projectTimelinePositions(history).at(-1)?.timelinePosition).toEqual({ anchorNodeId: 'prose', exchangeId: 'user' })
})

it('uses an exact stored node reference when a historical message has no narrativeId', () => {
  const history = [entry('prose-entry', 1, 'run', { kind: 'message', role: 'assistant', content: 'story' })]
  expect(projectTimelinePositions(history, [node('prose', 'prose-entry', 1)])[0]?.timelinePosition?.anchorNodeId).toBe('prose')
})

it('does not merge an exchange whose input is outside the loaded page into main work', () => {
  const reply = { ...entry('reply', 3, 'run', { kind: 'message', role: 'assistant', content: 'reply' }),
    timelinePosition: { anchorNodeId: 'prose', exchangeId: 'unloaded-input' } }
  const group = projectTimelineRounds([reply], [node('prose', 'opening', 1)], 'Writer')[0]!.communications[0]!
  expect(group.discussions.map(item => item.id)).toEqual(['unloaded-input'])
  expect(group.discussions[0]?.steps.map(item => item.id)).toEqual(['reply'])
  expect(group.execution.steps).toEqual([])
})

it('does not move the cursor backwards when an older narrative is revised', () => {
  const old = { ...node('revision', 'edit', 1), source: { runId: 'original', agentSessionId: 'story', agentMessageId: 'original-entry' } }
  const history = [
    entry('current', 1, 'writer', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'current-prose', content: 'current' }),
    entry('edit', 2, 'editor', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'revision', content: 'edited' }),
  ]
  expect(projectTimelinePositions(history, [old]).at(-1)?.timelinePosition?.anchorNodeId).toBe('current-prose')
})

it('retains presentation by stream identity, never equal text', () => {
  const draft = { ...entry('streaming-text', 3, 'run', { kind: 'message', role: 'assistant', content: 'same', streamId: 'run:2:text' }), presentationId: 'visible' }
  const previous = entry('previous', 1, 'run', { kind: 'message', role: 'assistant', content: 'same', streamId: 'run:1:text' })
  const saved = entry('saved', 4, 'run', { kind: 'message', role: 'assistant', content: 'transformed', streamId: 'run:2:text' })
  expect(retainRunPresentation([draft], [previous, saved]).map(item => item.presentationId)).toEqual([undefined, 'visible'])
})

it('exposes recorded reasoning independently of assistant text', () => {
  const record = { id: 'request', kind: 'request' as const, title: '', status: 'completed' as const, capturedAt: '', updatedAt: '', expiresAt: '', availability: 'recorded' as const,
    request: { response: { reasoning: 'recorded thought', message: { role: 'assistant', content: '' } } } }
  const step = mapObservationStep(record, record)
  expect(step.reasoning?.content).toBe('recorded thought')
  expect(step.response).toBeUndefined()
})
