import { createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('application Extension Config runtime', () => {
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
