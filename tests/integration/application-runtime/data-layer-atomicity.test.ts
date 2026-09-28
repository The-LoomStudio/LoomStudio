import { createApplicationRuntime, type CardBundleArtifact } from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore, type SqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createNarrativeStore, type NarrativeStore } from '../../../packages/application-data/src/index.js'
import { createPromptResourceStore } from '../../../packages/application-data/src/index.js'
import { createMemoryLogSink, createRootLogger } from '../../../packages/logging/src/index.js'
import { withDocumentStoreLogging } from '../../../apps/studio-server/src/logging/document-store-logging.js'
import { describe, expect, it } from 'vitest'

describe('Data Layer shared transaction atomicity', () => {
  it('commits only one competing Card edit from the same version', async () => {
    const fixture = createFixture()
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
    })
    try {
      const { card } = await runtime.createCard({ name: 'Original' })
      const beforeChangesets = changesetCount(fixture.engine)
      const beforeRevisions = tableCount(fixture.engine, 'document_revisions')
      const results = await Promise.allSettled([
        runtime.updateCard({ cardId: card.id, expectedVersion: card.version, name: 'Editor A' }),
        runtime.updateCard({ cardId: card.id, expectedVersion: card.version, name: 'Editor B' }),
      ])
      const accepted = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
      expect(accepted).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toEqual([
        expect.objectContaining({ reason: expect.objectContaining({ code: 'document.conflict' }) }),
      ])
      const saved = accepted[0]!.card
      expect(saved.version).toBe(card.version + 1)
      expect((await runtime.getCard({ cardId: card.id })).card).toEqual(saved)
      expect(changesetCount(fixture.engine)).toBe(beforeChangesets + 1)
      expect(tableCount(fixture.engine, 'document_revisions')).toBe(beforeRevisions + 1)
    } finally {
      await fixture.engine.close()
    }
  })

  it('rolls back Card bundle import when a Document write fails', async () => {
    const fixture = createFixture()
    const documents = withFailingDocumentWrites(fixture.documents)
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents,
      promptResources: fixture.promptResources,
    })

    await expect(runtime.importCardBundle({ artifact: createArtifact() })).rejects.toThrow('injected document write failure')
    expect((await documents.list({ type: 'airp.cardSource' })).items).toHaveLength(0)
    expect((await documents.list({ type: 'airp.importBundle' })).items).toHaveLength(0)
    expect((await fixture.promptResources.listResources()).resources).toHaveLength(0)
    expect(changesetCount(fixture.engine)).toBe(0)
  })

  it('rolls back resource deletion when its header revision cannot be stored', async () => {
    const fixture = await createDeleteFixture()
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
      narratives: fixture.narratives,
    })
    const beforeChangesets = changesetCount(fixture.engine)
    const beforeRevisions = tableCount(fixture.engine, 'prompt_resource_header_revisions')
    fixture.engine.database.exec(`
      CREATE TRIGGER reject_header_revision AFTER INSERT ON prompt_resource_header_revisions
      BEGIN SELECT RAISE(ABORT, 'injected resource revision failure'); END;
    `)
    try {
      await expect(runtime.deletePromptResource({ resourceId: fixture.settingId })).rejects.toThrow('injected resource revision failure')
      await assertDeleteState(fixture)
      expect(changesetCount(fixture.engine)).toBe(beforeChangesets)
      expect(tableCount(fixture.engine, 'prompt_resource_header_revisions')).toBe(beforeRevisions)
    } finally {
      await fixture.engine.close()
    }
  })

  it('deletes a referenced Setting without attempting Card or Timeline writes', async () => {
    const fixture = await createDeleteFixture()
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: withFailingDocumentWrites(fixture.documents),
      promptResources: fixture.promptResources,
      narratives: withFailingNarrativeUpdate(fixture.narratives),
    })
    const beforeChangesets = changesetCount(fixture.engine)
    const beforeCard = await fixture.documents.get(fixture.cardId)
    const beforeTimeline = await fixture.narratives.getTimeline(fixture.timelineId)
    const beforeMounts = await fixture.promptResources.listSettingMounts({ settingResourceId: fixture.settingId })
    try {
      await expect(runtime.deletePromptResource({ resourceId: fixture.settingId })).resolves.toMatchObject({
        deleted: true, detachedReferences: { cards: 0, timelines: 0, presets: 0 },
      })
      await expect(fixture.promptResources.getResource(fixture.settingId)).resolves.toBeNull()
      await expect(fixture.documents.get(fixture.cardId)).resolves.toEqual(beforeCard)
      await expect(fixture.narratives.getTimeline(fixture.timelineId)).resolves.toEqual(beforeTimeline)
      await expect(fixture.promptResources.listSettingMounts({ settingResourceId: fixture.settingId })).resolves.toEqual(beforeMounts)
      expect(changesetCount(fixture.engine)).toBe(beforeChangesets + 1)
    } finally {
      await fixture.engine.close()
    }
  })

  it('rolls back Timeline State Scope and Revision when Narrative creation fails', async () => {
    const fixture = createFixture()
    const importRuntime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
      narratives: fixture.narratives,
    })
    const imported = await importRuntime.importCardBundle({ artifact: createStatefulArtifact() })
    const beforeScopes = tableCount(fixture.engine, 'state_scopes')
    const beforeRevisions = tableCount(fixture.engine, 'state_revisions')
    const beforeTimelines = tableCount(fixture.engine, 'narrative_timelines')
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
      narratives: withFailingNarrativeCreate(fixture.narratives),
    })

    await expect(runtime.createNarrativeTimeline({ cardId: imported.card.id }))
      .rejects.toThrow('injected narrative create failure')
    expect(tableCount(fixture.engine, 'state_scopes')).toBe(beforeScopes)
    expect(tableCount(fixture.engine, 'state_revisions')).toBe(beforeRevisions)
    expect(tableCount(fixture.engine, 'narrative_timelines')).toBe(beforeTimelines)
  })

  it('successfully deletes unreferenced PromptResource when DocumentStore is wrapped with logging', async () => {
    const fixture = createFixture()
    const memory = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({
      service: 'application-runtime-atomicity-test',
      instanceId: 'logging-delete-success',
      sinks: [memory],
    })
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: withDocumentStoreLogging(fixture.documents, root.child('document.store')),
      promptResources: fixture.promptResources,
      narratives: fixture.narratives,
    })

    const standaloneSetting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Standalone Lore' })
    const standalonePreset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Standalone Preset' })

    const deleteSettingResult = await runtime.deletePromptResource({ resourceId: standaloneSetting.resource.id })
    expect(deleteSettingResult.deleted).toBe(true)

    const deletePresetResult = await runtime.deletePromptResource({ resourceId: standalonePreset.resource.id })
    expect(deletePresetResult.deleted).toBe(true)
    await root.close()
  })
})

