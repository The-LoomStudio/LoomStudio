import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { defaultCardPng, encodeCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

function createMockPngWithText(keyword: string, text: string): Uint8Array {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(1, 0)
  ihdrData.writeUInt32BE(1, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6

  const makeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  const ihdrChunk = makeChunk('IHDR', ihdrData)
  const textPayload = Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0]),
    Buffer.from(Buffer.from(text, 'utf8').toString('base64'), 'utf8'),
  ])
  const textChunk = makeChunk('tEXt', textPayload)
  const iendChunk = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdrChunk, textChunk, iendChunk])
}

describe('studio server SillyTavern silent import pipeline', () => {
  it('seamlessly imports SillyTavern PNG Card via /cards/import/png endpoint', async () => {
    await withStudioServer(async port => {
      await callRpc(port, 'extensions.enableModule', { packageId: 'sillytavern.importer', moduleId: 'server' })
      const stCard = {
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: {
          name: 'Elena Frost',
          description: 'A wandering cryogenic archer.',
          system_prompt: 'Keep tone calm and cold.',
          first_mes: 'The blizzard is setting in.',
          post_history_instructions: 'Format all arrows in asterisks.',
          character_book: {
            name: 'Frost Lore',
            entries: [
              {
                id: 1,
                keys: ['glacier'],
                comment: 'Glacier Arrow',
                content: 'Glacier Arrow freezes targets on hit.',
                constant: false,
                position: 'before_char',
              },
              {
                id: 2,
                keys: ['mvu'],
                comment: 'Freeze Law',
                content: 'Decrease target temperature by 10.',
                constant: true,
                position: 'at_depth',
                depth: 0,
              },
            ],
          },
        },
      }

      const png = createMockPngWithText('ccv3', JSON.stringify(stCard))
      const response = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: png,
      })

      expect(response.status).toBe(201)
      const body = await response.json() as {
        card: {
          id: string
          name: string
          description?: string
          media?: { avatarAssetId?: string }
        }
      }

      expect(body.card.name).toBe('Elena Frost')
      expect(body.card.description).toBe('A wandering cryogenic archer.')
      expect(body.card.media?.avatarAssetId).toBeDefined()

      // Verify the card's avatar asset can be read from server
      const avatarRes = await authenticatedFetch(port, `/assets/${body.card.media!.avatarAssetId}`)
      expect(avatarRes.status).toBe(200)
      expect(avatarRes.headers.get('content-type')).toBe('image/png')
    })
  })

  it('seamlessly imports SillyTavern Lorebook JSON via application.importPromptResource', async () => {
    await withStudioServer(async port => {
      await callRpc(port, 'extensions.enableModule', { packageId: 'sillytavern.importer', moduleId: 'server' })
      const stLorebook = {
        name: 'Cyberpunk City Lore',
        entries: [
          {
            id: 10,
            keys: ['cyberdeck'],
            comment: 'Cyberdeck Specs',
            content: 'High-end neural interface terminal.',
            constant: false,
            position: 'before_char',
          },
          {
            id: 20,
            keys: ['police_dispatch'],
            comment: 'NCPD Dispatch Protocol',
            content: 'Maintain high bounty warning at session tail.',
            constant: true,
            position: 'at_depth',
            depth: 0,
          },
        ],
      }

      const result = await callRpc<{
        resource: {
          id: string
          resourceKind: string
          rootNode: { label: string; children: unknown[] }
        }
      }>(port, 'application.importPromptResource', {
        artifact: stLorebook,
      })

      expect(result.resource.resourceKind).toBe('setting')
      expect(result.resource.rootNode.label).toBe('Cyberpunk City Lore')
      expect(result.resource.rootNode.children).toHaveLength(2)
    })
  })

  it('seamlessly imports SillyTavern Preset JSON with Auto-Squash via application.importPromptResource', async () => {
    await withStudioServer(async port => {
      await callRpc(port, 'extensions.enableModule', { packageId: 'sillytavern.importer', moduleId: 'server' })
      const stPreset = {
        prompts: [
          {
            identifier: 'main',
            name: 'Main System',
            role: 'system',
            content: 'You are an AI narrator.',
          },
          {
            identifier: 'chatHistory',
            name: 'Chat History',
            marker: true,
          },
          {
            identifier: 'postInstructions',
            name: 'Post Session Rule',
            content: 'End response with a choice.',
          },
        ],
      }

      const result = await callRpc<{
        resource: {
          id: string
          resourceKind: string
          rootNode: { label: string; children: Array<{ label: string; kind?: string }> }
        }
      }>(port, 'application.importPromptResource', {
        artifact: stPreset,
        name: 'ST Custom Preset',
      })

      expect(result.resource.resourceKind).toBe('preset')
      expect(result.resource.rootNode.label).toBe('ST Custom Preset')
      expect(result.resource.rootNode.children).toHaveLength(4)
      expect(result.resource.rootNode.children.some(c => c.label.includes('Post Session'))).toBe(true)
    })
  })

  it('requires an active ST module while native resources remain importable', async () => {
    await withStudioServer(async port => {
      const module = { packageId: 'sillytavern.importer', moduleId: 'server' }
      const artifact = { name: 'Lifecycle lore', entries: [{ keys: ['test'], content: 'Test lore' }] }
      const importLore = () => callRpc(port, 'application.importPromptResource', { artifact })
      await expect(importLore()).rejects.toThrow('method not found')
      await callRpc(port, 'extensions.enableModule', module)
      await expect(importLore()).resolves.toHaveProperty('resource')
      await callRpc(port, 'extensions.disableModule', module)
      await expect(importLore()).rejects.toThrow('method not found')
      await expect(callRpc(port, 'application.importPromptResource', {
        artifact: nativeSetting('Native without extension'),
      })).resolves.toHaveProperty('resource')
      const response = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: createMockPngWithText('ccv3', JSON.stringify({
          spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Disabled card' },
        })),
      })
      expect(response.ok).toBe(false)
      const nativeResponse = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: encodeCardPng(defaultCardPng, {
          schemaVersion: 2, artifactId: 'native-card', displayName: 'Native card',
          card: { name: 'Native card' }, contextAssets: [],
        }),
      })
      expect(nativeResponse.status).toBe(201)
      await callRpc(port, 'extensions.enableModule', module)
      await expect(importLore()).resolves.toHaveProperty('resource')
    })
  })

  it('uses the current installed converter after reload and stops using it after uninstall', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-import-lifecycle-'))
    const localPaths = resolveLoomStudioLocalPaths({ home: dir })
    const server = createStudioServer({ localPaths, extensionRootDirectory: join(dir, 'empty-repository') })
    try {
      const { port } = await server.listen(0)
      const sourceDirectory = join(dir, 'converter')
      await mkdir(sourceDirectory)
      await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({
        manifestVersion: 2, id: 'sillytavern.importer', version: '1.0.0',
        displayName: 'Test Converter', engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server', runtime: 'server', entry: './index.js',
          contributes: { rpc: [{ name: 'sillytavern.importer.convertPromptResource' }] },
        }],
      }))
      const entry = (label: string) => `export function activate(ctx) {
        ctx.rpc.register('sillytavern.importer.convertPromptResource', () => ({
          artifact: ${JSON.stringify(nativeSetting(label))}
        }))
      }`
      await writeFile(join(sourceDirectory, 'index.js'), entry('First instance'))
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      const module = { packageId: 'sillytavern.importer', moduleId: 'server' }
      await callRpc(port, 'extensions.enableModule', module)
      const importResource = () => callRpc(port, 'application.importPromptResource', { artifact: { external: true } })
      await expect(importResource()).resolves.toMatchObject({ resource: { rootNode: { label: 'First instance' } } })
      const installedEntry = join(localPaths.extensionInstalledRoot, 'sillytavern.importer', '1.0.0', 'index.js')
      await writeFile(installedEntry, entry('Reloaded instance'))
      await callRpc(port, 'extensions.reloadModule', module)
      await expect(importResource()).resolves.toMatchObject({ resource: { rootNode: { label: 'Reloaded instance' } } })
      await writeFile(installedEntry, `export function activate(ctx) {
        ctx.rpc.register('sillytavern.importer.convertPromptResource', () => ({ artifact: {} }))
      }`)
      await callRpc(port, 'extensions.reloadModule', module)
      await expect(importResource()).rejects.toThrow('invalid Prompt Resource artifact')
      await callRpc(port, 'extensions.uninstallPackage', { packageId: 'sillytavern.importer', version: '1.0.0' })
      await expect(importResource()).rejects.toThrow('method not found')
    } finally {
      await server.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function nativeSetting(label: string) {
  return {
    format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'setting',
    rootNode: { id: 'test.setting', label, meta: '', category: 'setting', kind: 'module', body: '', children: [] },
  }
}
