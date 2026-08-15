import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { createPolyglotCardPng, decodeCardPng, defaultCardPng, encodeCardPng, isPng, readPngImageBytes, readPolyglotArchive } from './card-png.js'

describe('Loom Card PNG', () => {
  it('round-trips a UTF-8 Card Artifact through compressed iTXt', () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 1,
      artifactId: 'card-artifact-1',
      displayName: '雾港角色',
      card: { name: '雾港角色', description: '包含中文提示词。' },
      contextAssets: [],
    }

    const encoded = encodeCardPng(defaultCardPng, artifact)

    expect(isPng(encoded)).toBe(true)
    expect(encoded.byteLength).toBeGreaterThan(defaultCardPng.byteLength)
    expect(decodeCardPng(encoded)).toEqual(artifact)
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
})
