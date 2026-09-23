import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createNarrativeStore, createPromptResourceStore, createStateStore } from '@loom-studio/application-data'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { handleTimelineRpc } from '../../../apps/studio-server/src/rpc/handlers/application/timeline.js'

describe('branch-local Narrative text editing', () => {
  it('persists text without changing descendants, sibling branches or State references, and rejects stale saves', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-edit-'))
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => new Date().toISOString()
    const filename = join(directory, 'data.sqlite')
    let engine = createSqliteDataEngine({ filename, createId, now })
    try {
      let store = createNarrativeStore({ engine, createId, now })
      const actor = { kind: 'system' as const, id: 'test' }
      const created = await store.createTimeline({
        actor, stateRevisionId: 'state-initial',
        openingNodes: ['First', 'Middle', 'Last'].map(raw => ({ body: { format: 'loom-markdown.v1', raw } })),
      })
      const fork = await store.forkBranch({
        actor, timelineId: created.timeline.id, fromBranchId: created.branch.id,
        fromNodeId: created.nodes[2]!.id, stateRevisionId: 'state-sibling',
      })
      await store.setBranchStateHead({
        actor, timelineId: created.timeline.id, branchId: created.branch.id,
        expectedStateHeadRevisionId: 'state-initial', stateRevisionId: 'state-later',
      })
      const states = createStateStore({ engine, createId, now })
      await engine.transact({ actor }, async tx => {
        const stateTx = states.transaction(tx)
        const scope = stateTx.createScope({ kind: 'timeline', ownerId: created.timeline.id })
        for (const id of ['state-initial', 'state-sibling', 'state-later']) {
          stateTx.createRevision({ id, scopeId: scope.id, snapshot: { marker: id }, operations: [] })
        }
      })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), narratives: store, states,
        promptResources: createPromptResourceStore({ engine, createId, now }),
      })
      const params = {
        timelineId: created.timeline.id, branchId: created.branch.id,
        nodeId: created.nodes[1]!.id, expectedHeadNodeId: created.nodes[2]!.id,
        expectedRaw: 'Middle', raw: '  Revised middle\n',
      }
      const count = (await store.listNodes(created.timeline.id)).length
      await expect(handleTimelineRpc(runtime, 'application.editNarrativeNode', { ...params, expectedRaw: 'Wrong' }))
        .rejects.toMatchObject({ code: 'narrative.body_conflict' })
      expect(await store.listNodes(created.timeline.id)).toHaveLength(count)
      await handleTimelineRpc(runtime, 'application.editNarrativeNode', params)
      const page = await store.getPage({ timelineId: created.timeline.id, branchId: created.branch.id })
      expect(page.nodes.map(node => node.body.raw)).toEqual(['First', '  Revised middle\n', 'Last'])
      expect(page.nodes[0]!.id).toBe(created.nodes[0]!.id)
      expect(page.nodes[1]!.id).not.toBe(created.nodes[1]!.id)
      expect(page.nodes[2]!.id).not.toBe(created.nodes[2]!.id)
      expect(page.nodes.map(node => node.stateRevisionId)).toEqual(created.nodes.map(node => node.stateRevisionId))
      expect(page.nodes.map(node => node.source)).toEqual(created.nodes.map(node => node.source))
      expect(page.branch.stateHeadRevisionId).toBe('state-later')
      const sibling = await store.getPage({ timelineId: created.timeline.id, branchId: fork.branch.id })
      expect(sibling.nodes).toEqual(created.nodes)
      expect(sibling.branch.stateHeadRevisionId).toBe('state-sibling')
      await expect(handleTimelineRpc(runtime, 'application.editNarrativeNode', params))
        .rejects.toMatchObject({ code: 'narrative.head_conflict' })
      expect(await store.listNodes(created.timeline.id)).toHaveLength(count + 2)
      const exported = await runtime.exportTimelineArchive({ timelineId: created.timeline.id })
      const imported = await runtime.importTimelineArchive({ source: JSON.stringify(exported.archive) })
      const restored = await store.getPage({ timelineId: imported.timelineId, branchId: imported.idMap.branchIds[created.branch.id] })
      const restoredSibling = await store.getPage({ timelineId: imported.timelineId, branchId: imported.idMap.branchIds[fork.branch.id] })
      expect(restored.nodes.map(node => node.body.raw)).toEqual(page.nodes.map(node => node.body.raw))
      expect(restoredSibling.nodes.map(node => node.body.raw)).toEqual(['First', 'Middle', 'Last'])
      expect(restored.branch.stateHeadRevisionId).toBe(imported.idMap.stateRevisionIds['state-later'])
      expect(restoredSibling.branch.forkedFromNodeId).toBe(imported.idMap.nodeIds[created.nodes[2]!.id])
      engine.close()
      engine = createSqliteDataEngine({ filename, createId, now })
      store = createNarrativeStore({ engine, createId, now })
      expect((await store.getPage({ timelineId: created.timeline.id, branchId: created.branch.id })).nodes).toEqual(page.nodes)
      expect((await store.getPage({ timelineId: created.timeline.id, branchId: fork.branch.id })).nodes).toEqual(created.nodes)
    } finally {
      engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
