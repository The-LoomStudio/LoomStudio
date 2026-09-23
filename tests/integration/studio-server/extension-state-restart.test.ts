import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { callRpc } from './helpers.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Studio Server Extension state restart', () => {
  it('restores an enabled module and its state subscription grant after recreating the server', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-extension-state-restart-')))
    temporaryDirectories.push(root)
    const sourceDirectory = join(root, 'package-source')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: 'example.state',
      version: '1.0.0',
      displayName: 'State Subscription',
      engines: { studio: '^0.1.0' },
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './index.js',
        capabilities: { 'events.subscribe': ['state'] },
        contributes: { rpc: [{ name: 'example.state.status' }] },
      }],
    }))
    await writeFile(join(sourceDirectory, 'index.js'), `
export function activate(ctx) {
  ctx.events.subscribe(['state.changed'], () => {})
  ctx.rpc.register('example.state.status', () => ({
    active: true,
    grants: ctx.permissions.events.subscribe,
  }))
}
`)
    const options = {
      localPaths: resolveLoomStudioLocalPaths({ home: join(root, 'home'), environment: {} }),
      extensionRootDirectory: join(root, 'empty-repository'),
      secretBackend: createMemorySecretBackend(),
    }
    const first = createStudioServer(options)
    try {
      const { port } = await first.listen(0)
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await expect(callRpc(port, 'extensions.enableModule', {
        packageId: 'example.state',
        moduleId: 'server',
        grants: { 'events.subscribe': ['state'] },
      })).resolves.toMatchObject({
        module: { desired: { enabled: true, grants: { 'events.subscribe': ['state'] } } },
      })
      await expect(callRpc(port, 'example.state.status', {})).resolves.toEqual({ active: true, grants: ['state'] })
    } finally {
      await first.close()
    }

    const second = createStudioServer(options)
    try {
      const { port } = await second.listen(0)
      await expect(callRpc(port, 'example.state.status', {})).resolves.toEqual({ active: true, grants: ['state'] })
      await expect(callRpc(port, 'extensions.listPackages', {})).resolves.toMatchObject({
        items: [{
          packageId: 'example.state',
          modules: [{
            moduleId: 'server',
            desired: { enabled: true, grants: { 'events.subscribe': ['state'] } },
          }],
        }],
      })
    } finally {
      await second.close()
    }
  })
})
