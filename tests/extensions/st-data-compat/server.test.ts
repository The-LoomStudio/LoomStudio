import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaultCardPng, encodeCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { authenticatedFetch, callRpc, withStudioServer as withMainStudioServer } from '../../integration/studio-server/helpers.js'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ExtensionInstallationTarget, ExtensionRpcHandler } from '@loom-studio/extension-sdk'
import * as instanceLoader from '../../../packages/extension-sdk/extension-host/src/instance.js'
import { activate } from '../../../official/extensions/st-data-compat/src/index.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdtemp: vi.fn(actual.mkdtemp),
    readFile: vi.fn(actual.readFile),
    writeFile: vi.fn(actual.writeFile),
  }
})

async function withMigrationHost(run: (fixture: {
  host: ReturnType<typeof createExtensionHost>
  activateTarget(target?: ExtensionInstallationTarget): Promise<string>
  call(instanceId: string, action: string, params?: Parameters<ExtensionRpcHandler>[0]): ReturnType<ExtensionRpcHandler>
  sourceDirectory: string
  stagingDirectories(): Promise<string[]>
}) => Promise<void>) {
  const sourceDirectory = await mkdtemp(join(tmpdir(), 'loom-st-lifecycle-source-'))
  await mkdir(join(sourceDirectory, 'characters'))
  await writeFile(join(sourceDirectory, 'characters', 'Hero.json'), JSON.stringify({ name: 'Hero', description: 'Temporary fixture' }))
  const handlers = new Map<string, ExtensionRpcHandler>()
  const loader = vi.spyOn(instanceLoader, 'loadServerModule').mockResolvedValue({ activate })
  const host = createExtensionHost({
    documents: createInMemoryDocumentStore(), diagnostics: createInMemoryDiagnosticsRegistry(),
    callRpc: async () => null,
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
      const key = `${ownerInstanceId}/${name}`
      handlers.set(key, handler)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: () => { handlers.delete(key) } }
    },
  })
  const firstTempCall = vi.mocked(mkdtemp).mock.calls.length
  const stagingDirectories = async () => {
    const results = vi.mocked(mkdtemp).mock.results
    return Promise.all(vi.mocked(mkdtemp).mock.calls.flatMap(([prefix], index) =>
      index >= firstTempCall && String(prefix).includes('loom-st-migration-')
        ? [results[index]!.value as Promise<string>] : []))
  }
  try {
    await run({
      host, sourceDirectory, stagingDirectories,
      activateTarget: async (target = { kind: 'global' }) => {
        await host.discover(resolve('official/extensions/st-data-compat'), target)
        const active = await host.activate('sillytavern.importer', 'server', target)
        expect(active.state).toBe('active')
        return active.instance!.instanceId
      },
      call: (instanceId, action, params = {}) => {
        const handler = handlers.get(`${instanceId}/sillytavern.importer.migration.${action}`)
        if (!handler) throw new Error('Migration RPC is not registered')
        return handler(params, { packageId: 'sillytavern.importer', moduleId: 'server', instanceId })
      },
    })
  } finally {
    await host.disposeAll()
    loader.mockRestore()
    await Promise.all((await stagingDirectories()).map(directory => rm(directory, { recursive: true, force: true })))
    await rm(sourceDirectory, { recursive: true, force: true })
  }
}

