import { createNarrativeStore } from '@loom-studio/application-data'
import type { NarrativeStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { describe, expect, it } from 'vitest'
import { createNarrativeSampler } from '../../../packages/application-runtime/src/narrative/sampling.js'
import { createCodeActContext } from '../../../packages/application-runtime/src/agents/codeact/context.js'
import { runCodeActSandbox } from '../../../packages/application-runtime/src/agents/codeact/sandbox.js'

function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => `2026-09-22T00:00:${String(sequence).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  return {
    engine,
    narratives,
    actor: { kind: 'system' as const, id: 'test' },
  }
}

async function createTimeline(count = 5) {
  const fixture = createFixture()
  const created = await fixture.narratives.createTimeline({
    actor: fixture.actor,
    stateRevisionId: 'state-0',
    openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'floor 1' } }],
  })
  let head = created.branch.headNodeId ?? null
  const nodes = [...created.nodes]
  for (let floor = 2; floor <= count; floor += 1) {
    const result = await fixture.narratives.appendNode({
      actor: fixture.actor,
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      expectedHeadNodeId: head,
      stateRevisionId: `state-${floor}`,
      body: { format: 'loom-markdown.v1', raw: `floor ${floor}` },
    })
    nodes.push(result.node)
    head = result.node.id
  }
  return { ...fixture, timeline: created.timeline, branch: created.branch, nodes }
}

describe('Narrative sampling', () => {
  it('reads a tail and an exclusive-after range from a fixed branch head', async () => {
    const fixture = await createTimeline()
    const sampler = createNarrativeSampler(fixture.narratives)
    try {
      const tail = await sampler.sample({
        timelineId: fixture.timeline.id,
        branchId: fixture.branch.id,
        selection: { kind: 'tail', count: 3 },
      })
      expect(tail.nodes.map(node => node.body.raw)).toEqual(['floor 3', 'floor 4', 'floor 5'])
      expect(tail.readHeadNodeId).toBe(fixture.nodes[4]?.id)
      expect(tail.complete).toBe(true)
      expect(tail.nextBeforeNodeId).toBeUndefined()

      const range = await sampler.sample({
        timelineId: fixture.timeline.id,
        branchId: fixture.branch.id,
        selection: {
          kind: 'range',
          afterNodeId: fixture.nodes[1]?.id,
          throughNodeId: fixture.nodes[3]?.id,
        },
      })
      expect(range.nodes.map(node => node.body.raw)).toEqual(['floor 3', 'floor 4'])
      expect(range.text).toBe('floor 3\n\nfloor 4')
    } finally {
      fixture.engine.close()
    }
  })

  it('keeps the endpoint and branch when a write and branch switch occur between pages', async () => {
    const fixture = await createTimeline(105)
    let pages = 0
    const store: NarrativeStore = {
      ...fixture.narratives,
      getPage: async input => {
        const page = await fixture.narratives.getPage(input)
        if (++pages === 1) {
          await fixture.narratives.appendNode({
            actor: fixture.actor, timelineId: fixture.timeline.id, branchId: fixture.branch.id,
            expectedHeadNodeId: fixture.nodes.at(-1)!.id, stateRevisionId: 'new-state',
            body: { format: 'loom-markdown.v1', raw: 'NEW_NOT_REQUESTED' },
          })
          const fork = await fixture.narratives.forkBranch({
            actor: fixture.actor, timelineId: fixture.timeline.id, fromBranchId: fixture.branch.id,
            fromNodeId: fixture.nodes[1]!.id, stateRevisionId: 'fork-state',
          })
          await fixture.narratives.switchBranch({
            actor: fixture.actor, timelineId: fixture.timeline.id, branchId: fork.branch.id,
          })
        }
        return page
      },
    }
    const sampler = createNarrativeSampler(store)
    try {
      const result = await sampler.sample({
        timelineId: fixture.timeline.id,
        selection: { kind: 'tail', count: 105 },
      })
      expect(result.nodes.map(node => node.id)).toEqual(fixture.nodes.map(node => node.id))
      expect(result.readHeadNodeId).toBe(fixture.nodes.at(-1)!.id)
      expect(result.branchId).toBe(fixture.branch.id)
      expect(result.complete).toBe(true)
    } finally {
      fixture.engine.close()
    }
  })

  it('resumes a budgeted range without duplicate or omitted nodes across pages', async () => {
    const fixture = await createTimeline(105)
    try {
      const sampler = createNarrativeSampler(fixture.narratives)
      const afterNodeId = fixture.nodes[1]!.id
      let throughNodeId: string | undefined = fixture.nodes.at(-1)!.id
      const ids: string[] = []
      while (throughNodeId) {
        const result = await sampler.sample({
          timelineId: fixture.timeline.id, branchId: fixture.branch.id,
          selection: { kind: 'range', afterNodeId, throughNodeId }, maxNodes: 40,
        })
        ids.unshift(...result.nodes.map(node => node.id))
        expect(result.complete).toBe(result.nextBeforeNodeId === undefined)
        throughNodeId = result.nextBeforeNodeId
      }
      expect(ids).toEqual(fixture.nodes.slice(2).map(node => node.id))
      expect(new Set(ids).size).toBe(ids.length)
    } finally { fixture.engine.close() }
  })

  it('validates empty, equal, reversed and cross-branch endpoints', async () => {
    const fixture = await createTimeline()
    try {
      const sampler = createNarrativeSampler(fixture.narratives)
      const request = { timelineId: fixture.timeline.id, branchId: fixture.branch.id }
      const nodeId = fixture.nodes[2]!.id
      expect(await sampler.sample({ ...request, selection: { kind: 'range', afterNodeId: nodeId, throughNodeId: nodeId } }))
        .toMatchObject({ nodes: [], complete: true })
      await expect(sampler.sample({
        ...request, selection: { kind: 'range', afterNodeId: fixture.nodes[3]!.id, throughNodeId: nodeId },
      })).rejects.toThrow(/not an ancestor/)
      const fork = await fixture.narratives.forkBranch({
        actor: fixture.actor, timelineId: fixture.timeline.id, fromBranchId: fixture.branch.id,
        fromNodeId: fixture.nodes[0]!.id, stateRevisionId: 'fork',
      })
      await expect(sampler.sample({
        ...request, branchId: fork.branch.id, selection: { kind: 'tail', count: 3, throughNodeId: nodeId },
      })).rejects.toMatchObject({ code: 'narrative.cursor_not_in_branch' })
      const empty = await fixture.narratives.createTimeline({ actor: fixture.actor, stateRevisionId: 'empty' })
      await expect(sampler.sample({
        timelineId: empty.timeline.id, selection: { kind: 'range', afterNodeId: nodeId },
      })).rejects.toThrow(/not an ancestor/)
      expect(await sampler.sample({ timelineId: empty.timeline.id, selection: { kind: 'tail', count: 3 } }))
        .toMatchObject({ nodes: [], text: '', complete: true })
    } finally { fixture.engine.close() }
  })

  it('counts node separators, rejects oversized nodes and validates untrusted selectors', async () => {
    const fixture = await createTimeline()
    try {
      await fixture.narratives.editNode({
        actor: fixture.actor, timelineId: fixture.timeline.id, nodeId: fixture.nodes[4]!.id,
        body: { format: 'loom-markdown.v1', raw: 'x' },
      })
      const sampler = createNarrativeSampler(fixture.narratives)
      const request = { timelineId: fixture.timeline.id, selection: { kind: 'tail' as const, count: 2 } }
      const sample = await sampler.sample({ ...request, maxCharacters: 7 })
      expect(sample.text.length).toBeLessThanOrEqual(7)
      expect(sample.nodes.map(node => node.id)).toEqual([fixture.nodes[4]!.id])
      expect(sample.complete).toBe(false)
      await expect(sampler.sample({
        ...request, selection: { kind: 'tail', count: 1, throughNodeId: fixture.nodes[0]!.id }, maxCharacters: 1,
      })).rejects.toThrow(/single node/)
      for (const selection of [null, { kind: 'tail', count: -1 }, { kind: 'range', throughNodeId: 3 }]) {
        await expect(sampler.sample({ ...request, selection } as never)).rejects.toThrow()
      }
      await expect(sampler.sample({ ...request, maxCharacters: Number.MAX_SAFE_INTEGER })).rejects.toThrow(/up to/)
    } finally { fixture.engine.close() }
  })

  it('stops reading after cancellation between pages', async () => {
    const fixture = await createTimeline(105)
    const controller = new AbortController()
    let reads = 0
    try {
      const sampler = createNarrativeSampler({
        ...fixture.narratives, getPage: async input => {
          reads++
          const page = await fixture.narratives.getPage(input)
          controller.abort()
          return page
        },
      })
      await expect(sampler.sample({
        timelineId: fixture.timeline.id, selection: { kind: 'tail', count: 105 },
      }, controller.signal)).rejects.toThrow()
      expect(reads).toBe(1)
    } finally { fixture.engine.close() }
  })

  it('reports a resumable tail when the character budget omits older nodes', async () => {
    const fixture = await createTimeline()
    const sampler = createNarrativeSampler(fixture.narratives)
    try {
      const result = await sampler.sample({
        timelineId: fixture.timeline.id,
        branchId: fixture.branch.id,
        selection: { kind: 'range', throughNodeId: fixture.nodes[4]?.id },
        maxCharacters: 7,
      })
      expect(result.nodes.map(node => node.body.raw)).toEqual(['floor 5'])
      expect(result.complete).toBe(false)
      expect(result.nextBeforeNodeId).toBe(fixture.nodes[3]?.id)
    } finally {
      fixture.engine.close()
    }
  })

  it('exposes the bound sampler to CodeAct without exposing another timeline', async () => {
    const fixture = await createTimeline()
    const sampler = createNarrativeSampler(fixture.narratives)
    try {
      const context = createCodeActContext({
        context: [],
        narrative: {
          timelineId: fixture.timeline.id,
          branchId: fixture.branch.id,
          sample: input => sampler.sample({
            ...input,
            timelineId: fixture.timeline.id,
            branchId: fixture.branch.id,
          }),
          appendNode: async () => ({ nodeId: 'unused' }),
          editNode: async () => ({ nodeId: 'unused' }),
        },
      })
      const result = await context.methods.readNarrative!([
        { selection: { kind: 'tail', count: 2 } },
      ], new AbortController().signal) as { nodes: Array<{ body: { raw: string } }> }
      expect(result.nodes.map(node => node.body.raw)).toEqual(['floor 4', 'floor 5'])
      await expect(context.methods.readNarrative!([
        { timelineId: 'other', selection: { kind: 'tail', count: 2 } },
      ], new AbortController().signal)).rejects.toMatchObject({ code: 'codeact.invalid_arguments' })
      await expect(context.methods.readNarrative!([
        { view: 'other', selection: { kind: 'tail', count: 2 } },
      ], new AbortController().signal)).rejects.toMatchObject({ code: 'codeact.invalid_arguments' })
      const execution = await runCodeActSandbox({
        source: 'const story = await ctx["readNarrative"]({ selection: { kind: "tail", count: 2 } }); print(story.text);',
        methods: context.methods,
        signal: new AbortController().signal,
      })
      expect(execution.status).toBe('completed')
      expect(execution.output).toBe('floor 4\n\nfloor 5')
    } finally {
      fixture.engine.close()
    }
  })
})
