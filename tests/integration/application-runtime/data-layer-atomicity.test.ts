import { createApplicationRuntime, type CardBundleArtifact } from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore, type SqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createNarrativeStore, type NarrativeStore } from '../../../packages/narrative-store/src/index.js'
import { createPromptResourceStore } from '../../../packages/prompt-resource-store/src/index.js'
import { createMemoryLogSink, createRootLogger } from '../../../packages/logging/src/index.js'
import { withDocumentStoreLogging } from '../../../apps/studio-server/src/document-store-logging.js'
import { describe, expect, it } from 'vitest'

describe('Data Layer shared transaction atomicity', () => {
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

  it('rolls back Resource, Card, Timeline, and Mount changes when Card update fails', async () => {
    const fixture = await createDeleteFixture()
    const memory = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({
      service: 'application-runtime-atomicity-test',
      instanceId: 'document-transaction-failure',
      sinks: [memory],
    })
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: withDocumentStoreLogging(
        withFailingDocumentWrites(fixture.documents),
        root.child('document.store'),
      ),
      promptResources: fixture.promptResources,
      narratives: fixture.narratives,
    })
    const beforeChangesets = changesetCount(fixture.engine)

    try {
      await expect(runtime.deletePromptResource({ resourceId: fixture.settingId })).rejects.toThrow('injected document write failure')
      await assertDeleteState(fixture)
      expect(changesetCount(fixture.engine)).toBe(beforeChangesets)
      expect(memory.list().some(record => record.event === 'document.operation.failed')).toBe(true)
      expect(memory.list().some(record => record.event === 'document.changeset.committed')).toBe(false)
    } finally {
      await root.close()
    }
  })

  it('rolls back Resource, Card, Timeline, and Mount changes when Narrative update fails', async () => {
    const fixture = await createDeleteFixture()
    const runtime = createApplicationRuntime({
      dataEngine: fixture.engine,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
      narratives: withFailingNarrativeUpdate(fixture.narratives),
    })
    const beforeChangesets = changesetCount(fixture.engine)

    await expect(runtime.deletePromptResource({ resourceId: fixture.settingId })).rejects.toThrow('injected narrative update failure')
    await assertDeleteState(fixture)
    expect(changesetCount(fixture.engine)).toBe(beforeChangesets)
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
  await runtime.updatePresetSettings({ presetId: preset.resource.id, linkedSettingIds: [setting.resource.id] })
  const card = await runtime.createCard({ name: 'Atomic Card' })
  await runtime.updateCardPromptResources({ cardId: card.card.id, promptResourceIds: [setting.resource.id] })
  const timeline = await runtime.createNarrativeTimelineFromCard({ cardId: card.card.id })
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

function changesetCount(engine: ReturnType<typeof createSqliteDataEngine>): number {
  return (engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }).count
}

function createArtifact(): CardBundleArtifact {
  return {
    schemaVersion: 1,
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
