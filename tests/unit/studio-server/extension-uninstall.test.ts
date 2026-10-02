import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost, type ExtensionHost, type ExtensionRpcRegistration } from '@loom-studio/extension-host'
import { extensionInstallationId, type ExtensionInstallationTarget, type ListExtensionInstallationsResult } from '@loom-studio/application-runtime'
import type { ManagedExtensionModule } from '@loom-studio/kernel'
import { zipSync } from 'fflate'
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

async function createFixture(options: { healthy?: boolean; clientModules?: boolean } = {}) {
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
    modules: [...moduleIds.map(id => ({
      id,
      runtime: 'server',
      entry: './index.mjs',
      capabilities: { 'events.subscribe': ['state'], 'assets.read': true },
      contributes: { rpc: [{ name: `${packageId}.${id}.status` }] },
    })), ...(options.clientModules ? ['panel', 'toolbar'].map(id => ({
      id, runtime: 'client', entry: './client.mjs', contributes: {},
    })) : [])],
  }))
  await writeFile(join(sourceDirectory, 'index.mjs'), `
export function activate(ctx) {
  const moduleId = ctx.extension.moduleId
  ctx.rpc.register('example.uninstall.' + moduleId + '.status', () => ({ active: true }))
  ctx.lifecycle.onDispose(() => {
    if (moduleId === 'first' && ${!options.healthy}) throw new Error('first onDispose failed')
  })
}
`)
  if (options.clientModules) await writeFile(join(sourceDirectory, 'client.mjs'), 'export function activate() {}')
  const devLinksFile = join(root, 'dev-links.json')
  await writeFile(devLinksFile, JSON.stringify({ extensions: [{ id: packageId, path: sourceDirectory }] }))
  return { root, sourceDirectory, devLinksFile, stateFile: join(root, 'state.json') }
}

