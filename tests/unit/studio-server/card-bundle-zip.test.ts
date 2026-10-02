import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { materializeStateContribution } from '@loom-studio/application-runtime'
import { unzipSync, zipSync, Zip, ZipPassThrough, ZipDeflate } from 'fflate'
import { crc32, deflateSync } from 'node:zlib'
import { decodeCardBundleZip, encodeCardBundleZip, loadCardBundleFiles } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { defaultCardPng, encodeCardBundlePng, readCardPngArchive } from '../../../apps/studio-server/src/codecs/card-png.js'

describe('Loom Card ZIP', () => {
  it('carries embedded extension archives as binary files without extracting them', async () => {
    const archive = zipSync({
      'manifest.json': Buffer.from(JSON.stringify({ id: 'example.offline', version: '1.0.0' })),
      'image.bin': new Uint8Array([0, 255, 128, 1]),
    })
    const artifact: CardBundleArtifact = {
      schemaVersion: 4, artifactId: 'offline', displayName: 'Offline', card: { name: 'Offline' }, contextAssets: [],
      extensionPackages: [{ packageId: 'example.offline', version: '1.0.0', archiveBase64: Buffer.from(archive).toString('base64') }],
    }
    const encoded = encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    const files = unzipSync(encoded)
    expect(files['extension-packages/0.zip']).toEqual(archive)
    expect(files['image.bin']).toBeUndefined()
    expect((await decodeCardBundleZip(encoded)).artifact.extensionPackages).toEqual(artifact.extensionPackages)
    const loaded = await loadCardBundleFiles(async path => {
      const bytes = files[path]
      if (!bytes) throw new Error(`Missing ${path}`)
      return bytes
    })
    expect(loaded.bundle.artifact.extensionPackages).toEqual(artifact.extensionPackages)
  })

  it.each([0, 6] as const)('rejects mismatched checksum metadata for compression level %s', async level => {
    const entries = unzipSync(encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'crc', displayName: 'CRC', card: { name: 'CRC', description: 'original-description' }, contextAssets: [] },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }))
    const archive = Buffer.from(zipSync(entries, { level }))
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    expect(central).toBeGreaterThan(0)
    archive[central + 16]! ^= 1
    await expect(decodeCardBundleZip(archive)).rejects.toThrow(/checksum.*manifest\.json/)
  })

  it('rejects same-length body corruption inside ZIP and PNG before returning an Artifact', async () => {
    const source = unzipSync(encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'crc', displayName: 'CRC', card: { name: 'CRC', description: 'original-description' }, contextAssets: [] },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }))
    const archive = Buffer.from(zipSync(source, { level: 0 }))
    const body = archive.indexOf(Buffer.from('original-description'))
    expect(body).toBeGreaterThan(0)
    archive[body] = 'X'.charCodeAt(0)
    await expect(decodeCardBundleZip(archive)).rejects.toThrow('ZIP checksum mismatch: card/description.md')
    await expect(decodeCardBundleZip(readCardPngArchive(encodeCardBundlePng(defaultCardPng, archive))!))
      .rejects.toThrow('ZIP checksum mismatch: card/description.md')
  })

  it.each([ZipPassThrough, ZipDeflate])('accepts a valid streaming ZIP with data descriptors (%s)', async Encoder => {
    const entries = unzipSync(encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'stream', displayName: 'Stream', card: { name: 'Stream', description: 'streamed description' }, contextAssets: [] },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }))
    const chunks: Uint8Array[] = []
    const archive = new Zip((error, data) => {
      if (error) throw error
      chunks.push(data)
    })
    for (const [path, bytes] of Object.entries(entries)) {
      const file = new Encoder(path)
      archive.add(file)
      file.push(bytes, true)
    }
    archive.end()
    const bytes = Buffer.concat(chunks)
    await expect(decodeCardBundleZip(bytes))
      .resolves.toMatchObject({ artifact: { card: { description: 'streamed description' } } })
    const descriptor = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
    expect(descriptor).toBeGreaterThan(0)
    bytes[descriptor + 4]! ^= 1
    await expect(decodeCardBundleZip(bytes)).rejects.toThrow('ZIP checksum descriptor mismatch: manifest.json')
  })

  it('accepts ZIP64 end records for a bounded small package', async () => {
    const archive = Buffer.from(encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'zip64', displayName: 'ZIP64', card: { name: 'ZIP64' }, contextAssets: [] },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }))
    const end = archive.length - 22
    const record = Buffer.alloc(56)
    record.writeUInt32LE(0x06064b50)
    record.writeBigUInt64LE(44n, 4)
    record.writeUInt16LE(45, 12)
    record.writeUInt16LE(45, 14)
    record.writeBigUInt64LE(BigInt(archive.readUInt16LE(end + 8)), 24)
    record.writeBigUInt64LE(BigInt(archive.readUInt16LE(end + 10)), 32)
    record.writeBigUInt64LE(BigInt(archive.readUInt32LE(end + 12)), 40)
    record.writeBigUInt64LE(BigInt(archive.readUInt32LE(end + 16)), 48)
    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(0x07064b50)
    locator.writeBigUInt64LE(BigInt(end), 8)
    locator.writeUInt32LE(1, 16)
    const ending = Buffer.from(archive.subarray(end))
    ending.writeUInt16LE(0xffff, 8)
    ending.writeUInt16LE(0xffff, 10)
    ending.writeUInt32LE(0xffffffff, 12)
    ending.writeUInt32LE(0xffffffff, 16)
    await expect(decodeCardBundleZip(Buffer.concat([archive.subarray(0, end), record, locator, ending])))
      .resolves.toMatchObject({ artifact: { card: { name: 'ZIP64' } } })
  })

  it.each([
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'image/avif', 'video/mp4', 'video/webm', 'image/x-example',
  ])('preserves %s bytes and MIME through ZIP, PNG container and directory loading', async mediaType => {
    const media = { bytes: Buffer.from(`opaque ${mediaType} test bytes`), mediaType }
    const archive = encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'media', displayName: 'Media', card: { name: 'Media' }, contextAssets: [] },
      avatar: media, background: media,
    })
    const entries = unzipSync(archive)
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString('utf8'))
    expect(manifest.mediaTypes[manifest.media.avatar]).toBe(mediaType)
    if (mediaType === 'image/x-example') expect(manifest.media.avatar).toBe('assets/avatar.bin')
    if (mediaType === 'image/svg+xml') expect(manifest.media.avatar).toBe('assets/avatar.svg')
    const embedded = readCardPngArchive(encodeCardBundlePng(defaultCardPng, archive))!
    for (const source of [archive, embedded]) {
      const decoded = await decodeCardBundleZip(source)
      expect(decoded.avatar.mediaType).toBe(mediaType)
      expect(Buffer.from(decoded.avatar.bytes)).toEqual(media.bytes)
      expect(decoded.background?.mediaType).toBe(mediaType)
      expect(Buffer.from(decoded.background!.bytes)).toEqual(media.bytes)
    }
    const directory = await loadCardBundleFiles(async path => entries[path]!)
    expect(directory.bundle.avatar.mediaType).toBe(mediaType)
    expect(Buffer.from(directory.bundle.avatar.bytes)).toEqual(media.bytes)
  })

  it.each(['image/png', 'image/apng'])('preserves a two-frame APNG asset as %s', async mediaType => {
    const chunk = (name: string, data: Buffer) => {
      const type = Buffer.from(name)
      const header = Buffer.alloc(4)
      header.writeUInt32BE(data.length)
      const checksum = Buffer.alloc(4)
      checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
      return Buffer.concat([header, type, data, checksum])
    }
    const header = Buffer.alloc(13)
    header.writeUInt32BE(1, 0)
    header.writeUInt32BE(1, 4)
    header[8] = 8
    header[9] = 6
    const control = Buffer.alloc(8)
    control.writeUInt32BE(2)
    const frame = (sequence: number) => {
      const data = Buffer.alloc(26)
      data.writeUInt32BE(sequence, 0)
      data.writeUInt32BE(1, 4)
      data.writeUInt32BE(1, 8)
      data.writeUInt16BE(1, 20)
      data.writeUInt16BE(10, 22)
      return chunk('fcTL', data)
    }
    const sequence = Buffer.alloc(4)
    sequence.writeUInt32BE(2)
    const bytes = Buffer.concat([
      defaultCardPng.subarray(0, 8), chunk('IHDR', header), chunk('acTL', control), frame(0),
      chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), frame(1),
      chunk('fdAT', Buffer.concat([sequence, deflateSync(Buffer.from([0, 0, 0, 255, 255]))])),
      chunk('IEND', Buffer.alloc(0)),
    ])
    const archive = encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'animation', displayName: 'Animation', card: { name: 'Animation' }, contextAssets: [] },
      avatar: { bytes, mediaType },
    })
    const decoded = await decodeCardBundleZip(readCardPngArchive(encodeCardBundlePng(bytes, archive))!)
    expect(decoded.avatar.mediaType).toBe(mediaType)
    expect(Buffer.from(decoded.avatar.bytes)).toEqual(bytes)
  })

  it('round-trips an Artifact with avatar and optional background', async () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 4,
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
    expect(manifest.artifact).toBeUndefined()
    expect(manifest.extensionPayloads?.[0]?.path).toBe('extensions/example.image-generator/image-style-v1/style.json')
  })

  it('rejects a non-V4 Artifact at the ZIP boundary', () => {
    expect(() => encodeCardBundleZip({
      artifact: {
        schemaVersion: 1,
        artifactId: 'legacy', displayName: 'Legacy', card: { name: 'Legacy' }, contextAssets: [],
      } as never,
      avatar: { bytes: new Uint8Array([1]), mediaType: 'image/png' },
    })).toThrow('Unsupported card bundle schemaVersion')
  })

  it('keeps external resource copies inside the package without losing provenance or order', async () => {
    const source = [
      '// ==LoomScript==', '// @format 1', '// @id external.panel', '// @name Panel',
      '// @version 1.0.0', '// @runtime client-sandbox',
      '// @contribution {"kind":"renderer","id":"panel","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:panel"]}',
      '// ==/LoomScript==', 'export const renderers = {}',
    ].join('\n')
    const artifact: CardBundleArtifact = {
      schemaVersion: 4, artifactId: 'alice', displayName: 'Alice', card: { name: 'Alice' },
      contextAssets: [
        { id: 'clothes', kind: 'module', label: 'Clothing guide', body: 'External text' },
        { id: 'alice', kind: 'module', label: 'Alice', body: 'Own text' },
      ],
      externalContextAssetIds: ['clothes'],
      scriptAttachments: [{
        resourceOrigin: 'external', orderIndex: 2,
        script: { format: 'loom.script', schemaVersion: 1, fileName: 'panel.loom.js', source },
      }],
      extensionPayloads: [{
        resourceOrigin: 'external', id: 'data', packageId: 'example.rpg', fileName: 'data.json',
        format: 'example.data', mediaType: 'application/json', content: '{"hp":10}',
      }],
    }
    const encode = () => encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    const entries = unzipSync(encode())
    expect(entries['external/prompts/0-Clothing guide/_content.md']).toBeDefined()
    expect(entries['prompts/1-Alice/_content.md']).toBeDefined()
    expect(entries['external/scripts/0-panel.loom.js']).toBeDefined()
    expect(entries['external/extensions/example.rpg/data/data.json']).toBeDefined()
    const decoded = await decodeCardBundleZip(zipSync(entries))
    expect(decoded.artifact).toMatchObject(artifact)
    expect(unzipSync(encodeCardBundleZip(decoded))).toEqual(entries)
    artifact.externalContextAssetIds = ['missing']
    expect(encode).toThrow('externalContextAssetIds')
    artifact.externalContextAssetIds = ['clothes', 'clothes']
    expect(encode).toThrow('externalContextAssetIds')
    artifact.externalContextAssetIds = []
    artifact.scriptAttachments![0]!.resourceOrigin = 'unknown' as never
    expect(encode).toThrow('resourceOrigin')
  })

  it('rejects input that is not a ZIP package', async () => {
    await expect(decodeCardBundleZip(Buffer.from('not zip'))).rejects.toThrow()
  })

  it('stores Script attachments as real .loom.js ZIP entries and restores them', async () => {
    const source = [
      '// ==LoomScript==',
      '// @format       1',
      '// @id           zip.script',
      '// @name         ZIP Script',
      '// @version      1.0.0',
      '// @runtime      client-sandbox',
      '// @contribution {"kind":"renderer","id":"zip-panel","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:zip.data"]}',
      '// ==/LoomScript==',
      'export const renderers = {}',
    ].join('\n')
    const artifact: CardBundleArtifact = {
      schemaVersion: 4,
      artifactId: 'script-card',
      displayName: 'Script Card',
      card: { name: 'Script Card' },
      contextAssets: [],
      scriptAttachments: [{ orderIndex: 2, script: { format: 'loom.script', schemaVersion: 1, fileName: 'zip.loom.js', source } }],
    }
    const archive = encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    const entries = unzipSync(archive)
    expect(Object.keys(entries)).toContain('scripts/0-zip.loom.js')
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString('utf8'))
    expect(manifest.artifact).toBeUndefined()
    expect(manifest.scriptAttachments[0].script.path).toBe('scripts/0-zip.loom.js')
    await expect(decodeCardBundleZip(archive)).resolves.toMatchObject({ artifact: { scriptAttachments: artifact.scriptAttachments } })
  })

  it('projects editable text, macros and 60 initialized entities without mutating the source', async () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 4, artifactId: 'world', displayName: 'World',
      card: {
        name: 'World', description: 'Original description',
        media: { avatarAssetId: 'original' },
        macros: { difficulty: 'hard for {{user}}' },
        preset: {
          system: 'System prompt', macros: { user: 'Player' },
          macroOptions: { tone: [{ id: 'quiet', label: 'Quiet', value: 'soft' }, { id: 'loud', label: 'Loud', value: 'bold' }] },
        },
        opening: { entries: [{ role: 'assistant', content: 'Opening text' }] },
        settingLayer: { entries: [{ id: 'legacy', content: 'Legacy text', enabled: true }] },
      },
      contextAssets: [{
        id: 'world-book', kind: 'module', label: '世界书', category: 'setting',
        children: [{
          id: 'alice', kind: 'entry', label: '爱丽丝', body: 'Alice greets {{user}}.\r\n',
          capabilities: { activation: { kind: 'always' }, targetAnchorId: '@setting.stable' },
        }],
      }],
      state: {
        kind: 'loom.state', schemaVersion: 1,
        contribution: {
          id: 'world-state',
          entityTypes: [{ id: 'character', collectionPath: 'entity.character' }],
          templates: [{
            id: 'vitals', templateVersion: 1, componentKey: 'vitals', targetEntityTypeIds: ['character'],
            schema: { type: 'object' }, initial: { hp: 100 },
          }],
          entities: Array.from({ length: 60 }, (_, i) => ({ typeId: 'character', entityId: `npc-${i}` })),
          componentMounts: [{
            templateId: 'vitals', templateVersion: 1, componentKey: 'vitals',
            target: { kind: 'entity-type', typeId: 'character' },
          }],
          bindings: [],
        },
      },
    }
    const before = structuredClone(artifact)
    const archive = encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    expect(artifact).toEqual(before)
    const entries = unzipSync(archive)
    const manifest = JSON.parse(Buffer.from(entries['manifest.json']!).toString())
    expect(manifest.schema).toBe('loom.cardBundle.zip.v2')
    expect(manifest).not.toHaveProperty('artifact')
    expect(Object.keys(entries).filter(path => path.startsWith('state/entities/'))).toHaveLength(60)
    expect(Object.keys(entries).some(path => path.startsWith('state/legacy-templates/'))).toBe(false)
    const promptIndex = JSON.parse(Buffer.from(entries[manifest.resources.contextAssets[0]]!).toString())
    const bodyPath = promptIndex.children[0].body
    expect(bodyPath).toMatch(/爱丽丝\.md$/)
    expect(Buffer.from(entries[bodyPath]!).toString()).toBe('Alice greets {{user}}.\r\n')
    entries[bodyPath] = Buffer.from('Edited by an external author.\n')
    entries['macros/card.json'] = Buffer.from('{"difficulty":"easy"}')
    // Explicit directory entries are emitted by ordinary ZIP tools.
    entries['prompts/'] = new Uint8Array()
    const result = await decodeCardBundleZip(zipSync(entries))
    expect(result.artifact.contextAssets[0]?.children?.[0]).toEqual({
      ...artifact.contextAssets[0]!.children![0], body: 'Edited by an external author.\n',
    })
    expect(result.artifact.card.macros).toEqual({ difficulty: 'easy' })
    expect(result.artifact.card.preset).toEqual(artifact.card.preset)
    expect(result.artifact.card.opening).toEqual(artifact.card.opening)
    expect(result.artifact.card.settingLayer).toEqual(artifact.card.settingLayer)
    expect(result.artifact.state).toEqual(artifact.state)
    const materialized = materializeStateContribution(result.artifact.state!.contribution)
    expect(materialized.components).toHaveLength(60)
    const loaded = await loadCardBundleFiles(async path => {
      const bytes = entries[path]
      if (!bytes) throw new Error(`Missing ${path}`)
      return bytes
    })
    expect(loaded.bundle.artifact).toEqual(result.artifact)
    expect(Buffer.from(loaded.bundle.avatar.bytes)).toEqual(Buffer.from(result.avatar.bytes))
    expect(loaded.files.has('prompts/')).toBe(false)
  })

  it('rejects legacy ZIP v1 artifacts', async () => {
    const archive = zipSync({
      'manifest.json': Buffer.from(JSON.stringify({
        schema: 'loom.cardBundle.zip.v1',
        artifact: { schemaVersion: 2, artifactId: 'old', displayName: 'Old', card: { name: 'Old' }, contextAssets: [] },
        media: { avatar: 'assets/avatar.png' },
      })),
      'assets/avatar.png': Buffer.from('avatar'),
    })
    await expect(decodeCardBundleZip(archive)).rejects.toThrow('Unsupported card bundle schemaVersion')
  })

  it('reuses identical old inline entries without generating a legacy directory', async () => {
    const artifact: CardBundleArtifact = {
      schemaVersion: 4, artifactId: 'dedup', displayName: 'Dedup',
      card: {
        name: 'Dedup',
        settingLayer: { entries: [
          { id: 'alice', title: 'Alice', content: 'One shared source.' },
          { id: 'other', title: 'Other', content: 'Independent inline content.' },
        ] },
      },
      contextAssets: [{
        id: 'book', kind: 'module', label: 'Book', children: [
          { id: 'alice', kind: 'entry', label: 'Alice', body: 'One shared source.' },
        ],
      }],
    }
    const archive = encodeCardBundleZip({ artifact, avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' } })
    const files = unzipSync(archive)
    expect(Object.keys(files).some(path => path.includes('/legacy/'))).toBe(false)
    expect(Object.keys(files).filter(path => path.endsWith('.md'))).toHaveLength(2)
    const card = JSON.parse(Buffer.from(files['card.json']!).toString())
    expect(card.settingLayer.entries[0].content).toBe('prompts/0-Book/0-Alice.md')
    const restored = await decodeCardBundleZip(archive)
    expect(restored.artifact.card.settingLayer).toEqual(artifact.card.settingLayer)
    expect(restored.artifact.contextAssets).toEqual(artifact.contextAssets)
  })

  it('rejects missing, unsafe and invalid UTF-8 file references', async () => {
    const entries = unzipSync(encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'a', displayName: 'A', card: { name: 'A', description: 'text' }, contextAssets: [] },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }))
    const missing = { ...entries }
    delete missing['card/description.md']
    await expect(decodeCardBundleZip(zipSync(missing))).rejects.toThrow('missing card/description.md')
    await expect(decodeCardBundleZip(zipSync({ ...entries, '../escape.md': Buffer.from('no') }))).rejects.toThrow('Unsafe ZIP')
    await expect(decodeCardBundleZip(zipSync({ ...entries, 'card/description.md': new Uint8Array([0xff]) }))).rejects.toThrow()
    await expect(decodeCardBundleZip(zipSync({ ...entries, 'card.json': Buffer.from('{') }))).rejects.toThrow()
  })

  it('rejects duplicate ZIP entries and excessive entry counts', async () => {
    const chunks: Uint8Array[] = []
    const archive = new Zip((error, data) => {
      if (error) throw error
      chunks.push(data)
    })
    for (let i = 0; i < 2; i += 1) {
      const file = new ZipPassThrough('manifest.json')
      archive.add(file)
      file.push(Buffer.from('{}'), true)
    }
    archive.end()
    await expect(decodeCardBundleZip(Buffer.concat(chunks))).rejects.toThrow('Duplicate ZIP entry')
    const tooManyFiles = Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [`${i}.md`, new Uint8Array()]))
    await expect(decodeCardBundleZip(zipSync(tooManyFiles))).rejects.toThrow('exceeds 4096 entries')
  })
})
