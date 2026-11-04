import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionConfigDocumentId, extensionInstallationId, type ExtensionStorageScope } from '@loom-studio/extension-sdk'
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

  it('isolates one package key by installation target and scope, including stale update failures', async () => {
    const { engine, documents, runtime } = setup()
    const packageId = 'example.settings'
    try {
      const { card: cardA } = await runtime.createCard({ name: 'A' })
      const { card: cardB } = await runtime.createCard({ name: 'B' })
      const { timeline: timelineA } = await runtime.createNarrativeTimeline({ cardId: cardA.id })
      const { timeline: timelineB } = await runtime.createNarrativeTimeline({ cardId: cardB.id })
      const cases = [
        { card: cardA, timeline: timelineA, label: 'A' },
        { card: cardB, timeline: timelineB, label: 'B' },
      ]
      const configs = []
      for (const item of cases) {
        const target = { kind: 'card' as const, cardId: item.card.id }
        const scopes: ExtensionStorageScope[] = [
          { kind: 'card', cardId: item.card.id }, { kind: 'timeline', timelineId: item.timeline.id },
        ]
        for (const scope of scopes) {
          const identity = { packageId, scope, key: 'layout' }
          const global = await runtime.upsertExtensionConfig({ ...identity, value: `global-${item.label}-${scope.kind}` })
          const local = await runtime.upsertExtensionConfig({ ...identity, target, value: `card-${item.label}-${scope.kind}` })
          expect(global.config.id).toBe(extensionConfigDocumentId(packageId, scope, identity.key))
          expect(local.config.id).toBe(extensionConfigDocumentId(packageId, scope, identity.key, target))
          expect(global.config.id).not.toBe(local.config.id)
          expect((await documents.get(global.config.id))!.meta.ownerInstallationId).toBeUndefined()
          expect((await documents.get(local.config.id))!.meta.ownerInstallationId).toBe(extensionInstallationId(packageId, target))
          expect(await runtime.getExtensionConfig(identity)).toEqual({ config: global.config })
          expect(await runtime.getExtensionConfig({ ...identity, target: { kind: 'global' } })).toEqual({ config: global.config })
          expect(await runtime.getExtensionConfig({ ...identity, target })).toEqual({ config: local.config })
          expect(await runtime.listExtensionConfigs(identity)).toEqual({ configs: [global.config] })
          expect(await runtime.listExtensionConfigs({ ...identity, target })).toEqual({ configs: [local.config] })
          configs.push(global.config, local.config)
        }
      }
      expect(new Set(configs.map(config => config.id)).size).toBe(8)
      expect((await runtime.listExtensionConfigs({ packageId })).configs.map(config => config.id).sort())
        .toEqual(configs.filter(config => typeof config.value === 'string' && config.value.startsWith('global-')).map(config => config.id).sort())
      for (const item of cases) {
        const target = { kind: 'card' as const, cardId: item.card.id }
        expect((await runtime.listExtensionConfigs({ packageId, target })).configs).toHaveLength(2)
      }
      const identity = { packageId, target: { kind: 'card' as const, cardId: cardA.id }, scope: { kind: 'card' as const, cardId: cardA.id }, key: 'layout' }
      const original = (await runtime.getExtensionConfig(identity)).config!
      const updated = await runtime.upsertExtensionConfig({ ...identity, value: 'updated-A', expectedVersion: original.version })
      await expect(runtime.upsertExtensionConfig({ ...identity, value: 'stale-A', expectedVersion: original.version })).rejects.toThrow()
      await expect(runtime.upsertExtensionConfig({ ...identity, value: 'missing-version' })).rejects.toThrow('expectedVersion is required')
      expect((await runtime.getExtensionConfig(identity)).config).toEqual(updated.config)
      expect((await runtime.getExtensionConfig({ ...identity, target: { kind: 'global' } })).config!.value).toBe('global-A-card')
      expect((await runtime.getExtensionConfig({ ...identity, target: { kind: 'card', cardId: cardB.id }, scope: { kind: 'card', cardId: cardB.id } })).config!.value).toBe('card-B-card')
    } finally { await engine.close() }
  })

  it('rejects global and cross-Card scopes for every Card-targeted Config operation', async () => {
    const { engine, agents, runtime } = setup()
    try {
      const { card } = await runtime.createCard({ name: 'Owner' })
      const { card: otherCard } = await runtime.createCard({ name: 'Other' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const { timeline: otherTimeline } = await runtime.createNarrativeTimeline({ cardId: otherCard.id })
      const actor = { kind: 'system' as const, id: 'test' }
      const own = await agents.createSession({ actor, agentPresetId: 'test-preset', timelineId: timeline.id })
      const other = await agents.createSession({ actor, agentPresetId: 'test-preset', timelineId: otherTimeline.id })
      const standalone = await agents.createSession({ actor, agentPresetId: 'test-preset' })
      const target = { kind: 'card' as const, cardId: card.id }
      const packageId = 'example.settings'
      const invalidScopes: ExtensionStorageScope[] = [
        { kind: 'global' }, { kind: 'card', cardId: otherCard.id },
        { kind: 'timeline', timelineId: otherTimeline.id },
        { kind: 'agent-session', agentSessionId: other.session.id },
        { kind: 'agent-session', agentSessionId: standalone.session.id },
      ]
      for (const scope of invalidScopes) {
        const identity = { packageId, target, scope, key: 'enabled' }
        await expect(runtime.listExtensionConfigs(identity)).rejects.toThrow('outside this Card installation')
        await expect(runtime.getExtensionConfig(identity)).rejects.toThrow('outside this Card installation')
        await expect(runtime.upsertExtensionConfig({ ...identity, value: true })).rejects.toThrow('outside this Card installation')
      }
      const identity = { packageId, target, scope: { kind: 'agent-session' as const, agentSessionId: own.session.id }, key: 'enabled' }
      const saved = await runtime.upsertExtensionConfig({ ...identity, value: true })
      expect(await runtime.getExtensionConfig(identity)).toEqual({ config: saved.config })
      expect(await runtime.listExtensionConfigs({ packageId, target })).toEqual({ configs: [saved.config] })
    } finally { await engine.close() }
  })

  it('uses current absence and tombstone semantics instead of applying live-record CAS to recreation', async () => {
    const { engine, documents, runtime } = setup()
    try {
      const identity = { packageId: 'example.settings', scope: { kind: 'global' as const }, key: 'enabled' }
      expect(await runtime.getExtensionConfig(identity)).toEqual({ config: null })
      const created = await runtime.upsertExtensionConfig({ ...identity, value: true, expectedVersion: 999 })
      expect(created.config.version).toBe(1)
      await documents.delete({ id: created.config.id, expectedVersion: created.config.version, actor: { kind: 'system', id: 'test' } })
      expect(await runtime.getExtensionConfig(identity)).toEqual({ config: null })
      expect(await runtime.listExtensionConfigs({ packageId: identity.packageId })).toEqual({ configs: [] })
      const tombstone = (await documents.get(created.config.id, { includeTombstone: true }))!
      const restored = await runtime.upsertExtensionConfig({ ...identity, value: false, expectedVersion: 999 })
      expect(restored.config.id).toBe(created.config.id)
      expect(restored.config.version).toBe(tombstone.version + 1)
      expect(restored.config.value).toBe(false)
      expect((await documents.get(restored.config.id))!.meta.tombstone).toBeUndefined()
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
