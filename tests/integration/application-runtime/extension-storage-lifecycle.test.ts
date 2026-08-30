import { createAgentStore } from '@loom-studio/agent-store'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

describe('application Extension Storage lifecycle', () => {
  it('tombstones Timeline and Agent Session scoped data atomically while preserving other scopes', async () => {
    let nextId = 0
    let nextTime = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => `2026-08-27T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId, now })
    const narratives = createNarrativeStore({ engine, createId, now })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({ agents, dataEngine: engine, documents, narratives, promptResources })

    const card = await runtime.createCard({ name: 'Lifecycle Card' })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    await documents.write({
      id: 'profile-1',
      type: 'airp.agentProfile',
      content: {
        name: 'Lifecycle Agent',
        presetId: 'unused-in-this-test',
        model: { providerProfileId: 'provider-1', modelId: 'model-1' },
        toolOverrides: {},
        createdAt: now(),
        updatedAt: now(),
      },
      expectedVersion: 'new',
      actor: { kind: 'kernel', id: 'test' },
    })
    const session = await runtime.createAgentSession({ agentProfileId: 'profile-1' })

    await writeStorageDocument(documents, 'card-config', 'airp.extensionConfig', {
      scope: { kind: 'card', cardId: card.card.id },
      key: 'portrait-style',
      value: 'painted',
    })
    await writeStorageDocument(documents, 'card-record', 'airp.extensionRecord', {
      scope: { kind: 'card', cardId: card.card.id },
      recordType: 'defaults',
      data: { inherited: true },
      bindings: [],
    })

    await writeStorageDocument(documents, 'timeline-config', 'airp.extensionConfig', {
      scope: { kind: 'timeline', timelineId: timeline.timeline.id },
      key: 'theme',
      value: { accent: 'violet' },
    })
    await writeStorageDocument(documents, 'timeline-record', 'airp.extensionRecord', {
      scope: { kind: 'timeline', timelineId: timeline.timeline.id },
      recordType: 'memory',
      data: { summary: 'Timeline memory' },
      bindings: [],
    })
    await writeStorageDocument(documents, 'session-config', 'airp.extensionConfig', {
      scope: { kind: 'agent-session', agentSessionId: session.session.id },
      key: 'mode',
      value: 'focused',
    })
    await writeStorageDocument(documents, 'session-record', 'airp.extensionRecord', {
      scope: { kind: 'agent-session', agentSessionId: session.session.id },
      recordType: 'trace',
      data: { ok: true },
      bindings: [],
    })
    await writeStorageDocument(documents, 'global-record', 'airp.extensionRecord', {
      scope: { kind: 'global' },
      recordType: 'defaults',
      data: { enabled: true },
      bindings: [],
    })
    const bulkTimelineRecordIds = Array.from({ length: 205 }, (_, index) => `timeline-bulk-${index}`)
    for (const id of bulkTimelineRecordIds) {
      await writeStorageDocument(documents, id, 'airp.extensionRecord', {
        scope: { kind: 'timeline', timelineId: timeline.timeline.id },
        recordType: 'memory',
        data: { id },
        bindings: [],
      })
    }

    await expect(runtime.previewCardDeletion({ cardId: card.card.id })).resolves.toMatchObject({
      extensionData: {
        cardScoped: { configs: 1, records: 1 },
        timelineScoped: { configs: 1, records: 206 },
      },
      timelines: [{ id: timeline.timeline.id }],
    })

    const cardDelete = await runtime.deleteCard({ cardId: card.card.id, includePlayData: true })
    const cardChangeset = await documents.getChangeset(cardDelete.mutation.changesetId)
    expect(cardChangeset?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', documentId: 'card-config' }),
      expect.objectContaining({ kind: 'delete', documentId: 'card-record' }),
      expect.objectContaining({ kind: 'delete', documentId: 'timeline-config' }),
      expect.objectContaining({ kind: 'delete', documentId: 'timeline-record' }),
      expect.objectContaining({ kind: 'delete', documentId: 'timeline-bulk-204' }),
    ]))
    expect(cardChangeset?.operations.filter(operation => operation.type === 'airp.extensionRecord')).toHaveLength(207)
    await expectTombstoned(documents, ['card-config', 'card-record', 'timeline-config', 'timeline-record', ...bulkTimelineRecordIds])
    await expectLive(documents, ['session-config', 'session-record', 'global-record'])

    const sessionDelete = await runtime.deleteAgentSession({ agentSessionId: session.session.id })
    const sessionChangeset = await documents.getChangeset(sessionDelete.mutation.changesetId)
    expect(sessionChangeset?.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'delete', documentId: 'session-config' }),
      expect.objectContaining({ kind: 'delete', documentId: 'session-record' }),
    ]))
    await expectTombstoned(documents, ['session-config', 'session-record'])
    await expectLive(documents, ['global-record'])

    engine.close()
  })
})

async function writeStorageDocument(
  documents: ReturnType<typeof createSqliteDocumentStore>,
  id: string,
  type: 'airp.extensionConfig' | 'airp.extensionRecord',
  content: Record<string, unknown>,
) {
  await documents.write({
    id,
    type,
    content: {
      ...content,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:00:00.000Z',
    } as never,
    expectedVersion: 'new',
    actor: { kind: 'extension', id: 'example.lifecycle' },
    meta: { ownerExtensionId: 'example.lifecycle' },
  })
}

async function expectTombstoned(
  documents: ReturnType<typeof createSqliteDocumentStore>,
  ids: string[],
) {
  for (const id of ids) {
    expect((await documents.get(id, { includeTombstone: true }))?.meta.tombstone).toBeDefined()
  }
}

async function expectLive(
  documents: ReturnType<typeof createSqliteDocumentStore>,
  ids: string[],
) {
  for (const id of ids) {
    expect(await documents.get(id)).not.toBeNull()
  }
}
