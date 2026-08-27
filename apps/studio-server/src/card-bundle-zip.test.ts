import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { decodeCardBundleZip, encodeCardBundleZip } from './card-bundle-zip.js'

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
