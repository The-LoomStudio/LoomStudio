import {
  createTimelineArchiveParticipantRegistry,
  parseTimelineArchive,
  type TimelineArchiveParticipant,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@loom-studio/shared'

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
  it('rejects the retired v1 archive format', () => {
    expect(() => parseTimelineArchive(JSON.stringify({ format: 'loom-timeline-archive.v1' })))
      .toThrow('Unsupported Timeline archive format')
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

  it('composes preserved payload IDs through repeated imports and rejects unmapped targets', async () => {
    const calls: any[] = []
    const registry = createTimelineArchiveParticipantRegistry([participant('memory.saved', 1, undefined, value => calls.push(value))])
    const block = { namespace: 'memory.saved', version: 1, payload: { nodeId: 'original' },
      idMap: { timelineId: 'old', branchIds: {}, nodeIds: { original: 'node-old' }, stateRevisionIds: {} } }
    expect(await registry.importParticipants({ ...input, blocks: [block] })).toEqual({ failures: [], unknownNamespaces: [] })
    expect(calls[0].idMap.nodeIds).toEqual({ original: 'node-new' })
    expect(calls[0].idMap.timelineId).toBe('timeline-new')
    block.idMap.nodeIds.original = 'outside'
    expect(await registry.importParticipants({ ...input, blocks: [block] })).toMatchObject({ failures: [{ namespace: 'memory.saved' }] })
    expect(calls).toHaveLength(1)
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
  exportValue: (input: { timelineId: string }) => JsonValue = input => input,
  importValue: (input: unknown) => void = () => {},
): TimelineArchiveParticipant {
  return {
    namespace,
    version,
    export: input => exportValue({ timelineId: input.timelineId }),
    import: importValue,
  }
}
