import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host document ownership contract', () => {
  it('writes extension-owned documents through activation context', async () => {
    const { kernel, extensionHost, documents } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('document-extension', {
      manifest: manifest('example.documents', [{ name: 'example.documents.ping' }]),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documents:1', type: 'example.documents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documents')
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
      manifest: manifest('example.documentEvents', [{ name: 'example.documentEvents.ping' }]),
      source: `export async function activate(ctx) { await ctx.documents.write({ id: 'example.documentEvents:1', type: 'example.documentEvents.note', content: { ok: true }, expectedVersion: 'new' }); ctx.rpc.register('example.documentEvents.ping', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.documentEvents')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'docs.changed',
      payload: {
        documents: [{ id: 'example.documentEvents:1', type: 'example.documentEvents.note', version: 1, tombstoned: false }],
      },
      meta: { source: 'extension:example.documentEvents' },
    })
  })
})
