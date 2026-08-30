import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { unzipSync } from 'fflate'
import { decodeCardBundleZip, encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'

describe('Loom Card ZIP', () => {
  it('round-trips an Artifact with avatar and optional background', async () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 2,
      artifactId: 'artifact-1',
      displayName: '完整角色包',
      card: {
        name: '完整角色包',
        media: { avatarAssetId: 'local-avatar', coverAssetId: 'local-background' },
      },
      contextAssets: [],
      extensionPayloads: [{
        id: 'image-style-v1',
        packageId: 'example.image-generator',
        fileName: 'style.json',
        format: 'example.image-style',
        mediaType: 'application/json',
        content: '{"style":"watercolor"}',
      }],
    }
    const archive = encodeCardBundleZip({
      artifact,
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
      background: { bytes: Buffer.from('background'), mediaType: 'image/webp' },
    })

    const decoded = await decodeCardBundleZip(archive)

    expect(decoded.artifact.card.media).toBeUndefined()
    expect(decoded.artifact.displayName).toBe('完整角色包')
    expect(Buffer.from(decoded.avatar.bytes).toString()).toBe('avatar')
    expect(decoded.avatar.mediaType).toBe('image/png')
    expect(Buffer.from(decoded.background!.bytes).toString()).toBe('background')
    expect(decoded.background?.mediaType).toBe('image/webp')
    expect(decoded.artifact.extensionPayloads).toEqual(artifact.extensionPayloads)
    const entries = unzipSync(archive)
    expect(entries['extensions/example.image-generator/image-style-v1/style.json']).toBeDefined()
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString('utf8')) as {
      artifact: { extensionPayloads?: unknown }
      extensionPayloads?: Array<{ path: string }>
    }
    expect(manifest.artifact.extensionPayloads).toBeUndefined()
    expect(manifest.extensionPayloads?.[0]?.path).toBe('extensions/example.image-generator/image-style-v1/style.json')
  })

  it('rejects a non-V2 Artifact at the ZIP boundary', () => {
    expect(() => encodeCardBundleZip({
      artifact: {
        schemaVersion: 1,
        artifactId: 'legacy', displayName: 'Legacy', card: { name: 'Legacy' }, contextAssets: [],
      } as never,
      avatar: { bytes: new Uint8Array([1]), mediaType: 'image/png' },
    })).toThrow('Unsupported card bundle schemaVersion')
  })

  it('rejects input that is not a ZIP package', async () => {
    await expect(decodeCardBundleZip(Buffer.from('not zip'))).rejects.toThrow()
  })
})
