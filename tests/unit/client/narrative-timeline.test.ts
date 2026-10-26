import { describe, expect, it } from 'vitest'
import type { NarrativeNode } from '../../../apps/studio-client/src/entities/index.js'
import { readNarrativeNodeRole, resolveNarrativeDisplayText } from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.js'

describe('NarrativeTimeline.readNarrativeNodeRole', () => {
  it('uses persisted input identity even when generation failed and no reply follows', () => {
    expect(readNarrativeNodeRole([{ id: 'input', kind: 'user-input' } as NarrativeNode], 0)).toBe('user')
  })

  it('does not infer role from node IDs, sources, or neighboring nodes', () => {
    const nodes = [
      { id: 'optimistic-looking', kind: 'narrative' },
      { id: 'plain', kind: 'user-input', source: { runId: 'run', agentSessionId: 'session' } },
      { id: 'reply', kind: 'narrative', parentNodeId: 'plain', source: { runId: 'run', agentSessionId: 'session' } },
    ] as NarrativeNode[]
    expect(nodes.map((_, index) => readNarrativeNodeRole(nodes, index))).toEqual(['assistant', 'user', 'assistant'])
  })
})

describe('NarrativeTimeline.resolveNarrativeDisplayText (FE-035)', () => {
  it('uses projected text directly when available', () => {
    expect(resolveNarrativeDisplayText('projected content', 'raw content')).toBe('projected content')
  })

  it('gracefully falls back to raw text when projection errors out without cache', () => {
    expect(resolveNarrativeDisplayText(undefined, 'raw content', undefined, { error: 'Failed to fetch' })).toBe('raw content')
  })

  it('retains cached display text during error if raw text matches', () => {
    expect(resolveNarrativeDisplayText(undefined, 'raw content', { raw: 'raw content', text: 'cached projected' }, { error: 'Failed to fetch' })).toBe('cached projected')
  })

  it('falls back to raw text when cache belongs to previous edited raw text during error', () => {
    expect(resolveNarrativeDisplayText(undefined, 'new raw content', { raw: 'old raw content', text: 'old projected' }, { error: 'Failed to fetch' })).toBe('new raw content')
  })

  it('shows empty string while pending on cold mount without cached display', () => {
    expect(resolveNarrativeDisplayText(undefined, 'raw content', undefined, { pending: true })).toBe('')
  })

  it('keeps cached display text while re-projecting in pending state', () => {
    expect(resolveNarrativeDisplayText(undefined, 'raw content', { raw: 'raw content', text: 'cached' }, { pending: true })).toBe('cached')
  })
})
