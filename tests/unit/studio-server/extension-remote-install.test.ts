import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { zipSync } from 'fflate'
import type { ExtensionHost, ExtensionManifest } from '@loom-studio/extension-host'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createServerExtensionManager } from '../../../apps/studio-server/src/extensions/extension-manager.js'
import { createExtensionStateStore } from '../../../apps/studio-server/src/extensions/extension-state-store.js'
import { acquireExtension, extensionGit } from '../../../apps/studio-server/src/extensions/extension-download.js'

vi.mock('../../../apps/studio-server/src/extensions/extension-download.js', async importOriginal => ({
  ...await importOriginal<object>(),
  acquireExtension: vi.fn(),
  extensionGit: vi.fn(),
}))

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})

const roots: string[] = []
const fixtures = new Map<string, { manifest: ExtensionManifest; commit: string; text: string }>()
let dirty = false

beforeEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rename).mockImplementation(fs.rename)
  fixtures.clear()
  dirty = false
  vi.mocked(acquireExtension).mockImplementation(async (sourceInput, parent) => {
    const source = sourceInput as { kind: 'git'; url: string; ref?: string }
    const fixture = fixtures.get(source.url)
    if (!fixture) throw new Error('Download failed')
    const directory = await mkdtemp(join(parent, 'fixture-'))
    await mkdir(join(directory, '.git'))
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(fixture.manifest))
    await writeFile(join(directory, 'index.mjs'), fixture.text)
    await writeFile(join(directory, 'resource.json'), '{}')
    await writeFile(join(directory, '.git', 'HEAD'), fixture.commit)
    return { manifest: fixture.manifest, directory, source: { ...source, ref: source.ref ?? 'main' }, commit: fixture.commit }
  })
  vi.mocked(extensionGit).mockImplementation(async (args, cwd) => {
    if (args[0] === 'status') return dirty ? ' M index.mjs' : ''
    if (args[0] === 'rev-parse') return readFile(join(cwd!, '.git', 'HEAD'), 'utf8')
    return ''
  })
})
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function fixture(id: string, version = '1.0.0', dependencies?: ExtensionManifest['dependencies']) {
  const url = `https://example.com/${id}.git`
  fixtures.set(url, { manifest: {
    manifestVersion: 2, id, version, displayName: id, engines: { studio: '*' },
    modules: [{ id: 'server', runtime: 'server', entry: './index.mjs', capabilities: {} }],
    ...(dependencies ? { dependencies } : {}),
  }, commit: version.startsWith('2') ? 'b'.repeat(40) : 'a'.repeat(40), text: `export function activate() {} // ${version}` })
  return { kind: 'git' as const, url }
}

async function manager(configure?: (root: string) => Promise<Partial<Parameters<typeof createServerExtensionManager>[0]>>) {
  const root = await mkdtemp(join(tmpdir(), 'loom-remote-test-'))
  roots.push(root)
  await mkdir(join(root, 'data'))
  const host = {
    discover: vi.fn(async () => []), activate: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined), forget: vi.fn(async () => undefined),
    list: () => [],
  } as unknown as ExtensionHost
  const state = createExtensionStateStore({ filename: join(root, 'data', 'state.json'), now: () => '2026-10-02T00:00:00Z' })
  const deleteData = vi.fn(async () => undefined)
  const importPackageResources = vi.fn(async (_input: Parameters<Parameters<typeof createServerExtensionManager>[0]['importPackageResources']>[0]) => ({ installationId: 'fixture-installation', promptResources: [], agentTools: [], transformRules: [], textExtractors: [] }))
  const listInstallations = vi.fn<Parameters<typeof createServerExtensionManager>[0]['listInstallations']>(async () => ({ installations: [] }))
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const managerOptions: Parameters<typeof createServerExtensionManager>[0] = {
    host, stateStore: state, diagnostics,
    installedDirectory: join(root, 'app', 'extensions'), devLinksFile: join(root, 'data', 'dev-links.json'),
    officialSetupFile: join(root, 'data', 'setup.json'), deleteData,
    readCardPackage: async () => { throw new Error('Unused') }, listInstallations,
    importPackageResources, removePackageResources: async () => ({ packageId: 'fixture-package', promptResourceIds: [], agentToolIds: [], textTransformRuleIds: [], textExtractorIds: [], detachedReferences: { cards: 0, timelines: 0, presetToolMounts: 0 } }),
    ...await configure?.(root),
  }
  const runtime = createServerExtensionManager(managerOptions)
  await runtime.initialize()
  return { root, runtime, host, state, deleteData, importPackageResources, listInstallations, diagnostics,
    restart: async () => {
      const restarted = createServerExtensionManager({ ...managerOptions,
        stateStore: createExtensionStateStore({ filename: join(root, 'data', 'state.json'), now: () => '2026-10-02T00:00:00Z' }) })
      await restarted.initialize()
      return restarted
    },
  }
}

