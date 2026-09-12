import {
  createTimelineArchiveParticipantRegistry,
  parseTimelineArchive,
  serializeTimelineArchive,
  type TimelineArchiveParticipant,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import type { NarrativeBranch, NarrativeNode, NarrativeTimeline } from '@loom-studio/narrative-store'
import type { StateRevision, StateScope } from '@loom-studio/state-store'

const input = {
  timelineId: 'timeline-new',
  idMap: {
    timelineId: 'timeline-new',
    branchIds: { 'branch-old': 'branch-new' },
    nodeIds: { 'node-old': 'node-new' },
    stateRevisionIds: { 'revision-old': 'revision-new' },
  },
}

describe('Timeline archive participants', () => {
  it('round-trips the v1 core archive and rejects incomplete graphs', () => {
    const timeline = { id: 'timeline-1', activeBranchId: 'branch-1', promptResourceIds: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as NarrativeTimeline
    const branch = { id: 'branch-1', timelineId: 'timeline-1', stateHeadRevisionId: 'revision-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as NarrativeBranch
    const node = { id: 'node-1', timelineId: 'timeline-1', stateRevisionId: 'revision-1', body: { format: 'loom-markdown.v1', raw: 'Opening' }, createdAt: '2026-01-01T00:00:00Z' } as NarrativeNode
    const scope = { id: 'scope-1', kind: 'timeline', ownerId: 'timeline-1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as StateScope
    const revision = { id: 'revision-1', scopeId: 'scope-1', snapshot: {}, operations: [], changesetId: 'change-1', createdAt: '2026-01-01T00:00:00Z' } as StateRevision
    const source = serializeTimelineArchive({ format: 'loom-timeline-archive.v1', exportedAt: '2026-01-01T00:00:00Z', timeline, branches: [branch], nodes: [node], state: { scope, revisions: [revision] }, participants: [] })
    expect(parseTimelineArchive(source).timeline.id).toBe('timeline-1')
    expect(() => parseTimelineArchive(source.replace('branch-1', 'missing-branch'))).toThrow('active branch')
  })

  it('exports namespaced blocks in stable order and imports with the new ID map', async () => {
    const calls: unknown[] = []
    const registry = createTimelineArchiveParticipantRegistry([
      participant('memory.zeta', 2, payload => payload, value => calls.push(value)),
      participant('memory.alpha', 1, () => ({ entries: ['remembered'] }), value => calls.push(value)),
    ])

    const blocks = await registry.exportParticipants({ timelineId: 'timeline-old', branchIds: ['branch-old'], nodeIds: ['node-old'], stateRevisionIds: ['revision-old'] })
    expect(blocks).toEqual([
      { namespace: 'memory.alpha', version: 1, payload: { entries: ['remembered'] } },
      { namespace: 'memory.zeta', version: 2, payload: { timelineId: 'timeline-old' } },
    ])
    const result = await registry.importParticipants({
      ...input,
      blocks: [{ namespace: 'memory.alpha', version: 1, payload: { entries: ['remembered'] } }, { namespace: 'future.memory', version: 1, payload: {} }],
    })
    expect(result).toEqual({ unknownNamespaces: ['future.memory'], failures: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ timelineId: 'timeline-new', idMap: input.idMap })
  })

  it('rejects invalid and duplicate namespaces, and unregisters only its own participant', () => {
    const registry = createTimelineArchiveParticipantRegistry()
    expect(() => registry.register(participant('Memory.Bad', 1))).toThrow('namespace')
    const first = participant('memory.same', 1)
    const second = participant('memory.same', 2)
    const handle = registry.register(first)
    expect(() => registry.register(second)).toThrow('already registered')
    handle.unregister()
    expect(registry.list()).toEqual([])
  })
})

function participant(
  namespace: string,
  version: number,
  exportValue: (input: { timelineId: string }) => unknown = input => input,
  importValue: (input: unknown) => void = () => {},
): TimelineArchiveParticipant {
  return {
    namespace,
    version,
    export: input => exportValue({ timelineId: input.timelineId }),
    import: importValue,
  }
}
