import { createApplicationRuntime, createStateContributionRegistry, type StateContributionRegistry } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime(options?: { stateContributions?: StateContributionRegistry }) {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, promptResources, stateContributions: options?.stateContributions })
  return { documents, engine, runtime }
}

describe('application narrative timeline lifecycle', () => {
  it('applies only selected Extension State contributions and freezes them into a new Timeline', async () => {
    const stateContributions = createStateContributionRegistry()
    const registration = stateContributions.register({
      packageId: 'example.health',
      moduleId: 'server',
      instanceId: 'instance-1',
      packageVersion: '1.0.0',
      contribution: {
        id: 'example.health.character-vitals',
        entityTypes: [],
        templates: [{
          id: 'example.health.character-vitals',
          templateVersion: 1,
          componentKey: 'vitals',
          targetEntityTypeIds: ['character'],
          schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
          initial: { hp: 100 },
        }],
        entities: [],
        componentMounts: [{
          templateId: 'example.health.character-vitals',
          templateVersion: 1,
          componentKey: 'vitals',
          target: { kind: 'entity-type', typeId: 'character' },
        }],
        bindings: [],
      },
    })
    const { documents, engine, runtime } = createTestRuntime({ stateContributions })
    const card = await runtime.createCard({ name: 'Extension World' })
    await runtime.updateCard({
      cardId: card.card.id,
      stateEntityTypes: [{ id: 'character', collectionPath: 'entities.characters' }],
      timelineStateEntities: [{ typeId: 'character', entityId: 'alice' }],
      stateContributionIds: ['example.health.character-vitals'],
    })

    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const target = { scope: 'timeline' as const, timelineId: timeline.timeline.id, branchId: timeline.branch.id }
    await expect(runtime.getStateSnapshot({ target })).resolves.toMatchObject({
      snapshot: { value: { entities: { characters: { alice: { components: { vitals: { hp: 100 } } } } } } },
    })
    await expect(documents.get(`timeline-runtime-context:${timeline.timeline.id}`)).resolves.toMatchObject({
      content: { stateContributionSources: [{ contributionId: 'example.health.character-vitals', packageVersion: '1.0.0' }] },
    })

    registration.dispose()
    await expect(runtime.getStateSnapshot({ target })).resolves.toMatchObject({ snapshot: { value: { entities: expect.any(Object) } } })
    await expect(runtime.createNarrativeTimeline({ cardId: card.card.id })).rejects.toThrow('State contribution is not registered')
    engine.close()
  })

  it('rejects stale Card saves without overwriting the latest content', async () => {
    const { engine, runtime } = createTestRuntime()
    const created = await runtime.createCard({ name: 'Concurrent Card' })
    await runtime.updateCard({
      cardId: created.card.id,
      expectedVersion: created.card.version,
      name: 'Latest Card',
    })

    await expect(runtime.updateCard({
      cardId: created.card.id,
      expectedVersion: created.card.version,
      name: 'Stale Card',
    })).rejects.toThrow('Document version conflict')
    await expect(runtime.getCard({ cardId: created.card.id })).resolves.toMatchObject({
      card: { name: 'Latest Card', version: created.card.version + 1 },
    })
    engine.close()
  })

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

  it('updates Card with self-contained stateTemplates and materializes timeline state without global definitions', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Self-Contained Hero' })
    const updatedCard = await runtime.updateCard({
      cardId: card.card.id,
      stateTemplates: [{
        id: 'core_stats',
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { hp: { type: 'number', minimum: 0 } },
          required: ['hp'],
          additionalProperties: false,
        },
        initial: { hp: 100 },
      }],
      timelineStateBindings: [
        { path: 'characters.hero', templateId: 'core_stats', templateVersion: 1 },
      ],
    })

    expect(updatedCard.card.stateTemplates).toHaveLength(1)
    expect(updatedCard.card.timelineStateBindings).toHaveLength(1)

    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const snapshot = await runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id },
    })

    expect(snapshot.snapshot.value).toEqual({
      characters: {
        hero: { hp: 100 },
      },
    })
    engine.close()
  })

  it('initializes explicit entities, components, and reference metadata from Card state contribution fields', async () => {
    const { documents, engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'EC World' })
    await runtime.updateCard({
      cardId: card.card.id,
      stateTemplates: [
        {
          id: 'character.inventory', templateVersion: 1, componentKey: 'inventory', targetEntityTypeIds: ['character'],
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: { type: 'object', 'x-loom-entity-ref': { allowedTypeIds: ['item'] } },
              },
            },
            required: ['items'],
          },
          initial: { items: [] },
        },
        {
          id: 'character.vitals', templateVersion: 1, componentKey: 'vitals', targetEntityTypeIds: ['character'],
          schema: { type: 'object', properties: { hp: { type: 'number', minimum: 0 } }, required: ['hp'] },
          initial: { hp: 100 },
        },
        {
          id: 'item.identity', templateVersion: 1, componentKey: 'identity', targetEntityTypeIds: ['item'],
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          initial: { name: '未命名物品' },
        },
      ],
      stateEntityTypes: [
        { id: 'character', collectionPath: 'entities.characters' },
        { id: 'item', collectionPath: 'entities.items' },
      ],
      timelineStateEntities: [
        { typeId: 'character', entityId: 'alice' },
        { typeId: 'item', entityId: 'silver-sword' },
      ],
      timelineComponentMounts: [
        {
          templateId: 'character.inventory', templateVersion: 1, componentKey: 'inventory',
          target: { kind: 'entity', entity: { typeId: 'character', entityId: 'alice' } },
          initial: { items: [{ typeId: 'item', entityId: 'silver-sword' }] },
        },
        {
          templateId: 'character.vitals', templateVersion: 1, componentKey: 'vitals',
          target: { kind: 'entity-type', typeId: 'character' },
        },
        {
          templateId: 'item.identity', templateVersion: 1, componentKey: 'identity',
          target: { kind: 'entity', entity: { typeId: 'item', entityId: 'silver-sword' } },
          initial: { name: '银之剑' },
        },
      ],
    })

    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const target = { scope: 'timeline' as const, timelineId: timeline.timeline.id, branchId: timeline.branch.id }
    const snapshot = await runtime.getStateSnapshot({ target })
    expect(snapshot.snapshot.value).toEqual({
      entities: {
        characters: {
          alice: {
            components: {
              inventory: { items: [{ typeId: 'item', entityId: 'silver-sword' }] },
              vitals: { hp: 100 },
            },
          },
        },
        items: {
          'silver-sword': { components: { identity: { name: '银之剑' } } },
        },
      },
    })

    const runtimeContext = await documents.get(`timeline-runtime-context:${timeline.timeline.id}`)
    expect(runtimeContext?.content).toMatchObject({
      stateEntityTypes: [{ id: 'character' }, { id: 'item' }],
      stateEntities: [{ typeId: 'character', entityId: 'alice' }, { typeId: 'item', entityId: 'silver-sword' }],
      stateComponents: expect.arrayContaining([
        expect.objectContaining({ path: 'entities.characters.alice.components.inventory' }),
        expect.objectContaining({ path: 'entities.characters.alice.components.vitals' }),
        expect.objectContaining({ path: 'entities.items.silver-sword.components.identity' }),
      ]),
      stateReferences: [{
        path: 'entities.characters.alice.components.inventory.items.*',
        annotation: { allowedTypeIds: ['item'] },
      }],
    })

    await expect(runtime.applyStateMutation({
      target,
      expectedRevisionId: snapshot.snapshot.revisionId,
      operations: [{
        op: 'set',
        path: '/entities/characters/alice/components/inventory/items/0',
        value: { typeId: 'character', entityId: 'alice' },
      }],
    })).rejects.toMatchObject({ code: 'state.entity_ref_type_invalid' })
    engine.close()
  })

  it('prefers same-id inline templates and leaves existing Timeline state unchanged', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.upsertStateDefinition({
      definitionId: 'template.shared',
      definition: {
        kind: 'timeline-template',
        templateVersion: 1,
        schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
        initial: { hp: 1 },
      },
    })
    const card = await runtime.createCard({ name: 'Inline Priority' })
    await runtime.updateCard({
      cardId: card.card.id,
      stateTemplates: [{
        id: 'template.shared', templateVersion: 1,
        schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
        initial: { hp: 10 },
      }],
      stateDefinitionIds: ['template.shared'],
      timelineStateBindings: [{ path: 'hero', templateId: 'template.shared', templateVersion: 1 }],
    })
    const first = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: first.timeline.id, branchId: first.branch.id },
    })).resolves.toMatchObject({ snapshot: { value: { hero: { hp: 10 } } } })

    await runtime.updateCard({
      cardId: card.card.id,
      stateTemplates: [{
        id: 'template.shared', templateVersion: 1,
        schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
        initial: { hp: 20 },
      }],
      timelineStateBindings: [{ path: 'hero', templateId: 'template.shared', templateVersion: 1 }],
    })

    const second = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: second.timeline.id, branchId: second.branch.id },
    })).resolves.toMatchObject({ snapshot: { value: { hero: { hp: 20 } } } })
    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: first.timeline.id, branchId: first.branch.id },
    })).resolves.toMatchObject({ snapshot: { value: { hero: { hp: 10 } } } })

    await expect(runtime.updateCard({
      cardId: card.card.id,
      stateTemplates: [{
        id: 'template.shared', templateVersion: 1,
        schema: { type: 'object', properties: { hp: { type: 'number' } }, required: ['hp'] },
        initial: { hp: 30 },
      }],
      timelineStateBindings: [{ path: 'hero', templateId: 'template.shared', templateVersion: 2 }],
    })).rejects.toThrow('template version mismatch')
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
