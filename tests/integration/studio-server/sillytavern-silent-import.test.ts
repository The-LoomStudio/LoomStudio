import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { callRpc } from './helpers.js'

describe('studio server converter lifecycle contract', () => {
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
