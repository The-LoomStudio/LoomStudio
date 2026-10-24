import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createNarrativeStore, createNarrativeSwipeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { ExtensionNarrativeActivity } from '@loom-studio/extension-sdk'
import { expect, it } from 'vitest'

it('reports committed narrative invalidations with exact branch heads and ignores rolled back writes', async () => {
  let sequence = 0
  const engine = createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++sequence}`, now: () => new Date().toISOString() })
  const narratives = createNarrativeStore({ engine })
  const swipes = createNarrativeSwipeStore({ engine })
  const runtime = createApplicationRuntime({ dataEngine: engine, narratives,
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine }) })
  const actor = { kind: 'system' as const, id: 'test' }
  const events: Extract<ExtensionNarrativeActivity, { kind: 'changed' }>[] = []
  const persisted: boolean[] = []
  const badListener = runtime.subscribeNarrativeActivity(() => { throw new Error('Listener failure') })
  const subscription = runtime.subscribeNarrativeActivity(event => {
    if (event.kind !== 'changed') return
    // A persisted changeset is visible inside the callback, before the API returns.
    persisted.push(Boolean(engine.database.prepare('SELECT id FROM changesets WHERE id = ?').get(event.changesetId)))
    events.push(event)
  })
  try {
    const { card } = await runtime.createCard({ name: 'Activity' })
    expect(events).toEqual([])
    const story = await runtime.createNarrativeTimeline({ cardId: card.id })
    const target = { timelineId: story.timeline.id, branchId: story.branch.id }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ...target, headNodeId: null, changesetId: story.mutation.changesetId })
    events.length = 0

    const first = await runtime.appendNarrativeInput({ ...target, nodeId: 'first', expectedHeadNodeId: null, content: 'First' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ...target, headNodeId: first.node.id, changesetId: first.mutation.changesetId })
    const fork = await runtime.forkNarrativeBranch({ timelineId: target.timelineId, fromBranchId: target.branchId, fromNodeId: first.node.id })
    expect(events.at(-1)).toMatchObject({ branchId: fork.branch.id, headNodeId: first.node.id })
    events.length = 0

    // Legacy in-place edits invalidate both paths that actually share the node.
    await narratives.editNode({ actor, timelineId: target.timelineId, nodeId: first.node.id, body: { format: 'loom-markdown.v1', raw: 'Shared' } })
    expect(events.map(event => event.branchId).sort()).toEqual([target.branchId, fork.branch.id].sort())
    events.length = 0

    // Branch-local edits must not invalidate the active branch sharing the original node.
    const edited = await runtime.editNarrativeNode({ timelineId: target.timelineId, branchId: fork.branch.id,
      nodeId: first.node.id, expectedHeadNodeId: first.node.id, expectedRaw: 'Shared', raw: 'Edited' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ branchId: fork.branch.id, headNodeId: edited.branch.headNodeId, changesetId: edited.mutation.changesetId })
    events.length = 0
    await runtime.switchNarrativeBranch({ timelineId: target.timelineId, branchId: fork.branch.id })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ branchId: fork.branch.id, headNodeId: edited.branch.headNodeId })
    events.length = 0

    // A valid write followed by a failing transaction must never escape as an event.
    await expect(engine.transact({ actor }, async tx => {
      narratives.transaction(tx).editNode({ timelineId: target.timelineId, nodeId: first.node.id, body: { format: 'loom-markdown.v1', raw: 'Rolled back' } })
      throw new Error('Abort transaction')
    })).rejects.toThrow('Abort transaction')
    expect(events).toEqual([])
    expect((await narratives.getNode(first.node.id))!.body.raw).toBe('Shared')

    // Restoration covers removal from the visible path, including an empty head.
    const restored = await engine.transact({ actor }, async tx => narratives.transaction(tx).restoreBranch({
      ...target, expectedHeadNodeId: first.node.id, expectedStateHeadRevisionId: first.branch.stateHeadRevisionId,
      headNodeId: null, stateRevisionId: story.branch.stateHeadRevisionId, workspaceRevisionId: story.branch.workspaceHeadRevisionId,
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ...target, headNodeId: null, changesetId: restored.commit.changesetId })
    events.length = 0

    // Swipe metadata alone is a committed invalidation even when the head is unchanged.
    const swipe = await engine.transact({ actor }, async tx => swipes.transaction(tx).save({
      id: 'swipe', ...target, inputNodeId: first.node.id, input: 'First', baselineStateRevisionId: story.branch.stateHeadRevisionId,
      agentSessionId: 'session', baseEntryCount: 0, candidates: [], generation: 0, revision: 0, closed: false,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ...target, headNodeId: null, changesetId: swipe.commit.changesetId })
    events.length = 0

    // Queued writes retain their own post-commit heads, not the later head.
    await Promise.all([
      runtime.appendNarrativeInput({ timelineId: target.timelineId, branchId: fork.branch.id,
        nodeId: 'queued-1', expectedHeadNodeId: edited.branch.headNodeId!, content: 'One' }),
      runtime.appendNarrativeInput({ timelineId: target.timelineId, branchId: fork.branch.id,
        nodeId: 'queued-2', expectedHeadNodeId: 'queued-1', content: 'Two' }),
    ])
    expect(events.map(event => event.headNodeId)).toEqual(['queued-1', 'queued-2'])
    expect(new Set(events.map(event => event.changesetId)).size).toBe(2)
    events.length = 0

    await runtime.deleteNarrativeTimeline({ timelineId: target.timelineId })
    expect(events.map(event => event.branchId).sort()).toEqual([target.branchId, fork.branch.id].sort())
    expect(await narratives.getTimeline(target.timelineId)).toBeNull()
    expect(persisted.length).toBeGreaterThan(0)
    expect(persisted.every(Boolean)).toBe(true)
    subscription.dispose()
    badListener.dispose()
    events.length = 0
    await runtime.createNarrativeTimeline({ cardId: card.id })
    expect(events).toEqual([])
  } finally { subscription.dispose(); badListener.dispose(); await engine.close() }
})
