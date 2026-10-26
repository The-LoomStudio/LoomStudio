import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createAgentStore, createNarrativeStore, createNarrativeSwipeStore, createStateStore, type NarrativeSwipeGroup } from '@loom-studio/application-data'
import { describe, expect, it } from 'vitest'

async function setup() {
  let sequence = 0
  let id = 0
  const now = () => new Date(Date.UTC(2026, 9, 15, 0, 0, sequence++)).toISOString()
  const engine = createSqliteDataEngine({ filename: ':memory:', now, createId: prefix => `${prefix}-${++id}` })
  const swipes = createNarrativeSwipeStore({ engine, now })
  const narrative = createNarrativeStore({ engine, now })
  const state = createStateStore({ engine, now })
  const actor = { kind: 'system' as const, id: 'test' }
  const initial = await state.createScopeWithInitialRevision({ actor, scope: { kind: 'timeline', ownerId: 'timeline' }, revision: { snapshot: { coins: 100 }, operations: [] } })
  const story = await narrative.createTimeline({ actor, id: 'timeline', stateRevisionId: initial.snapshot.revision.id })
  const target = { timelineId: story.timeline.id, branchId: story.branch.id }
  const input = { ...target, actor, nodeId: 'input', expectedHeadNodeId: null, body: { format: 'loom-markdown.v1' as const, raw: 'Continue' }, reason: 'input' }
  await narrative.appendInput(input)
  const group: NarrativeSwipeGroup = {
    id: 'group', ...target, inputNodeId: 'input', input: 'Continue', baselineStateRevisionId: initial.snapshot.revision.id,
    agentSessionId: 'session', baseEntryCount: 2, candidates: [{ id: 'a', agentSessionId: 'old-session', runIds: ['run-a'],
      headNodeId: 'input', stateRevisionId: initial.snapshot.revision.id, status: 'completed', mode: 'initial', createdAt: now() }],
    selectedCandidateId: 'a', generation: 1, revision: 0, closed: false, createdAt: now(), updatedAt: now(), excludedRunIds: ['failed-edit'],
  }
  const save = (value: NarrativeSwipeGroup, expectedRevision?: number) => engine.transact({ actor }, async tx => swipes.transaction(tx).save(value, { expectedRevision }))
  return { engine, swipes, narrative, state, actor, story, target, input, group, save, initial }
}

