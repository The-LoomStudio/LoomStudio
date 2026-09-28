import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { callRpc } from './helpers.js'

let directory: string | undefined
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

it('requires declared client notifications, persists explicit grants and supports revocation', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-ui-grants-')))
  directory = root
  const options = {
    localPaths: resolveLoomStudioLocalPaths({ home: join(root, 'home'), environment: {} }),
    extensionRootDirectory: join(root, 'repository'),
    secretBackend: createMemorySecretBackend(),
  }
  const first = createStudioServer(options)
  try {
    const sourceDirectory = join(root, 'source')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({
      manifestVersion: 2, id: 'example.notify', version: '1.0.0', displayName: 'Notify',
      engines: { studio: '^0.1.0' },
      modules: [
        { id: 'client', runtime: 'client', entry: './client.js', capabilities: { 'ui.notify': true } },
        { id: 'undeclared', runtime: 'client', entry: './client.js' },
      ],
    }))
    await writeFile(join(sourceDirectory, 'client.js'), 'export function activate() {}')
    const { port } = await first.listen(0)
    await callRpc(port, 'extensions.installPackage', { sourceDirectory })
    await expect(callRpc(port, 'extensions.enableModule', { packageId: 'example.notify', moduleId: 'client' }))
      .resolves.toMatchObject({ module: { requestedUiCapabilities: ['ui.notify'], desired: { grants: { ui: [] } } } })
    await expect(callRpc(port, 'extensions.enableModule', {
      packageId: 'example.notify', moduleId: 'undeclared', grants: { ui: ['ui.notify'] },
    })).rejects.toThrow()
    await expect(callRpc(port, 'extensions.enableModule', {
      packageId: 'example.notify', moduleId: 'client', grants: { ui: ['ui.write'] },
    })).rejects.toThrow()
    await callRpc(port, 'extensions.enableModule', {
      packageId: 'example.notify', moduleId: 'client', grants: { ui: ['ui.notify'] },
    })
  } finally { await first.close() }

  const second = createStudioServer(options)
  try {
    const { port } = await second.listen(0)
    await expect(callRpc(port, 'extensions.listPackages', {})).resolves.toMatchObject({
      items: [{ modules: expect.arrayContaining([expect.objectContaining({
        moduleId: 'client', requestedUiCapabilities: ['ui.notify'],
        desired: expect.objectContaining({ enabled: true, grants: expect.objectContaining({ ui: ['ui.notify'] }) }),
      })]) }],
    })
    await expect(callRpc(port, 'extensions.enableModule', {
      packageId: 'example.notify', moduleId: 'client', grants: { ui: [] },
    })).resolves.toMatchObject({ module: { desired: { enabled: true, grants: { ui: [] } } } })
  } finally {
    await second.close()
  }
})
