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
  it('keeps Timeline runtime dependencies after deleting its source Card', async () => {
    const { engine, runtime } = createTestRuntime()
    const imported = await runtime.importCardBundle({ artifact: {
      schemaVersion: 2,
      artifactId: 'detached-card',
      displayName: 'Detached Card',
      card: { name: 'Detached Card', opening: { entries: [{ content: 'Ready.' }] } },
      contextAssets: [],
      stateTemplates: [{
        id: 'template.detached', templateVersion: 1,
        schema: { type: 'object', properties: { value: { type: 'number', minimum: 0 } }, required: ['value'], additionalProperties: false },
        initial: { value: 1 },
      }],
      timelineStateBindings: [{ path: 'detached', templateId: 'template.detached', templateVersion: 1 }],
    } })
    const timeline = await runtime.createNarrativeTimeline({ cardId: imported.card.id })
    const initial = await runtime.getStateSnapshot({ target: { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id } })

    await expect(runtime.deleteCard({ cardId: imported.card.id })).resolves.toMatchObject({ deleted: true })
    await expect(runtime.getNarrativeTimeline({ timelineId: timeline.timeline.id })).resolves.toMatchObject({ timeline: { id: timeline.timeline.id } })
    await expect(runtime.applyStateMutation({
      target: initial.snapshot.target,
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'set', path: '/detached/value', value: -1 }],
    })).rejects.toMatchObject({ code: 'state.schema_minimum' })
    engine.close()
  })

  it('previews and optionally deletes play data with its source Card', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Disposable Card' })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })

    await expect(runtime.previewCardDeletion({ cardId: card.card.id })).resolves.toMatchObject({
      cardId: card.card.id,
      timelines: [{ id: timeline.timeline.id, title: 'Disposable Card' }],
    })
    await expect(runtime.deleteCard({ cardId: card.card.id, includePlayData: true })).resolves.toMatchObject({ deleted: true })
    await expect(runtime.getNarrativeTimeline({ timelineId: timeline.timeline.id })).rejects.toThrow()
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id },
    })).rejects.toThrow()
    engine.close()
  })

  it('initializes timeline State atomically from Card bindings and advances the branch head on mutation', async () => {
    const { engine, runtime } = createTestRuntime()
    const imported = await runtime.importCardBundle({
      artifact: {
        schemaVersion: 2,
        artifactId: 'stateful-card',
        displayName: 'Stateful Card',
        card: {
          name: 'Alice',
          opening: { entries: [
            { content: 'Gold: {{timeline.characters.alice.gold}}' },
            { content: 'The story begins.' },
          ] },
        },
        contextAssets: [],
        stateTemplates: [{
          id: 'template.person',
          templateVersion: 1,
          schema: {
            type: 'object',
            properties: { gold: { type: 'number', minimum: 0 } },
            required: ['gold'],
            additionalProperties: false,
          },
          initial: { gold: 10 },
        }],
        timelineStateBindings: [{ path: 'characters.alice', templateId: 'template.person', templateVersion: 1 }],
      },
    })
    const created = await runtime.createNarrativeTimeline({ cardId: imported.card.id })
    const initial = await runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: created.branch.id },
    })
    const updated = await runtime.applyStateMutation({
      target: initial.snapshot.target,
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'increment', path: '/characters/alice/gold', by: -3 }],
    })

    expect(created.nodes[0]).toMatchObject({
      stateRevisionId: initial.snapshot.revisionId,
      body: { raw: 'Gold: 10' },
    })
    expect(updated.snapshot.value).toEqual({ characters: { alice: { gold: 7 } } })
    const fork = await runtime.forkNarrativeBranch({
      timelineId: created.timeline.id,
      fromBranchId: created.branch.id,
      fromNodeId: created.nodes.at(-1)!.id,
      title: 'After state-only mutation',
    })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: fork.branch.id },
    })).resolves.toMatchObject({ snapshot: { revisionId: updated.snapshot.revisionId, value: { characters: { alice: { gold: 7 } } } } })
    const forkUpdated = await runtime.applyStateMutation({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: fork.branch.id },
      expectedRevisionId: updated.snapshot.revisionId,
      operations: [{ op: 'increment', path: '/characters/alice/gold', by: 5 }],
    })
    const historicalFork = await runtime.forkNarrativeBranch({
      timelineId: created.timeline.id,
      fromBranchId: created.branch.id,
      fromNodeId: created.nodes[0]!.id,
      title: 'Historical state',
    })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: historicalFork.branch.id },
    })).resolves.toMatchObject({ snapshot: { value: { characters: { alice: { gold: 10 } } } } })
    await runtime.switchNarrativeBranch({
      timelineId: created.timeline.id,
      branchId: fork.branch.id,
      expectedActiveBranchId: created.branch.id,
    })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: fork.branch.id },
    })).resolves.toMatchObject({ snapshot: { revisionId: forkUpdated.snapshot.revisionId, value: { characters: { alice: { gold: 12 } } } } })
    await runtime.switchNarrativeBranch({
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      expectedActiveBranchId: fork.branch.id,
    })
    await expect(runtime.getStateSnapshot({ target: initial.snapshot.target })).resolves.toMatchObject({
      snapshot: { revisionId: updated.snapshot.revisionId, value: { characters: { alice: { gold: 7 } } } },
    })
    await runtime.revertChangeset({ changesetId: forkUpdated.mutation.changesetId })
    const revertedFork = await runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: fork.branch.id },
    })
    expect(revertedFork.snapshot.value).toEqual({ characters: { alice: { gold: 7 } } })
    expect(revertedFork.snapshot.revisionId).not.toBe(updated.snapshot.revisionId)
    expect(engine.database.prepare('SELECT id FROM state_revisions WHERE id = ?').get(forkUpdated.snapshot.revisionId))
      .toEqual({ id: forkUpdated.snapshot.revisionId })
    await expect(runtime.applyStateMutation({
      target: initial.snapshot.target,
      expectedRevisionId: updated.snapshot.revisionId,
      operations: [{ op: 'increment', path: '/characters/alice/gold', by: -20 }],
    })).rejects.toMatchObject({ code: 'state.schema_minimum' })
    engine.close()
  })

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

    const created = await runtime.createNarrativeTimeline({ cardId: card.card.id }, {
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
    const created = await runtime.createNarrativeTimeline({ cardId: card.card.id })
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
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: created.timeline.id, branchId: created.branch.id },
    })).rejects.toMatchObject({ code: 'state.timeline_not_initialized' })
    engine.close()
  })

  it('detaches a deleted Prompt Resource from Cards, Presets, and Narrative Timelines', async () => {
    const { engine, runtime } = createTestRuntime()
    const resource = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Temporary Setting' })
    const card = await runtime.createCard({ name: 'Story' })
    await runtime.updateCardPromptResources({ cardId: card.card.id, promptResourceIds: [resource.resource.id] })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Test Agent' })
    await runtime.replaceSettingMounts({ source: { kind: 'preset', id: preset.resource.id }, settingResourceIds: [resource.resource.id] })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })

    const deleted = await runtime.deletePromptResource({ resourceId: resource.resource.id })

    expect(deleted.detachedReferences).toEqual({ cards: 1, presets: 1, timelines: 1 })
    await expect(runtime.getPromptResource({ resourceId: resource.resource.id })).rejects.toThrow('Prompt resource not found')
    await expect(runtime.getCard({ cardId: card.card.id })).resolves.toMatchObject({ card: { promptResourceIds: [] } })
    await expect(runtime.listSettingMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toEqual({ mounts: [] })
    await expect(runtime.getNarrativeTimeline({ timelineId: timeline.timeline.id })).resolves.toMatchObject({ timeline: { promptResourceIds: [] } })
    engine.close()
  })

  it('requires the shared Prompt Resource Store and Data Engine', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    expect(() => createApplicationRuntime({ documents: createInMemoryDocumentStore() })).toThrow('Prompt Resource Store is required')
  })
})
