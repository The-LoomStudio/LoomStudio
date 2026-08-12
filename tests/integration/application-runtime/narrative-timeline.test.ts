import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ documents, narratives })
  return { engine, runtime }
}

describe('application narrative timeline lifecycle', () => {
  it('creates a roleless timeline from a card and keeps its launch resource links stable', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({
      name: 'Alice',
      userName: 'Player',
      opening: {
        entries: [
          { role: 'user', content: '{{ User }} enters.' },
          { role: 'assistant', content: 'Alice looks up.' },
        ],
      },
    })
    await runtime.updateCardPromptResources({
      cardId: card.card.id,
      promptResourceIds: [],
    })

    const created = await runtime.createNarrativeTimelineFromCard({ cardId: card.card.id }, {
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    await runtime.updateCard({ cardId: card.card.id, name: 'Alice Changed' })
    const read = await runtime.getNarrativeTimeline({ timelineId: created.timeline.id })
    const page = await runtime.getNarrativePage({ timelineId: created.timeline.id })
    const commit = engine.database.prepare('SELECT created_by_json, correlation_id, call_id FROM changesets WHERE id = ?')
      .get(created.mutation.changesetId)

    expect(read.timeline).toMatchObject({
      title: 'Alice',
      createdFrom: { cardId: card.card.id, cardVersion: 2 },
      promptResourceIds: [],
    })
    expect(page.nodes.map(node => node.body.raw)).toEqual(['Player enters.', 'Alice looks up.'])
    expect(JSON.stringify(page.nodes)).not.toContain('role')
    expect(commit).toEqual({
      created_by_json: JSON.stringify({ kind: 'client', id: 'client-1' }),
      correlation_id: 'corr-1',
      call_id: 'call-1',
    })
    engine.close()
  })

  it('forks, switches, pages, and deletes through the Application Runtime', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({
      name: 'Story',
      opening: { entries: [{ content: 'root' }, { content: 'main' }] },
    })
    const created = await runtime.createNarrativeTimelineFromCard({ cardId: card.card.id })
    const fork = await runtime.forkNarrativeBranch({
      timelineId: created.timeline.id,
      fromBranchId: created.branch.id,
      fromNodeId: created.nodes[0]!.id,
      title: 'Alternative',
    })
    const switched = await runtime.switchNarrativeBranch({
      timelineId: created.timeline.id,
      branchId: fork.branch.id,
      expectedActiveBranchId: created.branch.id,
    })

    expect(switched.timeline.activeBranchId).toBe(fork.branch.id)
    expect((await runtime.getNarrativePage({ timelineId: created.timeline.id })).nodes.map(node => node.body.raw)).toEqual(['root'])
    const deleted = await runtime.deleteNarrativeTimeline({ timelineId: created.timeline.id })
    expect(deleted.deleted).toBe(true)
    await expect(runtime.getNarrativeTimeline({ timelineId: created.timeline.id })).rejects.toThrow('Narrative timeline not found')
    engine.close()
  })

  it('keeps existing document-only runtimes valid and reports the missing capability only on new calls', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })

    await expect(runtime.createCard({ name: 'Still works' })).resolves.toMatchObject({ card: { name: 'Still works' } })
    await expect(runtime.getNarrativeTimeline({ timelineId: 'timeline-1' })).rejects.toThrow('Narrative Store is not configured')
  })
})