async function install(runtime: Awaited<ReturnType<typeof manager>>['runtime'], source: ReturnType<typeof fixture>) {
  const preview = await runtime.previewRemoteInstall!({ sources: [source] }) as { token: string; packages: Array<{ packageId: string }> }
  const result = await runtime.commitRemoteInstall!(preview.token)
  return { preview, result }
}

describe('remote extension install lifecycle', () => {
  it('inherits enabled state and existing grants when code changes without new capabilities', async () => {
    const { runtime, state } = await manager()
    const source = fixture('test.inherit')
    fixtures.get(source.url)!.manifest.modules![0]!.capabilities = { 'assets.read': true }
    await install(runtime, source)
    await runtime.enableModule('test.inherit', 'server', { assetCapabilities: ['assets.read'] })
    const original = state.get('test.inherit', 'server')
    fixture('test.inherit', '2.0.0')
    fixtures.get(source.url)!.manifest.modules![0]!.capabilities = { 'assets.read': true }
    const update = await runtime.previewRemoteChange!({ packageId: 'test.inherit' }) as { token: string }
    expect(await runtime.commitRemoteInstall!(update.token)).toEqual({ installed: [{ packageId: 'test.inherit', version: '2.0.0' }] })
    expect(state.get('test.inherit', 'server')).toEqual(original)
  })

  it('reports committed code and retains desired state plus canonical history after state persistence fails', async () => {
    const { runtime, root, state, host } = await manager()
    const source = fixture('test.recovery')
    await install(runtime, source)
    await runtime.enableModule('test.recovery', 'server')
    const desired = state.get('test.recovery', 'server')
    fixture('test.recovery', '2.0.0')
    const firstUpdate = await runtime.previewRemoteChange!({ packageId: 'test.recovery' }) as { token: string }
    await runtime.commitRemoteInstall!(firstUpdate.token)
    expect(JSON.parse(await readFile(join(root, 'app/extensions/.history/test.recovery/manifest.json'), 'utf8')).version).toBe('1.0.0')
    fixture('test.recovery', '3.0.0')
    const update = await runtime.previewRemoteChange!({ packageId: 'test.recovery' }) as { token: string }
    const stateDirectory = join(root, 'data')
    const displacedStateDirectory = join(root, 'displaced-data')
    vi.mocked(host.discover).mockImplementationOnce(async () => {
      await rename(stateDirectory, displacedStateDirectory)
      await writeFile(stateDirectory, 'Controlled state path failure')
      return []
    })
    const result = await runtime.commitRemoteInstall!(update.token) as {
      installed: Array<{ packageId: string; version: string }>
      failed: { stage: string; codeCommitted: boolean; recovery: { recordPath: string; historyDirectory: string } }
    }
    expect(result).toMatchObject({
      installed: [{ packageId: 'test.recovery', version: '3.0.0' }],
      failed: { stage: 'restore-module-state', codeCommitted: true },
    })
    expect(runtime.listPackages()[0]?.version).toBe('3.0.0')
    expect(JSON.parse(await readFile(join(root, 'app/extensions/test.recovery/manifest.json'), 'utf8')).version).toBe('3.0.0')
    expect(JSON.parse(await readFile(join(result.failed.recovery.historyDirectory, 'manifest.json'), 'utf8')).version).toBe('2.0.0')
    const recovery = JSON.parse(await readFile(result.failed.recovery.recordPath, 'utf8'))
    expect(recovery.desired.server).toEqual(desired)
    expect(state.get('test.recovery', 'server')?.enabled).toBe(false)
    await rm(stateDirectory)
    await rename(displacedStateDirectory, stateDirectory)
    await runtime.enableModule('test.recovery', 'server', {
      eventCapabilities: recovery.desired.server.grantedEventCapabilities,
      assetCapabilities: recovery.desired.server.grantedAssetCapabilities,
      uiCapabilities: recovery.desired.server.grantedUiCapabilities,
    })
    expect(state.get('test.recovery', 'server')).toEqual(desired)
    const rollback = await runtime.previewRemoteChange!({ packageId: 'test.recovery', rollback: true }) as { token: string }
    expect(await runtime.commitRemoteInstall!(rollback.token)).toEqual({ installed: [{ packageId: 'test.recovery', version: '2.0.0' }] })
  })

  it('preserves the random old-package backup and recovery record if canonical history cannot be saved', async () => {
    const { runtime, root, state } = await manager()
    const source = fixture('test.history')
    await install(runtime, source)
    await runtime.enableModule('test.history', 'server')
    const desired = state.get('test.history', 'server')
    fixture('test.history', '2.0.0')
    const update = await runtime.previewRemoteChange!({ packageId: 'test.history' }) as { token: string }
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const saved = join(root, 'app/extensions/.history/test.history')
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (to === saved) throw Object.assign(new Error('History rename denied'), { code: 'EACCES' })
      return fs.rename(from, to)
    })
    const result = await runtime.commitRemoteInstall!(update.token) as {
      failed: { recovery: { backupDirectory: string; recordPath: string } }
    }
    expect(result).toMatchObject({
      installed: [{ packageId: 'test.history', version: '2.0.0' }],
      failed: { stage: 'save-history', codeCommitted: true },
    })
    expect(runtime.listPackages()[0]?.version).toBe('2.0.0')
    expect(JSON.parse(await readFile(join(result.failed.recovery.backupDirectory, 'manifest.json'), 'utf8')).version).toBe('1.0.0')
    expect(JSON.parse(await readFile(result.failed.recovery.recordPath, 'utf8')).desired.server).toEqual(desired)
    vi.mocked(rename).mockImplementation(fs.rename)
    await rename(result.failed.recovery.backupDirectory, saved)
    const rollback = await runtime.previewRemoteChange!({ packageId: 'test.history', rollback: true }) as { token: string }
    expect(await runtime.commitRemoteInstall!(rollback.token)).toEqual({ installed: [{ packageId: 'test.history', version: '1.0.0' }] })
  })

  it('keeps the old code and reports no committed installation when discovery rejects replacement', async () => {
    const { runtime, state, host, root } = await manager()
    const source = fixture('test.reject')
    await install(runtime, source)
    await runtime.enableModule('test.reject', 'server')
    fixture('test.reject', '2.0.0')
    const update = await runtime.previewRemoteChange!({ packageId: 'test.reject' }) as { token: string }
    vi.mocked(host.discover).mockRejectedValueOnce(new Error('Rejected replacement'))
    expect(await runtime.commitRemoteInstall!(update.token)).toMatchObject({
      installed: [], failed: { stage: 'replace-code', codeCommitted: false },
    })
    expect(runtime.listPackages()[0]?.version).toBe('1.0.0')
    expect(JSON.parse(await readFile(join(root, 'app/extensions/test.reject/manifest.json'), 'utf8')).version).toBe('1.0.0')
    expect(state.get('test.reject', 'server')?.enabled).toBe(true)
  })

  it('counts in-flight preparations and releases their slots after download failure', async () => {
    const { runtime } = await manager()
    const source = fixture('test.limit')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let started = 0
    vi.mocked(acquireExtension).mockImplementation(async () => {
      started += 1
      if (started === 4) entered.resolve()
      await release.promise
      throw new Error('Controlled download failure')
    })
    const pending = Array.from({ length: 4 }, () => runtime.previewRemoteInstall!({ sources: [source] }))
    const settled = Promise.allSettled(pending)
    await entered.promise
    await expect(runtime.previewRemoteInstall!({ sources: [source] })).rejects.toThrow('preparation limit')
    expect(started).toBe(4)
    release.resolve()
    expect((await settled).every(result => result.status === 'rejected')).toBe(true)
    await expect(runtime.previewRemoteInstall!({ sources: [source] })).rejects.toThrow('Controlled download failure')
    expect(started).toBe(5)
  })

  it('keeps at most four prepared tokens with concurrent ZIP dependency reads', async () => {
    const { runtime } = await manager()
    const base = fixture('test.limit-base')
    await install(runtime, base)
    const archive = zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'test.limit-zip', version: '1.0.0', displayName: 'Limit', engines: { studio: '*' },
        modules: [{ id: 'server', runtime: 'server', entry: './index.mjs' }],
        dependencies: [{ id: 'test.limit-base', version: '^1.0.0' }],
      })),
      'index.mjs': new TextEncoder().encode('export function activate() {}'),
    })
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => runtime.previewPackageZip!(archive)))
    const accepted = results.filter(result => result.status === 'fulfilled')
    expect(accepted).toHaveLength(4)
    expect(results.filter(result => result.status === 'rejected').every(result => String(result.reason).includes('preparation limit'))).toBe(true)
    for (const result of accepted) {
      const { token } = result.value as { token: string }
      // The first commit invalidates the remaining previews, which still release their slots.
      await runtime.commitRemoteInstall!(token).catch(error => {
        expect(String(error)).toContain('changed')
      })
    }
    const next = await runtime.previewPackageZip!(archive) as { token: string }
    await runtime.commitRemoteInstall!(next.token)
  })

  it('imports declared resources only after confirmation, without enabling modules or replacing existing resources', async () => {
    const { runtime, host, importPackageResources, listInstallations } = await manager()
    const source = fixture('test.resources')
    const contributions = { promptResources: [{ id: 'lore', resourceKind: 'lore' as const, source: './resource.json' }] }
    fixtures.get(source.url)!.manifest.contributes = contributions
    const preview = await runtime.previewRemoteInstall!({ sources: [source] }) as { token: string }
    expect(importPackageResources).not.toHaveBeenCalled()
    expect(await runtime.commitRemoteInstall!(preview.token)).not.toHaveProperty('failed')
    expect(importPackageResources).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      packageId: 'test.resources', packageVersion: '1.0.0',
      promptResources: [{ contribution: contributions.promptResources[0], artifact: {} }],
    }))
    expect(host.activate).not.toHaveBeenCalled()
    listInstallations.mockResolvedValue({ installations: [{
      id: 'installation', version: 1, packageId: 'test.resources', packageVersion: '1.0.0',
      target: { kind: 'global' }, createdAt: '2026-10-05', updatedAt: '2026-10-05',
    }] })
    fixture('test.resources', '2.0.0')
    fixtures.get(source.url)!.manifest.contributes = contributions
    const update = await runtime.previewRemoteChange!({ packageId: 'test.resources' }) as { token: string }
    expect(await runtime.commitRemoteInstall!(update.token)).not.toHaveProperty('failed')
    expect(importPackageResources).toHaveBeenCalledTimes(1)
  })

  it('reports resource failure after installation and allows explicit retry without deleting the package', async () => {
    const { runtime, root, importPackageResources } = await manager()
    const source = fixture('test.resources')
    fixtures.get(source.url)!.manifest.contributes = {
      promptResources: [{ id: 'lore', resourceKind: 'lore', source: './resource.json' }],
    }
    importPackageResources.mockRejectedValueOnce(new Error('Invalid setting'))
    const { result } = await install(runtime, source)
    expect(result).toMatchObject({
      installed: [{ packageId: 'test.resources', version: '1.0.0' }],
      failed: { packageId: 'test.resources', message: expect.stringContaining('resource import failed') },
    })
    expect(runtime.listPackages()).toHaveLength(1)
    expect(await readFile(join(root, 'app/extensions/test.resources/manifest.json'), 'utf8')).toContain('test.resources')
    await runtime.importPackageResources('test.resources')
    expect(importPackageResources).toHaveBeenCalledTimes(2)
  })

  it('reviews ZIP dependencies together and permits explicit manual ZIP replacement without remote update tracking', async () => {
    const { runtime } = await manager()
    const base = fixture('test.base')
    const archive = (version: string) => zipSync({
      'manifest.json': new TextEncoder().encode(JSON.stringify({
        manifestVersion: 2, id: 'test.zip', version, displayName: 'ZIP', engines: { studio: '*' },
        modules: [{ id: 'server', runtime: 'server', entry: './index.mjs' }],
        dependencies: [{ id: 'test.base', version: '^1.0.0', source: base }],
      })),
      'index.mjs': new TextEncoder().encode(`export function activate() {} // ${version}`),
    })
    const preview = await runtime.previewPackageZip!(archive('1.0.0')) as { token: string; packages: Array<{ packageId: string }> }
    expect(preview.packages.map(item => item.packageId)).toEqual(['test.base', 'test.zip'])
    expect(runtime.listPackages()).toEqual([])
    expect(await runtime.commitRemoteInstall!(preview.token)).not.toHaveProperty('failed')
    expect(runtime.listPackages().find(item => item.packageId === 'test.zip')).not.toHaveProperty('remote')
    await expect(runtime.uninstallPackage('test.base')).rejects.toThrow('required by')
    const update = await runtime.previewPackageZip!(archive('2.0.0')) as { token: string; packages: Array<{ replacing: boolean }> }
    expect(update.packages[0]?.replacing).toBe(true)
    expect(await runtime.commitRemoteInstall!(update.token)).toEqual({ installed: [{ packageId: 'test.zip', version: '2.0.0' }] })
  })

  it('prepares a dependency-first confirmation list without installing or enabling code', async () => {
    const { root, runtime, host } = await manager()
    const dependency = fixture('test.base')
    const source = fixture('test.root', '1.0.0', [{ id: 'test.base', version: '^1.0.0', source: dependency }])
    const preview = await runtime.previewRemoteInstall!({ sources: [source] }) as { token: string; packages: Array<{ packageId: string }> }
    expect(preview.packages.map(item => item.packageId)).toEqual(['test.base', 'test.root'])
    expect(runtime.listPackages()).toEqual([])
    expect(host.activate).not.toHaveBeenCalled()
    expect(await runtime.commitRemoteInstall!(preview.token)).toEqual({ installed: [{ packageId: 'test.base', version: '1.0.0' }, { packageId: 'test.root', version: '1.0.0' }] })
    expect(await readFile(join(root, 'app/extensions/test.root/manifest.json'), 'utf8')).toContain('test.root')
    await expect(readFile(join(root, 'data/extensions/installed/test.root/manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(runtime.commitRemoteInstall!(preview.token)).rejects.toThrow('expired')
    expect(host.activate).not.toHaveBeenCalled()
  })

  it('rejects an identity mismatch, missing source and circular dependencies before installation', async () => {
    const { runtime } = await manager()
    const wrong = fixture('test.wrong')
    const mismatch = fixture('test.root', '1.0.0', [{ id: 'test.expected', version: '*', source: wrong }])
    await expect(runtime.previewRemoteInstall!({ sources: [mismatch] })).rejects.toThrow('does not match')
    fixture('test.root', '1.0.0', [{ id: 'test.missing', version: '*' }])
    await expect(runtime.previewRemoteInstall!({ sources: [mismatch] })).rejects.toThrow('no download source')
    const base = fixture('test.base', '1.0.0', [{ id: 'test.root', version: '*', source: mismatch }])
    fixture('test.root', '1.0.0', [{ id: 'test.base', version: '*', source: base }])
    await expect(runtime.previewRemoteInstall!({ sources: [mismatch] })).rejects.toThrow('cycle')
    expect(runtime.listPackages()).toEqual([])
  })

  it('updates and rolls back code without changing data and blocks dirty working copies', async () => {
    const { root, runtime, state } = await manager()
    const source = fixture('test.root')
    await install(runtime, source)
    const data = join(root, 'data', 'save.json')
    await writeFile(data, '{"floor":40}')
    await state.set('test.root', 'server', { enabled: true, grantedEventCapabilities: [], grantedAssetCapabilities: [] })
    dirty = true
    await expect(runtime.previewRemoteChange!({ packageId: 'test.root' })).rejects.toThrow('local changes')
    dirty = false
    fixture('test.root', '2.0.0')
    fixtures.get(source.url)!.manifest.modules![0]!.capabilities = { 'assets.read': true }
    const preview = await runtime.previewRemoteChange!({ packageId: 'test.root' }) as { token: string }
    expect(await runtime.commitRemoteInstall!(preview.token)).toEqual({ installed: [{ packageId: 'test.root', version: '2.0.0' }] })
    expect(state.get('test.root', 'server')?.enabled).toBe(false)
    expect(await readFile(data, 'utf8')).toBe('{"floor":40}')
    const before = vi.mocked(acquireExtension).mock.calls.length
    const rollback = await runtime.previewRemoteChange!({ packageId: 'test.root', rollback: true }) as { token: string }
    expect(await runtime.commitRemoteInstall!(rollback.token)).toEqual({ installed: [{ packageId: 'test.root', version: '1.0.0' }] })
    expect(vi.mocked(acquireExtension).mock.calls.length).toBe(before)
    expect(runtime.listPackages()[0]?.version).toBe('1.0.0')
    expect(await readFile(data, 'utf8')).toBe('{"floor":40}')
  })

  it('persists first-run dismissal and retains data unless explicitly requested', async () => {
    const { runtime, root, deleteData } = await manager()
    expect(await runtime.officialSetup!()).toMatchObject({ completed: false })
    await runtime.finishOfficialSetup!()
    expect(JSON.parse(await readFile(join(root, 'data/setup.json'), 'utf8')).completed).toBe(true)
    const source = fixture('test.root')
    await install(runtime, source)
    await runtime.uninstallPackage('test.root')
    expect(deleteData).not.toHaveBeenCalled()
    await install(runtime, source)
    await runtime.uninstallPackage('test.root', '1.0.0', true)
    expect(deleteData).toHaveBeenCalledWith('test.root', [])
  })
})


it('isolates malformed bundled manifests and failed resource imports during initialization', async () => {
  const imports = vi.fn(async (input: { packageId: string }) => {
    if (input.packageId === 'test.bad-import') throw new Error('broken resource')
    return { installationId: 'healthy', promptResources: [], agentTools: [], transformRules: [], textExtractors: [] }
  })
  const { runtime, diagnostics, root } = await manager(async root => {
    const bundledDirectories: string[] = []
    for (const id of ['bad-json', 'test.bad-import', 'test.healthy']) {
      const directory = join(root, 'bundled', id)
      bundledDirectories.push(directory)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'manifest.json'), id === 'bad-json' ? '{broken' : JSON.stringify({
        manifestVersion: 2, id, version: '1.0.0', displayName: id, engines: { studio: '*' },
        modules: [{ id: 'server', runtime: 'server', entry: './index.mjs', capabilities: {} }],
      }))
      await writeFile(join(directory, 'index.mjs'), 'export function activate() {}')
    }
    const damagedSource = join(root, 'app/extensions/test.bad-source')
    await mkdir(damagedSource, { recursive: true })
    await writeFile(join(damagedSource, 'manifest.json'), JSON.stringify({
      manifestVersion: 2, id: 'test.bad-source', version: '1.0.0', displayName: 'Bad source', engines: { studio: '*' },
      modules: [{ id: 'server', runtime: 'server', entry: './index.mjs', capabilities: {} }],
    }))
    await writeFile(join(damagedSource, 'index.mjs'), 'export function activate() {}')
    await writeFile(join(damagedSource, '.loom-source.json'), '{broken')
    return { bundledDirectories, importPackageResources: imports }
  })
  expect(imports.mock.calls.map(([input]) => input.packageId)).toEqual(['test.bad-import', 'test.healthy'])
  expect(runtime.listPackages().find(item => item.packageId === 'test.bad-import')?.available).toBe(false)
  expect(runtime.listPackages().find(item => item.packageId === 'test.healthy')?.available).toBe(true)
  expect(runtime.listPackages().find(item => item.packageId === 'test.bad-source')?.available).toBe(false)
  expect(diagnostics.list().some(item => item.code === 'extension.bundled_setup_failed')).toBe(true)
  expect(JSON.parse(await readFile(join(root, 'data/setup.json'), 'utf8')).bundled).toEqual(['test.healthy'])
})


