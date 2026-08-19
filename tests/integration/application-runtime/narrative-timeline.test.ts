import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, promptResources })
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

  it('detaches a deleted Prompt Resource from Cards, Presets, and Narrative Timelines', async () => {
    const { engine, runtime } = createTestRuntime()
    const resource = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Temporary Setting' })
    const card = await runtime.createCard({ name: 'Story' })
    await runtime.updateCardPromptResources({ cardId: card.card.id, promptResourceIds: [resource.resource.id] })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Test Agent' })
    await runtime.updatePresetSettings({ presetId: preset.resource.id, linkedSettingIds: [resource.resource.id] })
    const timeline = await runtime.createNarrativeTimelineFromCard({ cardId: card.card.id })

    const deleted = await runtime.deletePromptResource({ resourceId: resource.resource.id })

    expect(deleted.detachedReferences).toEqual({ cards: 1, presets: 1, timelines: 1 })
    await expect(runtime.getPromptResource({ resourceId: resource.resource.id })).rejects.toThrow('Prompt resource not found')
    await expect(runtime.getCard({ cardId: card.card.id })).resolves.toMatchObject({ card: { promptResourceIds: [] } })
    await expect(runtime.getPromptResource({ resourceId: preset.resource.id })).resolves.toMatchObject({ resource: { linkedSettingIds: [] } })
    await expect(runtime.getNarrativeTimeline({ timelineId: timeline.timeline.id })).resolves.toMatchObject({ timeline: { promptResourceIds: [] } })
    engine.close()
  })

  it('requires the shared Prompt Resource Store and Data Engine', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    expect(() => createApplicationRuntime({ documents: createInMemoryDocumentStore() })).toThrow('Prompt Resource Store is required')
  })
})