function createRuntime(paths: Awaited<ReturnType<typeof createFixture>>, cardArchive?: { packageId: string; version: string; archiveBase64: string }) {
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
  const installations: ListExtensionInstallationsResult['installations'] = []
  const manager = createServerExtensionManager({
    host,
    diagnostics,
    stateStore,
    repositoryDirectory: join(paths.root, 'empty-repository'),
    installedDirectory: join(paths.root, 'installed'),
    devLinksFile: paths.devLinksFile,
    readCardPackage: async () => {
      if (!cardArchive) throw new Error('No Card packages in this fixture')
      return { cardVersion: 1, archive: cardArchive }
    },
    listInstallations: async () => ({ installations }),
    importPackageResources: async input => {
      if (input.target?.kind === 'card') {
        const id = extensionInstallationId(input.packageId, input.target)
        if (!installations.some(installation => installation.id === id)) installations.push({
          id, version: 1, packageId: input.packageId, packageVersion: input.packageVersion,
          target: input.target, archiveBlobId: 'fixture-archive',
          createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z',
        })
      }
      return {}
    },
    removePackageResources: async input => {
      if (input.uninstall && input.target) {
        const index = installations.findIndex(installation => installation.id === extensionInstallationId(input.packageId, input.target!))
        if (index >= 0) installations.splice(index, 1)
      }
      return {}
    },
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

function listedReloadIds(manager: ReturnType<typeof createRuntime>['manager'], target?: ExtensionInstallationTarget) {
  const modules = manager.listPackages(target)[0]!.modules as ManagedExtensionModule[]
  return Object.fromEntries(modules.map(module => [module.moduleId, module.reloadId]))
}

describe('Extension module catalog reload identity', () => {
  it('keeps list and ordinary enable stable, changing only the explicitly reloaded module at the same version', async () => {
    const paths = await createFixture({ healthy: true, clientModules: true })
    const { manager, stateStore } = createRuntime(paths)
    await manager.initialize()
    const before = listedReloadIds(manager)
    for (const id of Object.values(before)) expect(id).toEqual(expect.any(String))
    expect(new Set(Object.values(before)).size).toBe(4)
    expect(listedReloadIds(manager)).toEqual(before)
    for (const moduleId of ['second', 'panel']) {
      expect((await manager.enableModule(packageId, moduleId)).reloadId).toBe(before[moduleId])
      expect((await manager.enableModule(packageId, moduleId)).reloadId).toBe(before[moduleId])
    }
    expect(listedReloadIds(manager)).toEqual(before)
    await manager.disableModule(packageId, 'panel')
    await expect(manager.reloadModule(packageId, 'panel')).rejects.toThrow('not enabled')
    expect(listedReloadIds(manager)).toEqual(before)
    await manager.enableModule(packageId, 'panel')
    const panel = await manager.reloadModule(packageId, 'panel')
    expect(panel.reloadId).not.toBe(before.panel)
    expect(listedReloadIds(manager)).toEqual({ ...before, panel: panel.reloadId })
    const second = await manager.reloadModule(packageId, 'second')
    expect(second.reloadId).not.toBe(before.second)
    const after = { ...before, panel: panel.reloadId, second: second.reloadId }
    expect(listedReloadIds(manager)).toEqual(after)
    expect(manager.listPackages()[0]!.version).toBe('1.0.0')
    const again = await manager.reloadModule(packageId, 'panel')
    expect(again.reloadId).not.toBe(panel.reloadId)
    expect(listedReloadIds(manager)).toEqual({ ...after, panel: again.reloadId })
    expect(stateStore.get(packageId, 'panel')).not.toHaveProperty('reloadId')
    expect(await readFile(paths.stateFile, 'utf8')).not.toContain('reloadId')
  })

  it('changes a Server marker when changed grants actually reload its instance, not on repeated enable', async () => {
    const paths = await createFixture({ healthy: true })
    const { manager } = createRuntime(paths)
    await manager.initialize()
    const enabled = await manager.enableModule(packageId, 'second')
    const reloaded = await manager.enableModule(packageId, 'second', { eventCapabilities: ['state'] })
    expect(reloaded.reloadId).not.toBe(enabled.reloadId)
    expect((await manager.enableModule(packageId, 'second', { eventCapabilities: ['state'] })).reloadId).toBe(reloaded.reloadId)
    expect(listedReloadIds(manager).second).toBe(reloaded.reloadId)
  })

  it.each(['panel', 'second'])('isolates installation targets for %s and removes Card-owned markers on uninstall before reinstallation', async moduleId => {
    const paths = await createFixture({ healthy: true, clientModules: true })
    const files = Object.fromEntries(await Promise.all(['manifest.json', 'index.mjs', 'client.mjs'].map(async path =>
      [path, await readFile(join(paths.sourceDirectory, path))] as const)))
    const archive = { packageId, version: '1.0.0', archiveBase64: Buffer.from(zipSync(files)).toString('base64') }
    const { manager } = createRuntime(paths, archive)
    await manager.initialize()
    const a = { kind: 'card' as const, cardId: 'A' }
    const b = { kind: 'card' as const, cardId: 'B' }
    const installA = await manager.installCardPackage({ cardId: a.cardId, packageId, expectedCardVersion: 1 })
    await manager.installCardPackage({ cardId: b.cardId, packageId, expectedCardVersion: 1 })
    const globalBefore = listedReloadIds(manager)
    const aBefore = listedReloadIds(manager, a)
    const bBefore = listedReloadIds(manager, b)
    expect(new Set([...Object.values(globalBefore), ...Object.values(aBefore), ...Object.values(bBefore)]).size).toBe(12)
    expect((installA.modules as ManagedExtensionModule[]).map(module => module.reloadId)).toEqual(Object.values(aBefore))
    const installAgain = await manager.installCardPackage({ cardId: a.cardId, packageId, expectedCardVersion: 1 })
    expect((installAgain.modules as ManagedExtensionModule[]).map(module => module.reloadId)).toEqual(Object.values(aBefore))
    for (const target of [a, b]) await manager.enableModule(packageId, moduleId, undefined, target)
    const reloaded = await manager.reloadModule(packageId, moduleId, a)
    expect(reloaded.reloadId).not.toBe(aBefore[moduleId])
    const aAfter = { ...aBefore, [moduleId]: reloaded.reloadId }
    expect(listedReloadIds(manager, a)).toEqual(aAfter)
    expect(listedReloadIds(manager, b)).toEqual(bBefore)
    expect(listedReloadIds(manager)).toEqual(globalBefore)
    await manager.uninstallCardPackage({ cardId: a.cardId, packageId, expectedInstallationVersion: 1 })
    expect(manager.listPackages(a)).toEqual([])
    expect(listedReloadIds(manager, b)).toEqual(bBefore)
    await manager.installCardPackage({ cardId: a.cardId, packageId, expectedCardVersion: 1 })
    const aReinstalled = listedReloadIds(manager, a)
    for (const moduleId of Object.keys(aAfter)) expect(aReinstalled[moduleId]).not.toBe(aAfter[moduleId])
    expect(listedReloadIds(manager, b)).toEqual(bBefore)
    expect(listedReloadIds(manager)).toEqual(globalBefore)
  })

  it('drops Global lifecycle markers with the catalog owner on uninstall and creates fresh ones on reinstall', async () => {
    const paths = await createFixture({ healthy: true, clientModules: true })
    const { manager } = createRuntime(paths)
    await manager.initialize()
    await manager.enableModule(packageId, 'panel')
    await manager.reloadModule(packageId, 'panel')
    const before = listedReloadIds(manager)
    await manager.uninstallPackage(packageId)
    expect(manager.listPackages()).toEqual([])
    const installed = await manager.installPackage(paths.sourceDirectory)
    const after = listedReloadIds(manager)
    expect((installed.modules as ManagedExtensionModule[]).map(module => module.reloadId)).toEqual(Object.values(after))
    for (const moduleId of Object.keys(before)) expect(after[moduleId]).not.toBe(before[moduleId])
    expect(listedReloadIds(manager)).toEqual(after)
  })
})
