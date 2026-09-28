import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost, type ExtensionHost, type ExtensionRpcRegistration } from '@loom-studio/extension-host'
import { afterEach, describe, expect, it } from 'vitest'
import { createServerExtensionManager } from '../../../apps/studio-server/src/extensions/extension-manager.js'
import { createExtensionStateStore } from '../../../apps/studio-server/src/extensions/extension-state-store.js'

const packageId = 'example.uninstall'
const moduleIds = ['first', 'second']
const temporaryDirectories: string[] = []
const hosts: ExtensionHost[] = []

afterEach(async () => {
  try {
    await Promise.all(hosts.splice(0).map(host => host.disposeAll()))
  } finally {
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  }
})

async function createFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-extension-uninstall-')))
  temporaryDirectories.push(root)
  const sourceDirectory = join(root, 'source')
  await mkdir(sourceDirectory)
  await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: packageId,
    version: '1.0.0',
    displayName: 'Uninstall Fixture',
    engines: { studio: '^0.1.0' },
    modules: moduleIds.map(id => ({
      id,
      runtime: 'server',
      entry: './index.mjs',
      capabilities: { 'events.subscribe': ['state'], 'assets.read': true },
      contributes: { rpc: [{ name: `${packageId}.${id}.status` }] },
    })),
  }))
  await writeFile(join(sourceDirectory, 'index.mjs'), `
export function activate(ctx) {
  const moduleId = ctx.extension.moduleId
  ctx.rpc.register('example.uninstall.' + moduleId + '.status', () => ({ active: true }))
  ctx.lifecycle.onDispose(() => {
    if (moduleId === 'first') throw new Error('first onDispose failed')
  })
}
`)
  const devLinksFile = join(root, 'dev-links.json')
  await writeFile(devLinksFile, JSON.stringify({ extensions: [{ id: packageId, path: sourceDirectory }] }))
  return { root, sourceDirectory, devLinksFile, stateFile: join(root, 'state.json') }
}

function createRuntime(paths: Awaited<ReturnType<typeof createFixture>>) {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const stateStore = createExtensionStateStore({ filename: paths.stateFile, now: () => '2026-09-22T00:00:00.000Z' })
  const registrations = new Map<string, ExtensionRpcRegistration>()
  const host = createExtensionHost({
    documents: createInMemoryDocumentStore(),
    diagnostics,
    grantEventCapabilities: (_, module) => stateStore.get(packageId, module.id)?.grantedEventCapabilities ?? [],
    grantAssetCapabilities: (_, module) => stateStore.get(packageId, module.id)?.grantedAssetCapabilities ?? [],
    callRpc: async () => null,
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
      const registration: ExtensionRpcRegistration = {
        name, ownerPackageId, ownerModuleId, handler, ownerInstanceId,
        dispose: () => { if (registrations.get(name) === registration) registrations.delete(name) },
      }
      registrations.set(name, registration)
      return registration
    },
  })
  hosts.push(host)
  const manager = createServerExtensionManager({
    host,
    diagnostics,
    stateStore,
    repositoryDirectory: join(paths.root, 'empty-repository'),
    installedDirectory: join(paths.root, 'installed'),
    devLinksFile: paths.devLinksFile,
    readCardPackage: async () => { throw new Error('No Card packages in this fixture') },
    listInstallations: async () => ({ installations: [] }),
    importPackageResources: async () => ({}),
    removePackageResources: async () => ({}),
  })
  return { host, manager, stateStore, registrations, diagnostics }
}

