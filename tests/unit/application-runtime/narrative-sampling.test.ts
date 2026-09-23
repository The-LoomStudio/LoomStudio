import { createNarrativeStore } from '@loom-studio/application-data'
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

async function createTimeline() {
  const fixture = createFixture()
  const created = await fixture.narratives.createTimeline({
    actor: fixture.actor,
    stateRevisionId: 'state-0',
    openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'floor 1' } }],
  })
  let head = created.branch.headNodeId ?? null
  const nodes = [...created.nodes]
  for (let floor = 2; floor <= 5; floor += 1) {
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

  it('keeps the requested endpoint when newer nodes are appended', async () => {
    const fixture = await createTimeline()
    const sampler = createNarrativeSampler(fixture.narratives)
    try {
      const through = fixture.nodes[3]!.id
      const result = await sampler.sample({
        timelineId: fixture.timeline.id,
        branchId: fixture.branch.id,
        selection: { kind: 'range', throughNodeId: through },
      })
      const appended = await fixture.narratives.appendNode({
        actor: fixture.actor,
        timelineId: fixture.timeline.id,
        branchId: fixture.branch.id,
        expectedHeadNodeId: fixture.nodes[4]!.id,
        stateRevisionId: 'state-6',
        body: { format: 'loom-markdown.v1', raw: 'floor 6' },
      })

      expect(result.nodes.at(-1)?.id).toBe(through)
      expect(result.readHeadNodeId).toBe(fixture.nodes[4]?.id)
      expect(appended.node.id).not.toBe(result.nodes.at(-1)?.id)
    } finally {
      fixture.engine.close()
    }
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
