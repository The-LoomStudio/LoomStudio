import { describe, expect, it } from 'vitest'
import type { NarrativeNode } from '../../../apps/studio-client/src/entities/index.js'
import { isTimelineNearBottom, readNarrativeNodeRole } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.js'

describe('NarrativeTimeline.isTimelineNearBottom', () => {
  it('follows composer growth only near the latest messages', () => {
    expect(isTimelineNearBottom({ clientHeight: 600, scrollHeight: 1200, scrollTop: 560 })).toBe(true)
    expect(isTimelineNearBottom({ clientHeight: 600, scrollHeight: 1200, scrollTop: 400 })).toBe(false)
  })
})

describe('NarrativeTimeline.readNarrativeNodeRole', () => {
  it('recognizes the user node in a persisted user-assistant Run pair', () => {
    const nodes = [
      {
        id: 'user-node',
        source: { agentSessionId: 'session-1', agentMessageId: 'message-user', runId: 'run-1' },
      },
      {
        id: 'assistant-node',
        parentNodeId: 'user-node',
        source: { agentSessionId: 'session-1', agentMessageId: 'message-assistant', runId: 'run-1' },
      },
    ] as NarrativeNode[]

    expect(readNarrativeNodeRole(nodes, 0)).toBe('user')
    expect(readNarrativeNodeRole(nodes, 1)).toBe('assistant')
  })

  it('keeps legacy standalone Narrative nodes as assistant content', () => {
    expect(readNarrativeNodeRole([{ id: 'legacy-node' } as NarrativeNode], 0)).toBe('assistant')
  })
})
