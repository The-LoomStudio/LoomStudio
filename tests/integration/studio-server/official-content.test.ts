import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readOfficialContent } from '../../../apps/studio-server/src/official/official-content.js'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { callRpc, withStudioServer } from './helpers.js'

type PackageListing = {
  packages: Array<{ id: string; digest: string; resources: Array<{ id: string; available: boolean }>; agents: Array<{ presetId: string }> }>
}

describe('official content installation', () => {
  it('starts empty, installs on confirmation, exports original files, and preserves user edits on reinstall', async () => {
    await withStudioServer(async port => {
      const before = await callRpc<{ resources: unknown[] }>(port, 'application.listPromptResources', {})
      expect(before.resources).toEqual([])
      const extensions = await callRpc<{ items: Array<{ packageId: string }> }>(port, 'extensions.listPackages', {})
      expect(extensions.items.some(item => item.packageId === 'example.echo' || item.packageId === 'example.weatherStation')).toBe(false)
      const { packages: [content] } = await callRpc<PackageListing>(port, 'official.listContent', {})
      expect(content!.resources.every(resource => !resource.available)).toBe(true)
      const input = { packageId: content!.id, digest: content!.digest }
      await expect(callRpc(port, 'official.installContent', { ...input, digest: 'stale' })).rejects.toThrow('refresh and confirm')
      const installed = await callRpc<{ resources: Array<{ id: string; created: boolean }> }>(port, 'official.installContent', input)
      expect(installed.resources.every(resource => resource.created)).toBe(true)
      const presetId = content!.agents[0]!.presetId
      await expect(callRpc(port, 'application.listSettingMounts', { source: { kind: 'preset', id: presetId } })).resolves.toMatchObject({
        mounts: [{ settingResourceId: 'prompt-resource.official.loom-knowledge' }],
      })
      const preset = await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: presetId })
      await callRpc(port, 'application.updatePromptResourceMacros', { resourceId: presetId, expectedVersion: preset.resource.version, macros: { difficulty: 'custom' } })
      const afterEdit = await callRpc<{ resource: { version: number; macros: Record<string, string> } }>(port, 'application.getPromptResource', { resourceId: presetId })
      const repeated = await callRpc<{ resources: Array<{ created: boolean }>; mutation?: unknown }>(port, 'official.installContent', input)
      expect(repeated.resources.every(resource => !resource.created)).toBe(true)
      expect(repeated.mutation).toBeUndefined()
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: presetId })).resolves.toEqual(afterEdit)
      const exported = await callRpc<{ base64: string; fileName: string }>(port, 'official.exportContent', input)
      expect(exported.fileName).toBe('official.starter-0.1.0.zip')
      const files = unzipSync(Buffer.from(exported.base64, 'base64'))
      expect(Object.keys(files).sort()).toEqual(['catalog.json', 'presets/assistant.json', 'settings/knowledge.json'])
      const directory = await mkdtemp(join(tmpdir(), 'loom-official-roundtrip-'))
      try {
        for (const [path, bytes] of Object.entries(files)) {
          expect(Buffer.from(bytes)).toEqual(await readFile(resolve('official/starter', path)))
          await mkdir(dirname(join(directory, path)), { recursive: true })
          await writeFile(join(directory, path), bytes)
        }
        expect((await readOfficialContent(directory)).digest).toBe(content!.digest)
        const freshServer = createStudioServer({
          localPaths: resolveLoomStudioLocalPaths({ home: join(directory, 'workspace') }),
          secretBackend: createMemorySecretBackend(),
          officialContentDirectory: directory,
        })
        try {
          const fresh = await freshServer.listen(0)
          await expect(callRpc(fresh.port, 'application.listPromptResources', {})).resolves.toEqual({ resources: [] })
          const reinstalled = await callRpc<{ resources: Array<{ id: string; created: boolean }> }>(fresh.port, 'official.installContent', input)
          expect(reinstalled.resources).toEqual(installed.resources)
        } finally {
          await freshServer.close()
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  it('rejects package file escape before reading resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-official-invalid-'))
    try {
      await writeFile(join(directory, 'catalog.json'), JSON.stringify({
        id: 'official.test', version: '0.1.0', name: 'Test',
        resources: [{ id: 'invalid', path: '../outside.json' }], settingMounts: [], agents: [],
      }))
      await expect(readOfficialContent(directory)).rejects.toThrow('Invalid official content path')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
