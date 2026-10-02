import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it, vi } from 'vitest'

function setup() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-10-02T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const agents = createAgentStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, agents, narratives })
  return { engine, documents, agents, narratives, runtime }
}

describe('application Extension Config runtime', () => {
  it.each(['card', 'timeline', 'agent-session'] as const)('serializes %s Config writes with deletion in both commit orders', async kind => {
    for (const writeFirst of [true, false]) {
      const { engine, documents, agents, narratives, runtime } = setup()
      try {
        const { card } = await runtime.createCard({ name: 'Owner' })
        const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
        const { session } = await agents.createSession({
          actor: { kind: 'system', id: 'test' }, agentPresetId: 'test-preset', timelineId: timeline.id,
        })
        const scope = kind === 'card' ? { kind, cardId: card.id }
          : kind === 'timeline' ? { kind, timelineId: timeline.id }
            : { kind, agentSessionId: session.id }
        const input = { packageId: 'example.settings', target: { kind: 'card' as const, cardId: card.id }, scope, key: 'enabled', value: true }
        let ready!: () => void
        let release!: () => void
        const started = new Promise<void>(resolve => { ready = resolve })
        const gate = new Promise<void>(resolve => { release = resolve })
        let held = false
        const participate = documents.participateTransaction.bind(documents)
        const hold = vi.spyOn(documents, 'participateTransaction').mockImplementation((tx, callback, options) =>
          participate(tx, async transaction => {
            const value = await callback(transaction)
            if (!held) {
              held = true
              ready()
              await gate
            }
            return value
          }, options))
        // Any outer store read during Config validation would reenter the engine.
        const outerReads = [
          vi.spyOn(agents, 'getSession').mockRejectedValue(new Error('Outer Session read forbidden')),
          vi.spyOn(narratives, 'getTimeline').mockRejectedValue(new Error('Outer Timeline read forbidden')),
        ]
        const remove = () => runtime.deleteCard({ cardId: card.id, includePlayData: true })
        try {
          if (writeFirst) {
            const writing = runtime.upsertExtensionConfig(input)
            await started
            const deletion = remove()
            const stale = expect(deletion).rejects.toThrow('Card deletion snapshot changed')
            release()
            const config = await writing
            await stale
            expect(await documents.get(config.config.id)).not.toBeNull()
            await remove()
            expect(await documents.get(config.config.id)).toBeNull()
            expect((await documents.get(config.config.id, { includeTombstone: true }))?.meta.tombstone).toBeDefined()
          } else {
            const deletion = remove()
            await started
            const writing = runtime.upsertExtensionConfig(input)
            const rejected = expect(writing).rejects.toThrow('not found')
            release()
            await deletion
            await rejected
          }
          await expect(runtime.upsertExtensionConfig(input)).rejects.toThrow('not found')
          expect((await documents.list({ type: 'airp.extensionConfig' })).items).toEqual([])
        } finally {
          release()
          hold.mockRestore()
          for (const read of outerReads) read.mockRestore()
        }
      } finally { await engine.close() }
    }
  })

  it('checks Card installation ownership for Session scopes inside the shared transaction', async () => {
    const { engine, agents, runtime } = setup()
    try {
      const { card } = await runtime.createCard({ name: 'Owner' })
      const { card: otherCard } = await runtime.createCard({ name: 'Other' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: otherCard.id })
      const actor = { kind: 'system' as const, id: 'test' }
      const standalone = await agents.createSession({ actor, agentPresetId: 'test-preset' })
      const other = await agents.createSession({ actor, agentPresetId: 'test-preset', timelineId: timeline.id })
      for (const session of [standalone.session, other.session]) {
        await expect(runtime.upsertExtensionConfig({
          packageId: 'example.settings', target: { kind: 'card', cardId: card.id },
          scope: { kind: 'agent-session', agentSessionId: session.id }, key: 'enabled', value: true,
        })).rejects.toThrow('Session is outside this Card installation')
      }
      await expect(runtime.upsertExtensionConfig({
        packageId: 'example.settings', scope: { kind: 'agent-session', agentSessionId: standalone.session.id }, key: 'enabled', value: true,
      })).resolves.toMatchObject({ config: { value: true } })
    } finally { await engine.close() }
  })

  it('creates and updates Package-owned Config entries with optimistic versions', async () => {
    let nextId = 0
    let nextTime = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => `2026-09-14T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })

    await expect(runtime.upsertExtensionConfig({
      packageId: 'example.settings',
      scope: { kind: 'card', cardId: 'missing-card' },
      key: 'enabled',
      value: true,
    })).rejects.toThrow('Card not found')

    const created = await runtime.upsertExtensionConfig({
      packageId: 'example.settings',
      scope: { kind: 'global' },
      key: 'enabled',
      value: true,
    })
    expect(created.config).toMatchObject({ packageId: 'example.settings', key: 'enabled', value: true, version: 1 })
    expect((await documents.get(created.config.id))?.meta.ownerExtensionId).toBe('example.settings')
    await expect(runtime.getExtensionConfig({ packageId: 'example.settings', scope: { kind: 'global' }, key: 'enabled' })).resolves.toEqual({ config: created.config })
    await expect(runtime.listExtensionConfigs({ packageId: 'example.settings', scope: { kind: 'global' } })).resolves.toEqual({ configs: [created.config] })

    await expect(runtime.upsertExtensionConfig({
      packageId: 'example.settings',
      scope: { kind: 'global' },
      key: 'enabled',
      value: false,
    })).rejects.toThrow('expectedVersion is required')

    const updated = await runtime.upsertExtensionConfig({
      packageId: 'example.settings',
      scope: { kind: 'global' },
      key: 'enabled',
      value: false,
      expectedVersion: created.config.version,
    })
    expect(updated.config).toMatchObject({ value: false, version: 2, createdAt: created.config.createdAt })
    await expect(runtime.upsertExtensionConfig({
      packageId: 'example.settings',
      scope: { kind: 'global' },
      key: 'enabled',
      value: true,
      expectedVersion: created.config.version,
    })).rejects.toThrow()

    engine.close()
  })
})
