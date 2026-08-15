import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
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
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as unknown as JsonValue))
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
