import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readOfficialContent } from '../../../apps/studio-server/src/official/official-content.js'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { callRpc } from './helpers.js'

type PackageListing = {
  packages: Array<{ id: string; digest: string; resources: Array<{ id: string; resourceKind: string; available: boolean }> }>
}

describe('official content installation', () => {
  it('does not seed starter content or restore a deleted legacy resource after restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-retired-starter-'))
    const options = { localPaths: resolveLoomStudioLocalPaths({ home: directory }), secretBackend: createMemorySecretBackend(), extensionRootDirectory: join(directory, 'empty') }
    const server = createStudioServer({ ...options, officialContentDirectory: resolve('tests/fixtures/legacy-official-starter') })
    const legacyId = 'prompt-resource.official.loom-knowledge'
    try {
      const { port } = await server.listen(0)
      const before = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', {})
      expect(before.resources.some(item => item.id === legacyId)).toBe(false)
      const { packages: [content] } = await callRpc<PackageListing>(port, 'official.listContent', {})
      await callRpc(port, 'official.installContent', { packageId: content!.id, digest: content!.digest })
      await callRpc(port, 'application.deletePromptResource', { resourceId: legacyId })
    } finally { await server.close() }
    const restarted = createStudioServer(options)
    try {
      const { port } = await restarted.listen(0)
      expect(await callRpc(port, 'official.listContent', {})).toEqual({ packages: [] })
      const resources = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', {})
      expect(resources.resources.some(item => item.id === legacyId)).toBe(false)
      // Retirement does not delete or rebind the user's remaining legacy resources.
      expect(resources.resources.some(item => item.id === 'prompt-resource.official.loom-assistant')).toBe(true)
    } finally { await restarted.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects package file escape before reading resources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-official-invalid-'))
    try {
      await writeFile(join(directory, 'catalog.json'), JSON.stringify({
        id: 'official.test', version: '0.1.0', name: 'Test',
        resources: [{ id: 'invalid', path: '../outside.json' }], loreMounts: [], agents: [],
      }))
      await expect(readOfficialContent(directory)).rejects.toThrow('Invalid official content path')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