function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-08-19T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  return { engine, documents, promptResources, narratives }
}

async function createDeleteFixture() {
  const fixture = createFixture()
  const runtime = createApplicationRuntime({
    dataEngine: fixture.engine,
    documents: fixture.documents,
    promptResources: fixture.promptResources,
    narratives: fixture.narratives,
  })
  const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Atomic Setting' })
  const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Atomic Preset' })
  await runtime.replaceSettingMounts({ source: { kind: 'preset', id: preset.resource.id }, settingResourceIds: [setting.resource.id] })
  const card = await runtime.createCard({ name: 'Atomic Card' })
  await runtime.updateCardPromptResources({ cardId: card.card.id, promptResourceIds: [setting.resource.id] })
  const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
  return {
    ...fixture,
    cardId: card.card.id,
    settingId: setting.resource.id,
    timelineId: timeline.timeline.id,
  }
}

async function assertDeleteState(fixture: Awaited<ReturnType<typeof createDeleteFixture>>): Promise<void> {
  await expect(fixture.promptResources.getResource(fixture.settingId)).resolves.toMatchObject({ id: fixture.settingId })
  await expect(fixture.documents.get(fixture.cardId)).resolves.toMatchObject({
    content: { promptResourceIds: [fixture.settingId] },
  })
  await expect(fixture.narratives.getTimeline(fixture.timelineId)).resolves.toMatchObject({
    promptResourceIds: [fixture.settingId],
  })
  await expect(fixture.promptResources.listSettingMounts({ settingResourceId: fixture.settingId })).resolves.toHaveLength(1)
}

function withFailingDocumentWrites(documents: SqliteDocumentStore): SqliteDocumentStore {
  return {
    ...documents,
    participateTransaction: (dataTx, callback) => documents.participateTransaction(dataTx, async transaction => callback({
      ...transaction,
      write: async () => {
        throw new Error('injected document write failure')
      },
    })),
  }
}

function withFailingNarrativeUpdate(narratives: NarrativeStore): NarrativeStore {
  return {
    ...narratives,
    transaction: dataTx => {
      const transaction = narratives.transaction(dataTx)
      return {
        ...transaction,
        updatePromptResources: () => {
          throw new Error('injected narrative update failure')
        },
      }
    },
  }
}

function withFailingNarrativeCreate(narratives: NarrativeStore): NarrativeStore {
  return {
    ...narratives,
    transaction: dataTx => ({
      ...narratives.transaction(dataTx),
      createTimeline: () => { throw new Error('injected narrative create failure') },
    }),
  }
}

function changesetCount(engine: ReturnType<typeof createSqliteDataEngine>): number {
  return (engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }).count
}

function tableCount(engine: ReturnType<typeof createSqliteDataEngine>, table: string): number {
  return (engine.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

function createArtifact(): CardBundleArtifact {
  return {
    schemaVersion: 4,
    artifactId: 'atomic-card-bundle',
    displayName: 'Atomic Card Bundle',
    card: { name: 'Atomic Import' },
    contextAssets: [{
      id: 'atomic-preset',
      label: 'Atomic Preset',
      category: 'preset',
      kind: 'module',
      children: [],
    }],
  }
}

function createStatefulArtifact(): CardBundleArtifact {
  return {
    schemaVersion: 4,
    artifactId: 'atomic-state-card',
    displayName: 'Atomic State Card',
    card: { name: 'Atomic State' },
    contextAssets: [],
    stateTemplates: [{
      id: 'template.atomic', templateVersion: 1,
      schema: { type: 'object', properties: { gold: { type: 'number' } }, required: ['gold'] },
      initial: { gold: 10 },
    }],
    timelineStateBindings: [{ path: 'player', templateId: 'template.atomic', templateVersion: 1 }],
  }
}