it('loads bundled packages in place, imports presets once and preserves explicit module disablement across restart', async () => {
  const packageId = 'official.story-memory'
  const f = await manager(async root => {
    const directory = join(root, 'bundled', packageId)
    await mkdir(directory, { recursive: true })
    await cp('official/extensions/story-memory/resources', join(directory, 'resources'), { recursive: true })
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Story Memory', engines: { studio: '*' },
      modules: [{ id: 'server', runtime: 'server', entry: './server.js' }, { id: 'client', runtime: 'client', entry: './client.js' }],
      contributes: { promptResources: [{ id: 'official.story-memory.summary', resourceKind: 'preset', source: './resources/summary/index.json' }] },
    }))
    await writeFile(join(directory, 'server.js'), 'export function activate() {}')
    await writeFile(join(directory, 'client.js'), 'export function activate() {}')
    return { bundledDirectories: [directory], bundledEnabledModules: { [packageId]: ['server', 'client'] } }
  })
  expect(f.runtime.listPackages().find(item => item.packageId === packageId)?.available).toBe(true)
  expect(f.importPackageResources).toHaveBeenCalledOnce()
  expect(f.importPackageResources.mock.calls[0]![0].promptResources[0]!.artifact).toMatchObject({
    resourceKind: 'preset', rootNode: { id: 'official.story-memory.summary', category: 'preset', children: expect.arrayContaining([
      expect.objectContaining({ children: expect.arrayContaining([
        expect.objectContaining({ body: expect.stringContaining('剧情记忆整理助手') }),
        expect.objectContaining({ body: expect.stringContaining('LV1') }),
        expect.objectContaining({ body: expect.stringContaining('LV2') }),
      ]) }),
    ]) },
  })
  expect(f.state.get(packageId, 'server')?.enabled).toBe(true)
  expect(f.state.get(packageId, 'client')?.enabled).toBe(true)
  expect(f.host.activate).toHaveBeenCalledWith(packageId, 'server')
  await f.runtime.disableModule(packageId, 'server')
  await f.runtime.disableModule(packageId, 'client')
  vi.mocked(f.host.activate).mockClear()
  const restarted = await f.restart()
  expect(f.host.activate).not.toHaveBeenCalled()
  expect(f.importPackageResources).toHaveBeenCalledOnce()
  const persisted = createExtensionStateStore({ filename: join(f.root, 'data/state.json'), now: () => '' })
  await persisted.load()
  expect(persisted.get(packageId, 'server')?.enabled).toBe(false)
  expect(persisted.get(packageId, 'client')?.enabled).toBe(false)
  expect(restarted.listPackages().find(item => item.packageId === packageId)?.sourceKinds).toEqual(['repository'])
  await expect(readFile(join(f.root, 'app/extensions', packageId, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(restarted.uninstallPackage(packageId)).rejects.toThrow('Only an installed or dev-linked')
  expect((await f.restart()).listPackages().some(item => item.packageId === packageId)).toBe(true)
})


it('discovers official packages in place, refreshes file revisions on restart and reports installed duplicates', async () => {
  const packageId = 'official.test-theme'
  const f = await manager(async root => {
    const repositoryDirectory = join(root, 'official/extensions')
    const directory = join(repositoryDirectory, 'themes')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Official themes', engines: { studio: '*' },
      modules: [], contributes: { themes: [{ id: 'paper', label: 'Paper', css: './paper.css' }] },
    }))
    await writeFile(join(directory, 'paper.css'), 'body { color: red }')
    return { repositoryDirectory, bundledDirectories: [directory] }
  })
  const first = f.runtime.listPackages().find(item => item.packageId === packageId)!
  expect(first).toMatchObject({ available: true, sourceKinds: ['repository'], modules: [] })
  await expect(readFile(join(f.root, 'app/extensions', packageId, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(Buffer.from((await f.runtime.readPackageFile(packageId, first.fileRevision!, 'paper.css')).bytes).toString()).toContain('red')
  const directory = join(f.root, 'official/extensions/themes')
  await writeFile(join(directory, 'paper.css'), 'body { color: blue }')
  const restarted = await f.restart()
  const next = restarted.listPackages().find(item => item.packageId === packageId)!
  expect(next.fileRevision).not.toBe(first.fileRevision)
  expect(Buffer.from((await restarted.readPackageFile(packageId, next.fileRevision!, 'paper.css')).bytes).toString()).toContain('blue')
  await expect(restarted.readPackageFile(packageId, first.fileRevision!, 'paper.css')).rejects.toThrow('revision')
  await cp(directory, join(f.root, 'app/extensions', packageId), { recursive: true })
  const conflicted = await f.restart()
  expect(conflicted.listPackages().find(item => item.packageId === packageId)).toMatchObject({ available: false, sourceKinds: ['repository', 'installed'] })
  expect(f.diagnostics.list().some(item => item.code === 'extension.package_source_conflict' && item.packageId === packageId)).toBe(true)
  expect(await readFile(join(directory, 'paper.css'), 'utf8')).toContain('blue')
})
