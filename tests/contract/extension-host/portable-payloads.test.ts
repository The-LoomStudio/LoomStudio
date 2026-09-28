import type { ExtensionPortablePayload } from '@loom-studio/extension-sdk'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host Portable Payload contract', () => {
  it('rejects another installation of the same package and another Card binding', async () => {
    const packageId = 'example.privatePayload'
    const target = { kind: 'card' as const, cardId: 'a' }
    const own = { ...payload('own', packageId), ownerInstallationId: extensionInstallationId(packageId, target) }
    const other = { ...payload('other', packageId), ownerInstallationId: extensionInstallationId(packageId, { kind: 'card', cardId: 'b' }) }
    const writes: unknown[] = []
    const { kernel, extensionHost } = createExtensionHostHarness({
      portablePayloads: {
        create: async input => { writes.push(input); return own },
        list: async (_, ownerInstallationId) => [own, other].filter(item => item.ownerInstallationId === ownerInstallationId),
        get: async id => id === 'own' ? own : other,
        update: async input => { writes.push(input); return own },
        delete: async input => { writes.push(input) },
        replaceCardBindings: async input => { writes.push(input); return { cardVersion: 2 } },
      },
    })
    await kernel.start()
    const directory = createExtensionFixture('private-payload', {
      manifest: manifest(packageId, ['read', 'update', 'bind', 'publish', 'list'].map(name => ({ name: `${packageId}.${name}` }))),
      source: `export function activate(ctx) {
        const draft = {fileName:'test.json', format:'test', mediaType:'application/json', content:'{}'};
        ctx.rpc.register('${packageId}.publish', () => ctx.portablePayloads.publish({payload:draft}));
        ctx.rpc.register('${packageId}.list', () => ctx.portablePayloads.listOwn());
        ctx.rpc.register('${packageId}.read', p => ctx.portablePayloads.readOwn(p.id));
        ctx.rpc.register('${packageId}.update', p => ctx.portablePayloads.updateOwn({payloadId:p.id,expectedVersion:1,payload:draft}));
        ctx.rpc.register('${packageId}.bind', p => ctx.portablePayloads.replaceOwnCardBindings({cardId:p.cardId,expectedVersion:1,payloadIds:['own']}));
      }`,
    })
    try {
      await extensionHost.discover(directory, target)
      await extensionHost.activate(packageId, 'server', target)
      const context = { extensionTarget: target }
      await kernel.callRpc(`${packageId}.publish`, {}, context)
      expect(writes[0]).toMatchObject({ ownerInstallationId: own.ownerInstallationId })
      await expect(kernel.callRpc(`${packageId}.list`, {}, context)).resolves.toEqual([own])
      await expect(kernel.callRpc(`${packageId}.read`, { id: 'own' }, context)).resolves.toEqual(own)
      await expect(kernel.callRpc(`${packageId}.read`, { id: 'other' }, context)).rejects.toThrow('another package or installation')
      await expect(kernel.callRpc(`${packageId}.update`, { id: 'other' }, context)).rejects.toThrow('another package or installation')
      await expect(kernel.callRpc(`${packageId}.bind`, { cardId: 'b' }, context)).rejects.toThrow('outside this Card')
      expect(writes).toHaveLength(1)
    } finally {
      await kernel.stop()
    }
  })

  it('forces package ownership and blocks cross-package payload access', async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const ownPayload = payload('payload-own', 'example.payloads')
    const otherPayload = payload('payload-other', 'other.package')
    const payloads = new Map([
      [ownPayload.id, ownPayload],
      [otherPayload.id, otherPayload],
    ])
    const { kernel, extensionHost } = createExtensionHostHarness({
      portablePayloads: {
        create: async input => {
          calls.push({ method: 'create', input })
          return { ...ownPayload, ...input.payload, artifactPayloadId: input.artifactPayloadId ?? ownPayload.artifactPayloadId }
        },
        list: async packageId => {
          calls.push({ method: 'list', input: packageId })
          return [...payloads.values()].filter(item => item.packageId === packageId)
        },
        get: async payloadId => {
          calls.push({ method: 'get', input: payloadId })
          const found = payloads.get(payloadId)
          if (!found) throw new Error(`missing payload: ${payloadId}`)
          return found
        },
        update: async input => {
          calls.push({ method: 'update', input })
          return { ...ownPayload, ...input.payload, version: input.expectedVersion + 1 }
        },
        delete: async input => {
          calls.push({ method: 'delete', input })
        },
        replaceCardBindings: async input => {
          calls.push({ method: 'bind', input })
          return { cardVersion: input.expectedVersion + 1 }
        },
      },
    })
    await kernel.start()
    const rpc = ['publish', 'list', 'read', 'update', 'remove', 'bind', 'readOther', 'updateOther', 'bindOther']
      .map(name => ({ name: `example.payloads.${name}` }))
    const dir = createExtensionFixture('portable-payload-extension', {
      manifest: manifest('example.payloads', rpc),
      source: `
export function activate(ctx) {
  const draft = { fileName: 'theme.json', format: 'example.theme', mediaType: 'application/json', schemaVersion: 1, content: '{"accent":"violet"}' }
  ctx.rpc.register('example.payloads.publish', () => ctx.portablePayloads.publish({ artifactPayloadId: 'theme-default', payload: draft }))
  ctx.rpc.register('example.payloads.list', () => ctx.portablePayloads.listOwn())
  ctx.rpc.register('example.payloads.read', () => ctx.portablePayloads.readOwn('payload-own'))
  ctx.rpc.register('example.payloads.update', () => ctx.portablePayloads.updateOwn({ payloadId: 'payload-own', expectedVersion: 1, payload: draft }))
  ctx.rpc.register('example.payloads.remove', () => ctx.portablePayloads.deleteOwn({ payloadId: 'payload-own', expectedVersion: 2 }))
  ctx.rpc.register('example.payloads.bind', () => ctx.portablePayloads.replaceOwnCardBindings({ cardId: 'card-1', expectedVersion: 3, payloadIds: ['payload-own'] }))
  ctx.rpc.register('example.payloads.readOther', () => ctx.portablePayloads.readOwn('payload-other'))
  ctx.rpc.register('example.payloads.updateOther', () => ctx.portablePayloads.updateOwn({ payloadId: 'payload-other', expectedVersion: 1, payload: draft }))
  ctx.rpc.register('example.payloads.bindOther', () => ctx.portablePayloads.replaceOwnCardBindings({ cardId: 'card-1', expectedVersion: 3, payloadIds: ['payload-other'] }))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.payloads', 'server')
    await kernel.callRpc('example.payloads.publish')
    await kernel.callRpc('example.payloads.list')
    await kernel.callRpc('example.payloads.read')
    await kernel.callRpc('example.payloads.update')
    await kernel.callRpc('example.payloads.remove')
    await kernel.callRpc('example.payloads.bind')

    expect(calls).toContainEqual(expect.objectContaining({
      method: 'create',
      input: expect.objectContaining({ packageId: 'example.payloads' }),
    }))
    expect(calls).toContainEqual(expect.objectContaining({
      method: 'update',
      input: expect.objectContaining({ packageId: 'example.payloads', payloadId: 'payload-own' }),
    }))
    expect(calls).toContainEqual({
      method: 'bind',
      input: { packageId: 'example.payloads', cardId: 'card-1', expectedVersion: 3, payloadIds: ['payload-own'] },
    })
    await expect(kernel.callRpc('example.payloads.readOther')).rejects.toThrow('owned by another package')
    await expect(kernel.callRpc('example.payloads.updateOther')).rejects.toThrow('owned by another package')
    await expect(kernel.callRpc('example.payloads.bindOther')).rejects.toThrow('owned by another package')
    expect(calls.filter(call => call.method === 'update')).toHaveLength(1)
    expect(calls.filter(call => call.method === 'bind')).toHaveLength(1)
  })
})

function payload(id: string, packageId: string): ExtensionPortablePayload {
  return {
    id,
    artifactPayloadId: `${id}-artifact`,
    packageId,
    fileName: 'theme.json',
    format: 'example.theme',
    mediaType: 'application/json',
    schemaVersion: 1,
    content: '{}',
    version: 1,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
  }
}
