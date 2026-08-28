import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host scoped storage contract', () => {
  it('stores owned Config and Record documents with validated scopes and bindings', async () => {
    const validatedScopes: unknown[] = []
    const validatedRefs: unknown[] = []
    const { kernel, extensionHost, documents } = createExtensionHostHarness({
      validateStorageScope: async scope => {
        validatedScopes.push(scope)
        if (scope.kind === 'timeline' && scope.timelineId !== 'timeline-1') throw new Error('missing timeline')
      },
      validateEntityRef: async ref => {
        validatedRefs.push(ref)
        if (ref.kind === 'narrative-node' && ref.nodeId !== 'node-1') throw new Error('missing node')
      },
    })
    const documentEvents: JsonValue[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => documentEvents.push(event as unknown as JsonValue))
    const rpc = ['putConfig', 'getConfig', 'listConfigs', 'createRecord', 'listRecords', 'updateRecord', 'deleteRecord']
      .map(name => ({ name: `example.storage.${name}` }))
    const dir = createExtensionFixture('scoped-storage-extension', {
      manifest: manifest('example.storage', rpc),
      source: `
let recordId
export function activate(ctx) {
  ctx.rpc.register('example.storage.putConfig', params => ctx.storage.configs.upsert({ scope: params.scope, key: 'theme', value: params.value, expectedVersion: params.expectedVersion }))
  ctx.rpc.register('example.storage.getConfig', params => ctx.storage.configs.get({ scope: params.scope, key: 'theme' }))
  ctx.rpc.register('example.storage.listConfigs', params => ctx.storage.configs.list(params))
  ctx.rpc.register('example.storage.createRecord', async () => {
    const record = await ctx.storage.records.create({
      scope: { kind: 'timeline', timelineId: 'timeline-1' },
      recordType: 'memory',
      data: { summary: 'Met Alice.' },
      bindings: [{ kind: 'narrative-node', timelineId: 'timeline-1', nodeId: 'node-1' }],
    })
    recordId = record.id
    return record
  })
  ctx.rpc.register('example.storage.listRecords', () => ctx.storage.records.list({
    scope: { kind: 'timeline', timelineId: 'timeline-1' },
    recordType: 'memory',
    binding: { kind: 'narrative-node', timelineId: 'timeline-1', nodeId: 'node-1' },
  }))
  ctx.rpc.register('example.storage.updateRecord', params => ctx.storage.records.update({
    recordId,
    expectedVersion: params.expectedVersion,
    scope: { kind: 'timeline', timelineId: 'timeline-1' },
    recordType: 'memory',
    data: { summary: 'Met Alice at the tavern.' },
    bindings: [{ kind: 'narrative-node', timelineId: 'timeline-1', nodeId: 'node-1' }],
  }))
  ctx.rpc.register('example.storage.deleteRecord', params => ctx.storage.records.delete({ recordId, expectedVersion: params.expectedVersion }))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.storage', 'server')
    const config = await kernel.callRpc<{ id: string; version: number }>('example.storage.putConfig', {
      scope: { kind: 'global' },
      value: { accent: 'violet' },
    })
    const readConfig = await kernel.callRpc<{ packageId: string; value: unknown }>('example.storage.getConfig', {
      scope: { kind: 'global' },
    })
    const record = await kernel.callRpc<{ id: string; version: number }>('example.storage.createRecord')
    const records = await kernel.callRpc<Array<{ id: string }>>('example.storage.listRecords')
    const updatedRecord = await kernel.callRpc<{ version: number }>('example.storage.updateRecord', { expectedVersion: record.version })
    await kernel.callRpc('example.storage.deleteRecord', { expectedVersion: updatedRecord.version })

    expect(config.version).toBe(1)
    expect(readConfig).toMatchObject({ packageId: 'example.storage', value: { accent: 'violet' } })
    expect((await documents.get(config.id))?.meta.createdBy).toEqual({ kind: 'extension', id: 'example.storage' })
    expect(records.map(item => item.id)).toEqual([record.id])
    expect(validatedScopes).toContainEqual({ kind: 'timeline', timelineId: 'timeline-1' })
    expect(validatedRefs).toContainEqual({ kind: 'narrative-node', timelineId: 'timeline-1', nodeId: 'node-1' })
    expect((await documents.get(record.id, { includeTombstone: true }))?.meta.tombstone).toBeDefined()
    expect(documentEvents.some(event => JSON.stringify(event).includes('airp.extensionConfig'))).toBe(true)
    expect(documentEvents.some(event => JSON.stringify(event).includes('airp.extensionRecord'))).toBe(true)
  })

  it('requires optimistic versions and blocks cross-package storage access', async () => {
    const { kernel, extensionHost, documents } = createExtensionHostHarness()
    await kernel.start()
    await documents.write({
      id: 'foreign-record',
      type: 'airp.extensionRecord',
      content: {
        scope: { kind: 'global' },
        recordType: 'memory',
        data: { private: true },
        bindings: [],
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      },
      expectedVersion: 'new',
      actor: { kind: 'kernel', id: 'test' },
      meta: { ownerExtensionId: 'other.package' },
    })
    const rpc = ['createConfig', 'overwriteConfig', 'readOther', 'createUnvalidatedBinding']
      .map(name => ({ name: `example.storageGuard.${name}` }))
    const dir = createExtensionFixture('storage-guard-extension', {
      manifest: manifest('example.storageGuard', rpc),
      source: `
export function activate(ctx) {
  ctx.rpc.register('example.storageGuard.createConfig', () => ctx.storage.configs.upsert({ scope: { kind: 'global' }, key: 'theme', value: { ok: true } }))
  ctx.rpc.register('example.storageGuard.overwriteConfig', () => ctx.storage.configs.upsert({ scope: { kind: 'global' }, key: 'theme', value: { ok: false } }))
  ctx.rpc.register('example.storageGuard.readOther', () => ctx.storage.records.get('foreign-record'))
  ctx.rpc.register('example.storageGuard.createUnvalidatedBinding', () => ctx.storage.records.create({
    scope: { kind: 'global' },
    recordType: 'memory',
    data: {},
    bindings: [{ kind: 'asset', assetId: 'asset-1' }],
  }))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.storageGuard', 'server')
    await kernel.callRpc('example.storageGuard.createConfig')

    await expect(kernel.callRpc('example.storageGuard.overwriteConfig')).rejects.toThrow('expectedVersion is required')
    await expect(kernel.callRpc('example.storageGuard.readOther')).rejects.toThrow('owned by another package')
    await expect(kernel.callRpc('example.storageGuard.createUnvalidatedBinding')).rejects.toThrow('validation is not available')
  })

  it('reverts canonical Config changes and keeps storage across Extension restarts', async () => {
    const { kernel, extensionHost, documents } = createExtensionHostHarness()
    const changesetIds: string[] = []
    documents.subscribeCommits(commit => changesetIds.push(commit.changeset.id))
    await kernel.start()
    const rpc = ['write', 'read'].map(name => ({ name: `example.storageRestart.${name}` }))
    const dir = createExtensionFixture('storage-restart-extension', {
      manifest: manifest('example.storageRestart', rpc),
      source: `
export function activate(ctx) {
  ctx.rpc.register('example.storageRestart.write', params => ctx.storage.configs.upsert({
    scope: { kind: 'global' },
    key: 'theme',
    value: params.value,
    expectedVersion: params.expectedVersion,
  }))
  ctx.rpc.register('example.storageRestart.read', () => ctx.storage.configs.get({ scope: { kind: 'global' }, key: 'theme' }))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.storageRestart', 'server')
    const created = await kernel.callRpc<{ version: number }>('example.storageRestart.write', { value: 'violet' })
    await kernel.callRpc('example.storageRestart.write', { value: 'blue', expectedVersion: created.version })
    const updateChangesetId = changesetIds.at(-1)!

    await documents.revertChangeset({
      changesetId: updateChangesetId,
      actor: { kind: 'client', id: 'test-client' },
      reason: 'test.undo-extension-config',
    })
    await expect(kernel.callRpc('example.storageRestart.read')).resolves.toMatchObject({ value: 'violet' })

    await extensionHost.dispose('example.storageRestart', 'server')
    await extensionHost.activate('example.storageRestart', 'server')
    await expect(kernel.callRpc('example.storageRestart.read')).resolves.toMatchObject({ value: 'violet' })
  })
})