describe('Extension Package uninstall failure recovery', () => {
  it.each(['same process', 'after restart'])('retains a disabled, discoverable Package on cleanup failure and completes a retry %s', async recovery => {
    const paths = await createFixture()
    const first = createRuntime(paths)
    await first.manager.initialize()
    for (const moduleId of moduleIds) {
      await first.manager.enableModule(packageId, moduleId, {
        eventCapabilities: ['state'],
        assetCapabilities: ['assets.read'],
      })
    }
    expect(first.registrations.size).toBe(2)

    const failure = await first.manager.uninstallPackage(packageId, '1.0.0').catch(error => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect(first.registrations.size).toBe(0)
    expect(first.host.list()).toEqual(moduleIds.map((moduleId, index) => expect.objectContaining({
      packageId,
      moduleId,
      state: 'disabled',
      instance: expect.objectContaining({ state: index === 0 ? 'dispose_failed' : 'disposed' }),
    })))
    expect(first.manager.listPackages()).toEqual([expect.objectContaining({
      packageId,
      available: true,
      sourceKinds: ['dev-link'],
      modules: moduleIds.map((moduleId, index) => expect.objectContaining({
        moduleId,
        desired: expect.objectContaining({
          enabled: false,
          grants: { 'events.subscribe': ['state'], assets: ['assets.read'], ui: [] },
        }),
        runtime: expect.objectContaining({
          state: 'disabled',
          instance: expect.objectContaining({ state: index === 0 ? 'dispose_failed' : 'disposed' }),
        }),
      })),
    })])
    expect(failure).toMatchObject({
      message: expect.stringContaining('uninstall incomplete'),
      errors: [expect.objectContaining({
        errors: [expect.objectContaining({ message: 'first onDispose failed' })],
      })],
    })
    expect(first.diagnostics.list({ packageId })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'extension.dispose_failed', moduleId: 'first' }),
    ]))
    expect(JSON.parse(await readFile(paths.devLinksFile, 'utf8'))).toEqual({
      extensions: [{ id: packageId, path: paths.sourceDirectory }],
    })
    const persisted = createExtensionStateStore({ filename: paths.stateFile, now: () => 'unused' })
    await persisted.load()
    for (const moduleId of moduleIds) {
      expect(persisted.get(packageId, moduleId)).toMatchObject({
        enabled: false,
        grantedEventCapabilities: ['state'],
        grantedAssetCapabilities: ['assets.read'],
      })
    }

    let runtime = first
    if (recovery === 'after restart') {
      await first.host.disposeAll()
      runtime = createRuntime(paths)
      await runtime.manager.initialize()
      expect(runtime.registrations.size).toBe(0)
      expect(runtime.host.list()).toHaveLength(2)
      expect(runtime.host.list().every(module => module.instance === undefined)).toBe(true)
      expect(runtime.manager.listPackages()).toMatchObject([{
        modules: moduleIds.map(moduleId => ({ moduleId, desired: { enabled: false } })),
      }])
    }
    await expect(runtime.manager.uninstallPackage(packageId, '1.0.0')).resolves.toEqual({
      packageId, version: '1.0.0', removed: true,
    })
    expect(runtime.manager.listPackages()).toEqual([])
    expect(runtime.host.list()).toEqual([])
    expect(runtime.registrations.size).toBe(0)
    expect(JSON.parse(await readFile(paths.devLinksFile, 'utf8'))).toEqual({ extensions: [] })
    expect(JSON.parse(await readFile(paths.stateFile, 'utf8'))).toEqual({ version: 4, installations: {} })
    await expect(readFile(join(paths.sourceDirectory, 'manifest.json'), 'utf8')).resolves.toContain(packageId)

    const restarted = createRuntime(paths)
    await restarted.manager.initialize()
    expect(restarted.manager.listPackages()).toEqual([])
    expect(restarted.host.list()).toEqual([])
    for (const moduleId of moduleIds) expect(restarted.stateStore.get(packageId, moduleId)).toBeUndefined()
  })

  it('keeps retained discovery usable for enable and reload after an incomplete uninstall', async () => {
    const paths = await createFixture()
    const { manager, registrations } = createRuntime(paths)
    await manager.initialize()
    for (const moduleId of moduleIds) await manager.enableModule(packageId, moduleId)
    await expect(manager.uninstallPackage(packageId)).rejects.toBeInstanceOf(AggregateError)

    for (const moduleId of moduleIds) {
      await expect(manager.enableModule(packageId, moduleId)).resolves.toMatchObject({
        desired: { enabled: true },
        runtime: { instance: { state: 'active' } },
      })
    }
    await expect(manager.reloadModule(packageId, 'second')).resolves.toMatchObject({
      runtime: { instance: { state: 'active' } },
    })
    expect(registrations.size).toBe(2)
    await expect(manager.uninstallPackage(packageId)).rejects.toThrow('uninstall incomplete')
    await expect(manager.uninstallPackage(packageId)).resolves.toMatchObject({ removed: true })
    expect(registrations.size).toBe(0)
  })
})
