import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { createPolyglotCardPng, defaultCardPng, encodeCardBundlePng, isPng, readCardPngArchive, readPngImageBytes, readPolyglotArchive, stripLoomCardPayload, stripPngTextMetadata } from '../../../apps/studio-server/src/codecs/card-png.js'
import { encodeCardBundleZip, decodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'

describe('Loom Card PNG', () => {
  it('does not find a bundle in an ordinary PNG', () => {
    expect(readCardPngArchive(defaultCardPng)).toBeUndefined()
  })

  it('rejects a non-V4 Artifact before packaging it in a PNG', () => {
    expect(() => encodeCardBundlePng(defaultCardPng, encodeCardBundleZip({
      artifact: { schemaVersion: 1, artifactId: 'legacy', displayName: 'Legacy', card: { name: 'Legacy' }, contextAssets: [] } as never,
      avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
    }))).toThrow('Unsupported card bundle schemaVersion')
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
      card: {
        name: 'PNG Bundle', description: '真实正文',
        preset: { macroOptions: { tone: [{ id: 'quiet', label: 'Quiet', value: 'soft' }, { id: 'loud', label: 'Loud', value: 'bold' }] } },
      }, contextAssets: [],
      extensionPayloads: [{ id: 'style', packageId: 'example.renderer', fileName: 'style.json', format: 'example.style', mediaType: 'application/json', content: '{"主题":"雾港"}' }],
    }
    const archive = encodeCardBundleZip({
      artifact,
      avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
      background: { bytes: Buffer.from('background'), mediaType: 'image/webp' },
    })
    const png = encodeCardBundlePng(defaultCardPng, archive)
    expect(isPng(png)).toBe(true)
    expect(readPolyglotArchive(png)).toBeUndefined()
    expect(Buffer.from(readCardPngArchive(png)!).equals(Buffer.from(archive))).toBe(true)
    expect(Buffer.from(stripLoomCardPayload(png)).equals(defaultCardPng)).toBe(true)
    expect(Buffer.from(stripPngTextMetadata(png)).equals(defaultCardPng)).toBe(true)
    expect(Buffer.from(encodeCardBundlePng(png, archive)).equals(Buffer.from(png))).toBe(true)
    const decoded = await decodeCardBundleZip(readCardPngArchive(png)!)
    expect(decoded.artifact.card.description).toBe('真实正文')
    expect(decoded.artifact.card.preset).toEqual(artifact.card.preset)
    expect(decoded.artifact.extensionPayloads).toEqual(artifact.extensionPayloads)
    expect(Buffer.from(decoded.background!.bytes).toString()).toBe('background')
  }, 30000)

  it('rejects corrupt Base64 instead of treating a recognized Bundle as absent', () => {
    const png = Buffer.from(encodeCardBundlePng(defaultCardPng, Buffer.from('PK\x03\x04')))
    const payloadOffset = png.indexOf(Buffer.from('UEsDBA=='))
    expect(payloadOffset).toBeGreaterThan(0)
    png[payloadOffset] = 0x21
    expect(() => readCardPngArchive(png)).toThrow('Invalid Loom Bundle PNG Base64')
  })
})