describe('SillyTavern migration lifecycle', () => {
  it.each(['dispose', 'cancel'] as const)('waits for an in-flight scan on %s and prevents late staging writes', async action => {
    await withMigrationHost(async ({ host, activateTarget, call, sourceDirectory, stagingDirectories }) => {
      const instanceId = await activateTarget()
      let release!: () => void
      let entered!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const reading = new Promise<void>(resolve => { entered = resolve })
      const original = vi.mocked(readFile).getMockImplementation()!
      vi.mocked(readFile).mockImplementationOnce(async (...args: Parameters<typeof readFile>) => {
        const source = await original(...args)
        entered()
        await gate
        return source
      })
      const firstWrite = vi.mocked(writeFile).mock.calls.length
      const started = await call(instanceId, 'start', { directory: sourceDirectory }) as { sessionId: string }
      await reading
      const [stagingDirectory] = await stagingDirectories()
      expect(await readdir(stagingDirectory!)).toEqual([])
      let settled = false
      const stopping = (action === 'dispose'
        ? host.dispose('sillytavern.importer', 'server')
        : Promise.resolve(call(instanceId, 'cancel', { sessionId: started.sessionId })))
        .then(() => { settled = true })
      try {
        await new Promise(resolve => setImmediate(resolve))
        expect(settled).toBe(false)
      } finally {
        release()
        await stopping
        await new Promise(resolve => setImmediate(resolve))
        await Promise.all(vi.mocked(writeFile).mock.results.slice(firstWrite).map(result => result.value))
      }
      expect(vi.mocked(writeFile).mock.calls.slice(firstWrite).filter(([path]) => String(path).startsWith(stagingDirectory!))).toEqual([])
      await expect(stat(stagingDirectory!)).rejects.toMatchObject({ code: 'ENOENT' })
      if (action === 'cancel') await expect(call(instanceId, 'inspect', { sessionId: started.sessionId })).rejects.toThrow('not found')
    })
  })

  it('cleans completed and upload sessions on dispose/reload without touching another Card activation', async () => {
    await withMigrationHost(async ({ host, activateTarget, call, sourceDirectory, stagingDirectories }) => {
      const a = { kind: 'card' as const, cardId: 'A' }
      const b = { kind: 'card' as const, cardId: 'B' }
      const aInstance = await activateTarget(a)
      const bInstance = await activateTarget(b)
      const scanned = await call(aInstance, 'start', { directory: sourceDirectory }) as { sessionId: string }
      await expect.poll(async () => (await call(aInstance, 'inspect', { sessionId: scanned.sessionId }) as { scan: { status: string } }).scan.status).toBe('completed')
      const upload = await call(aInstance, 'start') as { sessionId: string }
      const retained = await call(bInstance, 'start') as { sessionId: string }
      const [scannedDirectory, uploadDirectory, retainedDirectory] = await stagingDirectories()
      await call(bInstance, 'appendBatch', { sessionId: retained.sessionId, files: [{ path: 'characters/Other.json', source: '{"name":"Other"}' }] })
      await host.dispose('sillytavern.importer', 'server', a)
      await expect(stat(scannedDirectory!)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(uploadDirectory!)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(retainedDirectory!)).length).toBe(1)
      const reloaded = await host.reload('sillytavern.importer', 'server', a)
      const newInstance = reloaded.instance!.instanceId
      expect(newInstance).not.toBe(aInstance)
      for (const sessionId of [scanned.sessionId, upload.sessionId, retained.sessionId]) {
        await expect(call(newInstance, 'inspect', { sessionId })).rejects.toThrow('not found')
      }
      await expect(call(bInstance, 'inspect', { sessionId: retained.sessionId })).resolves.toMatchObject({ files: 1 })
      const completed = await call(newInstance, 'start', { directory: sourceDirectory }) as { sessionId: string }
      await expect.poll(async () => (await call(newInstance, 'inspect', { sessionId: completed.sessionId }) as { scan: { status: string } }).scan.status).toBe('completed')
      const completedDirectory = (await stagingDirectories()).at(-1)!
      await host.reload('sillytavern.importer', 'server', a)
      await expect(stat(completedDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
      await call(bInstance, 'cancel', { sessionId: retained.sessionId })
      await expect(stat(retainedDirectory!)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })
})

const withStudioServer: typeof withMainStudioServer = run => withMainStudioServer(run, resolve('official/extensions'))

function createMockPngWithText(keyword: string, text: string): Uint8Array<ArrayBuffer> {
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

  return new Uint8Array(Buffer.concat([signature, ihdrChunk, textChunk, iendChunk]))
}

describe('studio server SillyTavern silent import pipeline', () => {
  it('scans a Data parent directory through its default-user child', async () => {
    await withStudioServer(async port => {
      const dataDirectory = await mkdtemp(join(tmpdir(), 'loom-st-parent-scan-'))
      await mkdir(join(dataDirectory, 'default-user', 'characters'), { recursive: true })
      await writeFile(join(dataDirectory, 'default-user', 'characters', 'Hero.json'), JSON.stringify({
        name: 'Hero',
        description: 'A test character.',
      }))

      try {
        await callRpc(port, 'extensions.enableModule', { packageId: 'sillytavern.importer', moduleId: 'server' })
        const started = await callRpc<{ sessionId: string }>(port, 'sillytavern.importer.migration.start', { directory: dataDirectory })
        let report: { files: number; scan: { status: string; processed: number; total: number } } | undefined
        for (let attempt = 0; attempt < 20; attempt += 1) {
          report = await callRpc<NonNullable<typeof report>>(port, 'sillytavern.importer.migration.inspect', { sessionId: started.sessionId })
          if (report.scan.status !== 'scanning') break
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        expect(report?.scan.status).toBe('completed')
        expect(report?.files).toBe(1)
        expect(report?.scan.processed).toBe(1)
        await callRpc(port, 'sillytavern.importer.migration.cancel', { sessionId: started.sessionId })
      } finally {
        await rm(dataDirectory, { recursive: true, force: true })
      }
    })
  })

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
        body: new Uint8Array(encodeCardPng(defaultCardPng, {
          schemaVersion: 4, artifactId: 'native-card', displayName: 'Native card',
          card: { name: 'Native card' }, contextAssets: [],
        })),
      })
      expect(nativeResponse.status).toBe(201)
      await callRpc(port, 'extensions.enableModule', module)
      await expect(importLore()).resolves.toHaveProperty('resource')
    })
  })
})

function nativeSetting(label: string) {
  return {
    format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'setting',
    rootNode: { id: 'test.setting', label, meta: '', category: 'setting', kind: 'module', body: '', children: [] },
  }
}