describe('narrative Swipe storage', () => {
  it('persists communication candidates with an empty Narrative baseline and a distinct transcript baseline', async () => {
    const c = await setup()
    try {
      const baseEntryId = (await c.narrative.getNode('input'))!.entryId
      const saved = (await c.save({ ...c.group, inputKind: 'communication', inputNodeId: undefined,
        input: 'Communicate without roleplay', baseEntryId,
        candidates: [{ ...c.group.candidates[0]!, inputNodeId: undefined, headNodeId: undefined, headEntryId: baseEntryId }],
      })).value
      expect(await createNarrativeSwipeStore({ engine: c.engine }).get(saved.id)).toEqual(saved)
      expect(await c.swipes.getLatest(c.target.branchId)).toMatchObject({ inputKind: 'communication', baseEntryId })
      const workspaceRevisionId = (await c.narrative.getBranch(c.target.branchId))!.workspaceHeadRevisionId
      const restored = await c.engine.transact({ actor: c.actor }, async tx => c.narrative.transaction(tx).restoreBranch({
        ...c.target, expectedHeadNodeId: 'input', expectedStateHeadRevisionId: c.initial.snapshot.revision.id,
        headNodeId: null, headEntryId: baseEntryId, stateRevisionId: c.initial.snapshot.revision.id, workspaceRevisionId,
      }))
      expect(restored.value.headNodeId).toBeUndefined()
      expect(restored.value.headEntryId).toBe(baseEntryId)
      expect((await createAgentStore({ engine: c.engine }).getSession(c.target.timelineId))!.headEntryId).toBe(baseEntryId)
      expect(await c.narrative.getNode('input')).not.toBeNull()
    } finally { await c.engine.close() }
  })

  it('persists candidates with CAS, includes closed/session matches, and does not inherit on fork', async () => {
    const c = await setup()
    try {
      const saved = (await c.save(c.group)).value
      expect(saved.revision).toBe(1)
      expect(saved.updatedAt).not.toBe(c.group.updatedAt)
      await expect(c.save({ ...saved, candidates: [] })).rejects.toMatchObject({ code: 'narrative.swipe_revision_conflict' })
      await expect(c.save({ ...saved, candidates: [] }, 0)).rejects.toMatchObject({ code: 'narrative.swipe_revision_conflict' })
      expect(await c.swipes.get(saved.id)).toEqual(saved)
      const closed = (await c.save({ ...saved, closed: true }, 1)).value
      expect(await c.swipes.getLatest(c.target.branchId)).toEqual(closed)
      expect(await c.swipes.listForSession('old-session')).toEqual([closed])
      expect(await createNarrativeSwipeStore({ engine: c.engine }).get(saved.id)).toEqual(closed)
      const fork = await c.narrative.forkBranch({ actor: c.actor, timelineId: c.target.timelineId, fromBranchId: c.target.branchId,
        fromNodeId: 'input',})
      expect(await c.swipes.getLatest(fork.branch.id)).toBeNull()
      await c.engine.transact({ actor: c.actor }, async tx => {
        expect(c.swipes.transaction(tx).get(saved.id)).toEqual(closed)
        return c.narrative.transaction(tx).deleteTimeline({ timelineId: c.target.timelineId })
      })
      expect(await c.swipes.get(saved.id)).toBeNull()
      expect(await c.swipes.getLatest(c.target.branchId)).toBeNull()
      expect(await c.swipes.listForSession('old-session')).toEqual([])
      expect(c.engine.database.prepare('SELECT metadata_json, deleted_at FROM narrative_swipe_groups').get()).toMatchObject({ metadata_json: JSON.stringify(closed), deleted_at: expect.any(String) })
    } finally { await c.engine.close() }
  })

  it.each(['running', 'suspended'] as const)('keeps duplicate input idempotent, blocks %s, and closes only committed new input', async status => {
    const c = await setup()
    try {
      const saved = (await c.save({ ...c.group, activeCandidateId: 'a', activeRunId: 'run-a', candidates: [{ ...c.group.candidates[0]!, status }] })).value
      await c.narrative.appendInput(c.input)
      expect(await c.swipes.get(saved.id)).toEqual(saved)
      const next = { ...c.input, nodeId: 'next', expectedHeadNodeId: 'input' }
      await expect(c.narrative.appendInput(next)).rejects.toMatchObject({ code: 'narrative.swipe_active' })
      expect(await c.narrative.getNode('next')).toBeNull()
      const ready = (await c.save({ ...saved, activeRunId: undefined, candidates: c.group.candidates }, saved.revision)).value
      await expect(c.narrative.appendInput({ ...next, expectedHeadNodeId: null })).rejects.toMatchObject({ code: 'narrative.head_conflict' })
      expect(await c.swipes.get(saved.id)).toEqual(ready)
      await c.narrative.appendInput(next)
      expect(await c.swipes.get(saved.id)).toMatchObject({ closed: true, candidates: c.group.candidates, excludedRunIds: ['failed-edit'] })
    } finally { await c.engine.close() }
  })

  it('atomically adopts both existing heads, checks ownership, and preserves nodes/revisions/active branch', async () => {
    const c = await setup()
    try {
      const revision = (await c.engine.transact({ actor: c.actor }, async tx => c.state.transaction(tx).createRevision({
        scopeId: c.initial.snapshot.scope.id, parentRevisionId: c.initial.snapshot.revision.id, snapshot: { coins: 80 }, operations: [],
      }))).value.revision
      const reply = await c.narrative.appendNode({ ...c.target, actor: c.actor, expectedHeadNodeId: 'input', stateRevisionId: c.initial.snapshot.revision.id,
        body: { format: 'loom-markdown.v1', raw: 'A' } })
      await c.narrative.setBranchStateHead({ ...c.target, actor: c.actor, expectedStateHeadRevisionId: c.initial.snapshot.revision.id, stateRevisionId: revision.id })
      const other = await c.narrative.createTimeline({ actor: c.actor, stateRevisionId: revision.id, openingNode: { body: { format: 'loom-markdown.v1', raw: 'Other' } } })
      const foreign = await c.state.createScopeWithInitialRevision({ actor: c.actor, scope: { kind: 'timeline', ownerId: other.timeline.id }, revision: { snapshot: {}, operations: [] } })
      const request = { ...c.target, expectedHeadNodeId: reply.node.id, expectedStateHeadRevisionId: revision.id, headNodeId: 'input', stateRevisionId: c.initial.snapshot.revision.id }
      const restore = (input: typeof request) => c.engine.transact({ actor: c.actor }, async tx => c.narrative.transaction(tx).restoreBranch(input))
      const before = await c.narrative.getBranch(c.target.branchId)
      for (const [change, code] of [
        [{ expectedHeadNodeId: 'input' }, 'narrative.head_conflict'],
        [{ expectedStateHeadRevisionId: request.stateRevisionId }, 'narrative.state_head_conflict'],
        [{ headNodeId: other.nodes[0]!.id }, 'narrative.timeline_mismatch'],
        [{ stateRevisionId: foreign.snapshot.revision.id }, 'narrative.state_scope_mismatch'],
      ] as const) {
        await expect(restore({ ...request, ...change })).rejects.toMatchObject({ code })
        expect(await c.narrative.getBranch(c.target.branchId)).toEqual(before)
      }
      const agents = createAgentStore({ engine: c.engine })
      const entryCount = (await agents.getSession(c.target.timelineId))!.entryCount
      const inputEntryId = (await c.narrative.getNode('input'))!.entryId
      const count = c.engine.database.prepare('SELECT COUNT(*) AS count FROM state_revisions').get()
      const result = await restore(request)
      expect(result.value).toMatchObject({ headNodeId: 'input', stateHeadRevisionId: request.stateRevisionId, headEntryId: inputEntryId })
      expect(await agents.getSession(c.target.timelineId)).toMatchObject({ headEntryId: inputEntryId, entryCount })
      expect(await c.narrative.getNode(reply.node.id)).not.toBeNull()
      expect(c.engine.database.prepare('SELECT COUNT(*) AS count FROM state_revisions').get()).toEqual(count)
      expect((await c.narrative.getTimeline(c.target.timelineId))?.activeBranchId).toBe(c.target.branchId)
      await expect(c.engine.transact({ actor: c.actor }, async tx => {
        const narrativeTx = c.narrative.transaction(tx)
        expect(narrativeTx.getBranch(c.target.branchId)?.headNodeId).toBe('input')
        expect(narrativeTx.getNode(reply.node.id)?.id).toBe(reply.node.id)
        narrativeTx.restoreBranch({ ...request, expectedHeadNodeId: 'input', expectedStateHeadRevisionId: request.stateRevisionId, headNodeId: reply.node.id, stateRevisionId: revision.id })
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      expect(await c.narrative.getBranch(c.target.branchId)).toEqual(result.value)
    } finally { await c.engine.close() }
  })
})
