import type { ExtensionMediaAsset } from '@loom-studio/extension-host'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

type StoredAsset = ExtensionMediaAsset & { bytes: Uint8Array }

function assetManifest(id: string) {
  return {
    manifestVersion: 2,
    id,
    version: '0.0.0',
    displayName: id,
    engines: { studio: '^0.1.0' },
    modules: [{
      id: 'server',
      runtime: 'server',
      entry: './dist/index.js',
      capabilities: {
        'assets.publish': true,
        'assets.read': true,
      },
      contributes: {
        rpc: [
          { name: `${id}.publish` },
          { name: `${id}.read` },
          { name: `${id}.materialize` },
        ],
      },
    }],
  }
}

function createAssetHarness(grants: readonly ('assets.publish' | 'assets.read')[], assetScratchRoot?: string) {
  const stored = new Map<string, StoredAsset>()
  let nextId = 1
  const harness = createExtensionHostHarness({
    grantAssetCapabilities: () => grants,
    assetScratchRoot,
    assets: {
      publish: async input => {
        const asset: StoredAsset = {
          id: `asset-${nextId++}`,
          kind: input.kind,
          label: input.label,
          mediaType: input.mediaType,
          sizeBytes: input.bytes.byteLength,
          width: input.width,
          height: input.height,
          ownerPackageId: input.ownerPackageId,
          createdAt: '2026-08-15T00:00:00.000Z',
          bytes: new Uint8Array(input.bytes),
        }
        stored.set(asset.id, asset)
        return asset
      },
      get: async assetId => stored.get(assetId),
      read: async assetId => {
        const asset = stored.get(assetId)
        if (!asset) throw new Error(`Missing asset: ${assetId}`)
        return new Uint8Array(asset.bytes)
      },
    },
  })
  return { ...harness, stored }
}

const source = `
export function activate(ctx) {
  const contexts = globalThis.__loomAssetTestContexts ??= []
  contexts.push(ctx)
  ctx.rpc.register(ctx.extension.packageId + '.publish', () => ctx.assets.publish({ bytes: new Uint8Array([1, 2, 3]), kind: 'image', label: 'generated' }))
  ctx.rpc.register(ctx.extension.packageId + '.read', async params => {
    const result = await ctx.assets.read(params.assetId)
    return { asset: result.asset, bytes: Array.from(result.bytes) }
  })
  ctx.rpc.register(ctx.extension.packageId + '.materialize', params => ctx.assets.materialize(params.assetId, { fileExtension: '.png' }))
}
`

describe('extension host Media Asset contract', () => {
  it('denies publishing without assets.publish', async () => {
    const { kernel, extensionHost } = createAssetHarness([])
    await kernel.start()
    const directory = createExtensionFixture('asset-no-publish', {
      manifest: assetManifest('example.assetNoPublish'),
      source,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.assetNoPublish', 'server')

    await expect(kernel.callRpc('example.assetNoPublish.publish')).rejects.toThrow('assets.publish')
  })

  it('forces Package ownership and permits reading an owned Asset', async () => {
    const { kernel, extensionHost, stored } = createAssetHarness(['assets.publish'])
    await kernel.start()
    const directory = createExtensionFixture('asset-owner', {
      manifest: assetManifest('example.assetOwner'),
      source,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.assetOwner', 'server')

    const published = await kernel.callRpc<ExtensionMediaAsset>('example.assetOwner.publish')
    expect(published.ownerPackageId).toBe('example.assetOwner')
    expect(stored.get(published.id)?.bytes).toEqual(new Uint8Array([1, 2, 3]))
    await expect(kernel.callRpc('example.assetOwner.read', { assetId: published.id })).resolves.toMatchObject({
      bytes: [1, 2, 3],
    })
  })

  it('requires assets.read for an Asset owned by another Package', async () => {
    const denied = createAssetHarness([])
    denied.stored.set('asset-external', {
      id: 'asset-external',
      kind: 'image',
      sizeBytes: 1,
      ownerPackageId: 'other.package',
      createdAt: '2026-08-15T00:00:00.000Z',
      bytes: new Uint8Array([9]),
    })
    await denied.kernel.start()
    const deniedDirectory = createExtensionFixture('asset-read-denied', {
      manifest: assetManifest('example.assetReadDenied'),
      source,
    })
    await denied.extensionHost.discover(deniedDirectory)
    await denied.extensionHost.activate('example.assetReadDenied', 'server')
    await expect(denied.kernel.callRpc('example.assetReadDenied.read', { assetId: 'asset-external' })).rejects.toThrow('assets.read')

    const allowed = createAssetHarness(['assets.read'])
    allowed.stored.set('asset-external', denied.stored.get('asset-external')!)
    await allowed.kernel.start()
    const allowedDirectory = createExtensionFixture('asset-read-allowed', {
      manifest: assetManifest('example.assetReadAllowed'),
      source,
    })
    await allowed.extensionHost.discover(allowedDirectory)
    await allowed.extensionHost.activate('example.assetReadAllowed', 'server')
    await expect(allowed.kernel.callRpc('example.assetReadAllowed.read', { assetId: 'asset-external' })).resolves.toMatchObject({
      bytes: [9],
    })
  })

  it('invalidates the old Asset context after reload', async () => {
    const globalState = globalThis as typeof globalThis & { __loomAssetTestContexts?: Array<{ assets: { publish(input: unknown): Promise<unknown> } }> }
    delete globalState.__loomAssetTestContexts
    const { kernel, extensionHost } = createAssetHarness(['assets.publish'])
    await kernel.start()
    const directory = createExtensionFixture('asset-reload', {
      manifest: assetManifest('example.assetReload'),
      source,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.assetReload', 'server')
    const oldContext = globalState.__loomAssetTestContexts?.[0]
    await extensionHost.reload('example.assetReload', 'server')

    await expect(oldContext?.assets.publish({ bytes: new Uint8Array([1]), kind: 'image' })).rejects.toThrow(/stopping|no longer active/)
    delete globalState.__loomAssetTestContexts
  })

  it('materializes only into instance scratch and removes it on reload', async () => {
    const scratchRoot = await mkdtemp(join(tmpdir(), 'loom-extension-asset-scratch-'))
    try {
      const { kernel, extensionHost } = createAssetHarness(['assets.publish'], scratchRoot)
      await kernel.start()
      const directory = createExtensionFixture('asset-materialize', {
        manifest: assetManifest('example.assetMaterialize'),
        source,
      })
      await extensionHost.discover(directory)
      await extensionHost.activate('example.assetMaterialize', 'server')
      const asset = await kernel.callRpc<ExtensionMediaAsset>('example.assetMaterialize.publish')
      const materialized = await kernel.callRpc<{ path: string }>('example.assetMaterialize.materialize', { assetId: asset.id })

      expect(materialized.path.startsWith(join(scratchRoot, 'example.assetMaterialize'))).toBe(true)
      await expect(access(materialized.path)).resolves.toBeUndefined()
      await extensionHost.reload('example.assetMaterialize', 'server')
      await expect(access(materialized.path)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(kernel.callRpc<{ bytes: number[] }>('example.assetMaterialize.read', { assetId: asset.id })).resolves.toMatchObject({
        bytes: [1, 2, 3],
      })
    } finally {
      await rm(scratchRoot, { recursive: true, force: true })
    }
  })
})
