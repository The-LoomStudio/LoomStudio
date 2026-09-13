import { describe, expect, it } from 'vitest'
import { normalizeCardBundleArtifact, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createPolyglotCardPng, decodeCardPng, defaultCardPng, encodeCardPng, encodeCardBundlePng, hasLegacyCardPng, isPng, readCardPngArchive, readPngImageBytes, readPolyglotArchive, stripLoomCardPayload, stripPngTextMetadata } from '../../../apps/studio-server/src/codecs/card-png.js'
import { encodeCardBundleZip, decodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'

describe('Loom Card PNG', () => {
  it('round-trips a UTF-8 Card Artifact through compressed iTXt', () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 4,
      artifactId: 'card-artifact-1',
      displayName: '雾港角色',
      card: { name: '雾港角色', description: '包含中文提示词。' },
      contextAssets: [],
      extensionPayloads: [{
        id: 'style-v1',
        packageId: 'example.renderer',
        fileName: 'style.json',
        format: 'example.style',
        mediaType: 'application/json',
        content: '{"主题":"雾港"}',
      }],
    }

    const encoded = encodeCardPng(defaultCardPng, artifact)

    expect(isPng(encoded)).toBe(true)
    expect(encoded.byteLength).toBeGreaterThan(defaultCardPng.byteLength)
    expect(decodeCardPng(encoded)).toEqual(normalizeCardBundleArtifact(artifact))
  })

  it('rejects a non-V4 Artifact at the PNG boundary', () => {
    expect(() => encodeCardPng(defaultCardPng, {
      schemaVersion: 1,
      artifactId: 'legacy', displayName: 'Legacy', card: { name: 'Legacy' }, contextAssets: [],
    } as never)).toThrow('Unsupported card bundle schemaVersion')
  })

  it('rejects an ordinary PNG without Loom metadata', () => {
    expect(() => decodeCardPng(defaultCardPng)).toThrow('Loom Card iTXt')
  })

  it('appends and extracts a ZIP payload without changing the PNG image bytes', () => {
    const archive = Buffer.from('PK\x03\x04archive', 'latin1')
    const polyglot = createPolyglotCardPng(defaultCardPng, archive)

    expect(Buffer.from(readPngImageBytes(polyglot))).toEqual(defaultCardPng)
    expect(Buffer.from(readPolyglotArchive(polyglot)!)).toEqual(archive)
  })

  it('carries a complete file-backed ZIP in PNG metadata without a trailing polyglot payload', async () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 4, artifactId: 'png-bundle', displayName: 'PNG Bundle',
      card: { name: 'PNG Bundle', description: '真实正文' }, contextAssets: [],
    }
    const archive = encodeCardBundleZip({
      artifact,
      avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
      background: { bytes: Buffer.from('background'), mediaType: 'image/webp' },
    })
    const png = encodeCardBundlePng(encodeCardPng(defaultCardPng, artifact), archive)
    expect(isPng(png)).toBe(true)
    expect(hasLegacyCardPng(png)).toBe(false)
    expect(readPolyglotArchive(png)).toBeUndefined()
    expect(readCardPngArchive(png)).toEqual(Buffer.from(archive))
    expect(stripLoomCardPayload(png)).toEqual(defaultCardPng)
    expect(stripPngTextMetadata(png)).toEqual(defaultCardPng)
    expect(encodeCardBundlePng(png, archive)).toEqual(png)
    const decoded = await decodeCardBundleZip(readCardPngArchive(png)!)
    expect(decoded.artifact.card.description).toBe('真实正文')
    expect(Buffer.from(decoded.background!.bytes).toString()).toBe('background')
  })

  it('rejects corrupt Base64 instead of treating a recognized Bundle as absent', () => {
    const png = Buffer.from(encodeCardBundlePng(defaultCardPng, Buffer.from('PK\x03\x04')))
    const payloadOffset = png.indexOf(Buffer.from('UEsDBA=='))
    expect(payloadOffset).toBeGreaterThan(0)
    png[payloadOffset] = 0x21
    expect(() => readCardPngArchive(png)).toThrow('Invalid Loom Bundle PNG Base64')
  })
})
