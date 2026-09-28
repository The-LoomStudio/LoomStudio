import type { JsonValue } from '@loom-studio/shared'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore, createSqliteDocumentStore, type DocumentStore } from '@loom-studio/document-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContext, createExtensionScope } from '../../../packages/extension-sdk/extension-host/src/instance.js'
import type { ExtensionModuleRecord } from '../../../packages/extension-sdk/extension-host/src/types.js'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host document ownership contract', () => {
  it('writes extension-owned documents through activation context', async () => {
    const { kernel, extensionHost, documents } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('document-extension', {
      manifest: manifest('example.documents', [{ name: 'example.documents.ping' }], ['example.documents.note']),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documents:1', type: 'example.documents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documents', 'server')
    const document = await documents.get('example.documents:1')

    expect(document?.meta.ownerExtensionId).toBe('example.documents')
    expect(document?.meta.createdBy).toEqual({ kind: 'extension', id: 'example.documents' })
  })

  it('emits docs.changed for extension-owned document writes', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    const events: JsonValue[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => { events.push(event as unknown as JsonValue) })
    const dir = createExtensionFixture('document-event-extension', {
      manifest: manifest('example.documentEvents', [{ name: 'example.documentEvents.ping' }], ['example.documentEvents.note']),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documentEvents:1', type: 'example.documentEvents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documentEvents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documentEvents', 'server')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'docs.changed',
      payload: {
        documents: [{ id: 'example.documentEvents:1', type: 'example.documentEvents.note', version: 1, tombstoned: false }],
      },
      meta: { source: 'extension:example.documentEvents' },
    })
  })

  it('allows declared package documents and rejects cross-package access', async () => {
    const { kernel, extensionHost, documents } = createExtensionHostHarness()
    await kernel.start()
    await documents.write({
      id: 'other.package:1',
      type: 'other.package.note',
      content: { secret: true },
      expectedVersion: 'new',
      actor: { kind: 'kernel', id: 'test' },
      meta: { ownerExtensionId: 'other.package' },
    })
    const rpc = [
      'writeOwn',
      'listOwn',
      'listForgedOwner',
      'readOther',
      'overwriteOther',
      'deleteOther',
      'writeUndeclared',
    ].map(name => ({ name: `example.secureDocuments.${name}` }))
    const dir = createExtensionFixture('secure-document-extension', {
      manifest: manifest('example.secureDocuments', rpc, ['example.secureDocuments.note']),
      source: `
export function activate(ctx) {
  ctx.rpc.register('example.secureDocuments.writeOwn', () => ctx.documents.write({ id: 'example.secureDocuments:1', type: 'example.secureDocuments.note', content: { ok: true }, expectedVersion: 'new' }))
  ctx.rpc.register('example.secureDocuments.listOwn', () => ctx.documents.list({ type: 'example.secureDocuments.note' }))
  ctx.rpc.register('example.secureDocuments.listForgedOwner', () => ctx.documents.list({ type: 'example.secureDocuments.note', ownerExtensionId: 'other.package' }))
  ctx.rpc.register('example.secureDocuments.readOther', () => ctx.documents.get('other.package:1'))
  ctx.rpc.register('example.secureDocuments.overwriteOther', () => ctx.documents.write({ id: 'other.package:1', type: 'example.secureDocuments.note', content: { stolen: true }, expectedVersion: 1 }))
  ctx.rpc.register('example.secureDocuments.deleteOther', () => ctx.documents.delete('other.package:1'))
  ctx.rpc.register('example.secureDocuments.writeUndeclared', () => ctx.documents.write({ type: 'example.secureDocuments.undeclared', content: {}, expectedVersion: 'new' }))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.secureDocuments', 'server')
    await kernel.callRpc('example.secureDocuments.writeOwn')

    const own = await kernel.callRpc<Array<{ id: string }>>('example.secureDocuments.listOwn')
    const forged = await kernel.callRpc<Array<{ id: string }>>('example.secureDocuments.listForgedOwner')
    expect(own.map(item => item.id)).toEqual(['example.secureDocuments:1'])
    expect(forged.map(item => item.id)).toEqual(['example.secureDocuments:1'])
    await expect(kernel.callRpc('example.secureDocuments.readOther')).rejects.toThrow()
    await expect(kernel.callRpc('example.secureDocuments.overwriteOther')).rejects.toThrow()
    await expect(kernel.callRpc('example.secureDocuments.deleteOther')).rejects.toThrow()
    await expect(kernel.callRpc('example.secureDocuments.writeUndeclared')).rejects.toThrow('did not declare document type')

    expect((await documents.get('other.package:1'))?.content).toEqual({ secret: true })
  })
})

describe.each(['memory', 'sqlite'] as const)('atomic document ownership (%s)', backend => {
  let documents: DocumentStore
  let close: () => Promise<void>
  const scopes: ReturnType<typeof createExtensionScope>[] = []

  beforeEach(() => {
    if (backend === 'sqlite') {
      const store = createSqliteDocumentStore({ filename: ':memory:' })
      documents = store
      close = () => store.close()
    } else {
      documents = createInMemoryDocumentStore()
      close = async () => undefined
    }
  })

  afterEach(async () => {
    await Promise.all(scopes.splice(0).map(scope => scope.dispose()))
    await close()
  })

  function context(packageId: string) {
    const scope = createExtensionScope(`${packageId}-${scopes.length}`)
    scopes.push(scope)
    const moduleManifest: ExtensionModuleRecord['moduleManifest'] = {
      id: 'server', runtime: 'server', entry: './unused.js',
      contributes: { documentTypes: [{ type: `${packageId}.note` }, { type: `${packageId}.other` }] },
    }
    return createContext({
      target: { kind: 'global' },
      directory: '/unused/document-ownership',
      packageManifest: {
        manifestVersion: 2, id: packageId, version: '1.0.0', displayName: packageId,
        engines: { studio: '^0.1.0' }, modules: [moduleManifest],
      },
      moduleManifest, state: 'active',
    }, {
      instanceId: scope.instanceId, state: 'active', scope,
      registeredRpcNames: new Set(), registeredEventNames: new Set(),
      registeredAiProviderIds: new Set(), registeredAgentToolIds: new Set(),
      grantedEventCapabilities: [], grantedAssetCapabilities: [],
    }, {
      documents, diagnostics: createInMemoryDiagnosticsRegistry(),
      callRpc: vi.fn(), registerRpc: vi.fn(),
    }).documents
  }

  it('allows only one package to create a shared ID without expectedVersion', async () => {
    const a = context('example.a')
    const b = context('example.b')
    const commits = vi.fn()
    const subscription = documents.subscribeCommits(commits)
    try {
      for (const reverse of [false, true]) {
        const id = `shared-${reverse}`
        const writers = reverse ? [[b, 'example.b'], [a, 'example.a']] as const : [[a, 'example.a'], [b, 'example.b']] as const
        const results = await Promise.allSettled(writers.map(([writer, owner]) =>
          writer.write({ id, type: `${owner}.note`, content: { owner } })))
        expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
        const failure = results.find(result => result.status === 'rejected') as PromiseRejectedResult
        expect(failure.reason).toMatchObject({ code: 'document.conflict' })
        const winner = results.findIndex(result => result.status === 'fulfilled')
        const owner = writers[winner]![1]
        expect(await documents.get(id)).toMatchObject({
          type: `${owner}.note`, version: 1, content: { owner }, meta: { ownerExtensionId: owner },
        })
      }
      expect(commits).toHaveBeenCalledTimes(2)
    } finally {
      subscription.dispose()
    }
  })

  it('preserves omitted versions for own writes, generated IDs, deletes and restores', async () => {
    const own = context('example.a')
    const created = await own.write({ type: 'example.a.note', content: { value: 1 }, reason: 'create control' })
    const id = created.documents[0]!.id
    const updated = await own.write({ id, type: 'example.a.note', content: { value: 2 }, reason: 'update control' })
    expect(updated.documents[0]).toMatchObject({
      id, version: 2, meta: { ownerExtensionId: 'example.a', updatedBy: { kind: 'extension', id: 'example.a' } },
    })
    expect(await documents.getChangeset(updated.changesetId)).toMatchObject({
      reason: 'update control', createdBy: { kind: 'extension', id: 'example.a' },
    })
    await expect(own.write({ id, type: 'example.a.note', content: {}, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'document.conflict' })
    await expect(own.write({ id, type: 'example.a.note', content: {}, expectedVersion: 'new' }))
      .rejects.toMatchObject({ code: 'document.conflict' })
    await expect(own.delete(id, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'document.conflict' })
    await own.delete(id)
    expect(await own.get(id)).toBeNull()
    const restored = await own.write({ id, type: 'example.a.note', content: { value: 3 } })
    expect(restored.documents[0]).toMatchObject({ id, version: 4, content: { value: 3 } })
    expect(restored.operations[0]?.kind).toBe('restore')
  })

  it('rejects changing an existing type even when both types are declared', async () => {
    const own = context('example.a')
    await own.write({ id: 'same-owner', type: 'example.a.note', content: { original: true } })
    await expect(own.write({ id: 'same-owner', type: 'example.a.other', content: { replaced: true } }))
      .rejects.toMatchObject({ code: 'document.conflict' })
    expect(await own.get('same-owner')).toMatchObject({
      type: 'example.a.note', version: 1, content: { original: true },
    })
  })

  it('checks ownership even for an explicit empty ID', async () => {
    const a = context('example.a')
    const b = context('example.b')
    const results = await Promise.allSettled([
      a.write({ id: '', type: 'example.a.note', content: {} }),
      b.write({ id: '', type: 'example.b.note', content: {} }),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((results[1] as PromiseRejectedResult).reason).toMatchObject({ code: 'document.conflict' })
    expect(await documents.get('')).toMatchObject({ version: 1, type: 'example.a.note', meta: { ownerExtensionId: 'example.a' } })
  })

  it('does not let other packages restore or delete a tombstone or retype an owned tombstone', async () => {
    const a = context('example.a')
    const b = context('example.b')
    await a.write({ id: 'deleted', type: 'example.a.note', content: { original: true } })
    await a.delete('deleted')
    const original = await documents.get('deleted', { includeTombstone: true })
    for (const expectedVersion of [undefined, 'new', 2] as const) {
      await expect(b.write({ id: 'deleted', type: 'example.b.note', content: {}, expectedVersion }))
        .rejects.toMatchObject({ code: 'document.conflict' })
    }
    await expect(b.delete('deleted')).rejects.toThrow('owned by another package')
    await expect(a.write({ id: 'deleted', type: 'example.a.other', content: {} }))
      .rejects.toMatchObject({ code: 'document.conflict' })
    expect(await documents.get('deleted', { includeTombstone: true })).toEqual(original)
  })

  it('does not use id or type changes made by the caller while a write is queued', async () => {
    const a = context('example.a')
    const b = context('example.b')
    await a.write({ id: 'own', type: 'example.a.note', content: {} })
    await b.write({ id: 'foreign', type: 'example.b.note', content: { secret: true } })
    const input = { id: 'own', type: 'example.a.note', content: { updated: true } }
    const pending = a.write(input)
    input.id = 'foreign'
    input.type = 'example.b.note'
    await pending
    expect(await a.get('own')).toMatchObject({ version: 2, content: { updated: true } })
    expect(await b.get('foreign')).toMatchObject({ version: 1, content: { secret: true } })
  })

  it('keeps delete ownership checks in the same transaction as the deletion', async () => {
    const a = context('example.a')
    await a.write({ id: 'transfer', type: 'example.a.note', content: {} })
    const deletion = a.delete('transfer')
    // A privileged Store caller changes ownership while the Host deletion is in flight.
    const transfer = documents.write({
      id: 'transfer', type: 'example.b.note', content: { retained: true },
      meta: { ownerExtensionId: 'example.b' }, actor: { kind: 'kernel', id: 'test' },
    })
    await Promise.all([deletion, transfer])
    expect(await documents.get('transfer')).toMatchObject({
      type: 'example.b.note', content: { retained: true }, meta: { ownerExtensionId: 'example.b' },
    })
    await expect(a.delete('transfer')).rejects.toThrow('owned by another package')
  })

  it('forces package owner and actor and still denies undeclared or foreign documents', async () => {
    const a = context('example.a')
    const b = context('example.b')
    const input = {
      id: 'metadata', type: 'example.a.note', content: {},
      meta: { ownerExtensionId: 'example.b', source: { kind: 'manual' } },
      actor: { kind: 'kernel' as const, id: 'forged' },
    }
    const result = await a.write(input)
    expect(result.documents[0]?.meta).toMatchObject({
      ownerExtensionId: 'example.a', createdBy: { kind: 'extension', id: 'example.a' },
      source: { kind: 'manual' },
    })
    await expect(b.get('metadata')).rejects.toThrow('owned by another package')
    await expect(b.write({ id: 'metadata', type: 'example.b.note', content: {} }))
      .rejects.toMatchObject({ code: 'document.conflict' })
    await expect(a.write({ type: 'example.a.undeclared', content: {} })).rejects.toThrow('did not declare document type')
    expect(await a.list({ type: 'example.a.note' })).toHaveLength(1)
    expect(await b.list({ type: 'example.b.note' })).toHaveLength(0)
  })
})
