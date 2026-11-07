import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, unzipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createBuiltinSourceAdapters } from '../../../apps/studio-server/src/resource-downloads/sources.js'
import { createResourceDownloadService } from '../../../apps/studio-server/src/resource-downloads/service.js'
import { encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { defaultCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { encodePromptResourceZip } from '../../../apps/studio-server/src/codecs/prompt-resource-zip.js'
import type { ResourceDownloadService } from '../../../apps/studio-server/src/resource-downloads/service.js'

function archive(version = '1.0.0', dependencies: unknown[] = []) {
  return zipSync({ 'manifest.json': strToU8(JSON.stringify({ manifestVersion: 2, id: 'test.download', version, displayName: 'Download fixture', engines: { studio: '*' }, modules: [], dependencies })) })
}
async function finished(service: ResourceDownloadService, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const task = service.get(id)
    if (!['queued', 'downloading'].includes(task.status)) return task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Task did not complete')
}
async function fixture(work: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'loom-download-test-'))
  try { await work(directory) } finally { await rm(directory, { recursive: true, force: true }) }
}

describe('resource download tasks', () => {
  it('stages a validated package, exposes dependencies only after download, and persists the receipt without installing', async () => fixture(async directory => {
    const payload = archive('1.0.0', [{ id: 'test.dependency', version: '^1.0.0', source: { kind: 'zip', url: 'https://cdn.example/dependency.zip' } }])
    const service = createResourceDownloadService({ directory, transport: async (_url, options) => { options.onProgress?.(payload.length, payload.length); return payload } })
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://cdn.example/extension.zip', kind: 'extension' })
    const task = await service.start({ candidateId: resolved.candidates[0]!.id })
    const ready = await finished(service, task.id)
    expect(ready).toMatchObject({ status: 'ready', phase: 'staged', packageId: 'test.download', version: '1.0.0', receivedBytes: payload.length })
    expect(service.listUpdates()).toEqual([])
    const dependencies = await service.prepareDependencies(task.id)
    expect(dependencies.dependencies[0]?.id).toBe('test.dependency')
    expect(dependencies.candidates[0]?.packageId).toBe('test.dependency')
    expect(await readFile(service.readArtifact(task.id).path)).toEqual(Buffer.from(payload))
    await service.close()
    const restored = createResourceDownloadService({ directory, transport: async () => payload })
    await restored.initialize()
    expect(restored.get(task.id).status).toBe('ready')
    await restored.close()
  }))

  it('cancels a running transfer and retries without exposing signed query parameters', async () => fixture(async directory => {
    let tries = 0
    const service = createResourceDownloadService({ directory, transport: async (_url, options) => {
      if (++tries > 1) return archive()
      return new Promise((_resolve, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason), { once: true }))
    } })
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://cdn.example/package.zip?token=secret', kind: 'extension' })
    expect(JSON.stringify(resolved)).not.toContain('secret')
    const task = await service.start({ candidateId: resolved.candidates[0]!.id })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect((await service.cancel(task.id)).status).toBe('cancelled')
    expect(await readFile(join(directory, 'tasks.json'), 'utf8')).not.toContain('secret')
    await service.retry(task.id)
    expect((await finished(service, task.id)).status).toBe('ready')
    await service.close()
  }))

  it('rejects invalid package content and mismatched selected Manifest versions', async () => fixture(async directory => {
    const service = createResourceDownloadService({ directory, transport: async url => url.endsWith('manifest.json') ? strToU8(JSON.stringify({ id: 'test.download', version: '2.0.0', distribution: { kind: 'url', url: 'https://cdn.example/package.zip' } })) : archive('1.0.0') })
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://cdn.example/manifest.json', kind: 'extension' })
    const task = await service.start({ candidateId: resolved.candidates[0]!.id })
    expect(await finished(service, task.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('version does not match') })
    expect(() => service.readArtifact(task.id)).toThrow('not ready')
    await service.close()
  }))

  it('uses Manifest SemVer for checks, preserves ignored candidates across restart, and distinguishes unavailable adapters', async () => fixture(async directory => {
    let remoteVersion = '1.0.0'
    const service = createResourceDownloadService({ directory, transport: async () => archive() })
    const adapter = {
      id: 'platform', matches: (url: URL) => url.hostname === 'platform.example',
      async resolve() { return [{ name: 'Work', kind: 'extension' as const, packageId: 'test.download', version: '1.0.0', source: { adapterId: 'platform', url: 'https://platform.example/work', resourceId: 'work' }, target: { kind: 'file' as const, url: 'https://cdn.example/package.zip' } }] },
      async check() { return { ...(await this.resolve())[0]!, version: remoteVersion } },
    }
    const registration = service.registerAdapter(adapter)
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://platform.example/work', kind: 'extension' })
    const task = await service.start({ candidateId: resolved.candidates[0]!.id })
    await finished(service, task.id)
    const tracked = await service.track({ taskId: task.id })
    expect((await service.checkUpdates({ force: true }))[0]?.status).toBe('current')
    remoteVersion = '1.1.0-beta.1'
    expect((await service.checkUpdates({ force: true }))[0]?.status).toBe('current')
    remoteVersion = '1.1.0'
    const update = (await service.checkUpdates({ force: true }))[0]!
    expect(update.status).toBe('available')
    await service.ignore({ id: tracked.id, candidateId: update.candidate!.id })
    expect((await service.checkUpdates({ force: true }))[0]?.ignoredCandidate).toBe(update.candidate!.id)
    registration.dispose()
    expect((await service.checkUpdates({ force: true }))[0]?.status).toBe('unavailable')
    expect(service.get(task.id).status).toBe('ready')
    await service.close()
  }))

  it('restores ignored version identity after restart and rejects provider identity substitution', async () => fixture(async directory => {
    const candidate = { name: 'Fixture', kind: 'extension' as const, source: { adapterId: 'platform', url: 'https://platform.example/work', resourceId: 'work' }, packageId: 'test.download', version: '1.0.0', target: { kind: 'file' as const, url: 'https://cdn.example/package.zip' } }
    const adapter = { id: 'platform', matches: (url: URL) => url.hostname === 'platform.example', resolve: async () => [candidate], check: async () => ({ ...candidate, version: '1.1.0' }) }
    const first = createResourceDownloadService({ directory, transport: async () => archive() })
    first.registerAdapter(adapter)
    await first.initialize()
    const resolved = await first.resolve({ url: candidate.source.url, kind: 'extension' })
    const task = await first.start({ candidateId: resolved.candidates[0]!.id })
    await finished(first, task.id)
    const tracked = await first.track({ taskId: task.id })
    const update = (await first.checkUpdates({ force: true }))[0]!
    await first.ignore({ id: tracked.id, candidateId: update.candidate!.id })
    await first.close()
    const second = createResourceDownloadService({ directory, transport: async () => archive() })
    const registration = second.registerAdapter(adapter)
    await second.initialize()
    const restored = (await second.checkUpdates({ force: true }))[0]!
    expect(restored.ignoredCandidate).toBe(restored.candidate!.id)
    registration.dispose()
    second.registerAdapter({ ...adapter, resolve: async () => [{ ...candidate, source: { ...candidate.source, adapterId: 'github' } }] })
    await expect(second.resolve({ url: candidate.source.url, kind: 'extension' })).rejects.toThrow('invalid identity')
    await second.close()
  }))

  it('preserves dependency Git targets and checks the downloaded dependency version', async () => fixture(async directory => {
    const service = createResourceDownloadService({ directory, transport: async () => archive('1.0.0', [{ id: 'test.dependency', version: '^2.0.0', source: { kind: 'git', url: 'https://git.example/dependency' } }]), acquireGit: async (_source, root) => {
      const { installExtensionPackageFromZip } = await import('../../../apps/studio-server/src/extensions/extension-package-installer.js')
      const payload = zipSync({ 'manifest.json': strToU8(JSON.stringify({ manifestVersion: 2, id: 'test.dependency', version: '1.0.0', displayName: 'Dependency', engines: { studio: '*' }, modules: [] })) })
      return installExtensionPackageFromZip({ source: payload, installedDirectory: root })
    } })
    await service.initialize()
    const result = await service.resolve({ url: 'https://cdn.example/package.zip', kind: 'extension' })
    const main = await service.start({ candidateId: result.candidates[0]!.id })
    await finished(service, main.id)
    const dependencies = await service.prepareDependencies(main.id)
    const dependency = await service.start({ candidateId: dependencies.candidates[0]!.id })
    expect(await finished(service, dependency.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('required version') })
    await service.close()
  }))

  it('verifies optional preset release metadata and keeps legacy packages manual-only', async () => fixture(async directory => {
    const artifact = { format: 'loom.promptResource' as const, schemaVersion: 2 as const, resourceKind: 'preset' as const, rootNode: { id: 'root', kind: 'module' as const, label: 'Preset', children: [] } }
    const legacy = encodePromptResourceZip(artifact)
    const files = unzipSync(legacy)
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']))
    files['manifest.json'] = strToU8(JSON.stringify({ ...manifest, release: { id: 'author.preset', version: '1.2.0', update: { manifestUrl: 'https://cdn.example/manifest.json' } } }))
    const versioned = zipSync(files)
    const service = createResourceDownloadService({ directory, transport: async url => url.endsWith('legacy.zip') ? legacy : versioned })
    await service.initialize()
    const modern = await service.resolve({ url: 'https://cdn.example/preset.zip', kind: 'preset' })
    const modernTask = await service.start({ candidateId: modern.candidates[0]!.id })
    expect(await finished(service, modernTask.id)).toMatchObject({ status: 'ready', packageId: 'author.preset', version: '1.2.0' })
    expect(await service.track({ taskId: modernTask.id })).toMatchObject({ installedVersion: '1.2.0' })
    expect(await service.prepareDependencies(modernTask.id)).toMatchObject({ dependencies: [], candidates: [], unsupported: expect.any(String) })
    const old = await service.resolve({ url: 'https://cdn.example/legacy.zip', kind: 'preset' })
    const oldTask = await service.start({ candidateId: old.candidates[0]!.id })
    expect(await finished(service, oldTask.id)).toMatchObject({ status: 'ready' })
    expect(service.get(oldTask.id).version).toBeUndefined()
    await expect(service.track({ taskId: oldTask.id, installedVersion: '9.0.0' })).rejects.toThrow('no verifiable')
    await service.close()
  }))

  it('keeps a source association when its declared Manifest discovers a new version', async () => fixture(async directory => {
    const payload = zipSync({ 'manifest.json': strToU8(JSON.stringify({ manifestVersion: 2, id: 'test.download', version: '1.0.0', displayName: 'Fixture', engines: { studio: '*' }, modules: [], update: { manifestUrl: 'https://metadata.example/manifest.json' } })) })
    const service = createResourceDownloadService({ directory, transport: async url => url.endsWith('manifest.json') ? strToU8(JSON.stringify({ id: 'test.download', version: '1.1.0', distribution: { kind: 'url', url: 'https://cdn.example/new.zip' } })) : payload })
    await service.initialize()
    const sourceUrl = 'https://cdn.example/old.zip'
    const resolved = await service.resolve({ url: sourceUrl, kind: 'extension' })
    const initial = await service.start({ candidateId: resolved.candidates[0]!.id })
    await finished(service, initial.id)
    const tracked = await service.track({ taskId: initial.id, targetId: 'global:test.download' })
    const update = (await service.checkUpdates({ force: true }))[0]!
    expect(update.candidate!.source).toEqual(tracked.source)
    expect(update.candidate!.source.adapterId).toBe('direct')
    expect(update.candidate!.source.url).toBe(sourceUrl)
    await service.close()
    const persisted = JSON.parse(await readFile(join(directory, 'tasks.json'), 'utf8'))
    expect(persisted.updates[0].prepared.manifestUrl).toBe('https://metadata.example/manifest.json')
  }))

  it('can download a persisted candidate inside the 24-hour check window without losing ignore or notification identity', async () => fixture(async directory => {
    const candidate = { name: 'Fixture', kind: 'extension' as const, source: { adapterId: 'platform', url: 'https://platform.example/work', resourceId: 'work' }, packageId: 'test.download', version: '1.0.0', target: { kind: 'file' as const, url: 'https://cdn.example/old.zip' } }
    let checks = 0
    const adapter = { id: 'platform', matches: (url: URL) => url.hostname === 'platform.example', resolve: async () => [candidate], check: async () => { checks++; return { ...candidate, version: '1.1.0', target: { kind: 'file' as const, url: 'https://cdn.example/new.zip' } } } }
    const transport = async (url: string) => archive(url.endsWith('new.zip') ? '1.1.0' : '1.0.0')
    const first = createResourceDownloadService({ directory, transport, now: () => 1_000_000 })
    first.registerAdapter(adapter); await first.initialize()
    const resolved = await first.resolve({ url: candidate.source.url, kind: 'extension' })
    const task = await first.start({ candidateId: resolved.candidates[0]!.id })
    await finished(first, task.id); const tracked = await first.track({ taskId: task.id, targetId: 'card:one' })
    const update = (await first.checkUpdates({ force: true }))[0]!
    await first.ignore({ id: tracked.id, candidateId: update.candidate!.id }); await first.acknowledge(tracked.id)
    await first.close()
    const beforeRestartChecks = checks
    const second = createResourceDownloadService({ directory, transport, now: () => 1_000_100 })
    second.registerAdapter(adapter); await second.initialize()
    const retained = second.listUpdates()[0]!
    expect(retained.candidate!.id).toBe(update.candidate!.id)
    expect(retained.ignoredCandidate).toBe(update.candidate!.id)
    expect(retained.notifiedCandidate).toBe(update.candidate!.id)
    const download = await second.start({ candidateId: update.candidate!.id })
    expect(await finished(second, download.id)).toMatchObject({ status: 'ready', version: '1.1.0' })
    expect(checks).toBe(beforeRestartChecks)
    await second.close()
  }))

  it('does not merge different source sites or adopted local targets into one update record', async () => fixture(async directory => {
    const service = createResourceDownloadService({ directory, transport: async () => archive() })
    service.registerAdapter({ id: 'platform', matches: () => true, resolve: async ({ url }) => [{ name: 'Work', kind: 'extension', source: { adapterId: 'platform', url, resourceId: 'same-platform-id' }, target: { kind: 'file', url: 'https://cdn.example/package.zip' } }] })
    await service.initialize()
    const ids: string[] = []
    for (const [site, targetId] of [['https://one.example/work', 'card:a'], ['https://two.example/work', 'card:a'], ['https://one.example/work', 'card:b']] as const) {
      const resolved = await service.resolve({ url: site, kind: 'extension', adapterId: 'platform' })
      const task = await service.start({ candidateId: resolved.candidates[0]!.id })
      await finished(service, task.id)
      ids.push((await service.track({ taskId: task.id, targetId })).id)
      expect((await service.track({ taskId: task.id, targetId })).id).toBe(ids.at(-1))
    }
    expect(new Set(ids).size).toBe(3)
    expect(service.listUpdates()).toHaveLength(3)
    await service.close()
  }))

  it('reads a repository distribution declaration and recommends its published asset', async () => fixture(async directory => {
    const release = { tag_name: 'v1.0.0', draft: false, prerelease: false, assets: [{ name: 'extension.zip', browser_download_url: 'https://cdn.example/extension.zip' }] }
    const service = createResourceDownloadService({ directory, transport: async url => {
      if (url.includes('/contents/manifest.json')) return strToU8(JSON.stringify({ download_url: 'https://raw.githubusercontent.com/example/project/main/manifest.json' }))
      if (url.includes('raw.githubusercontent.com')) return strToU8(JSON.stringify({ id: 'test.download', version: '1.0.0', displayName: 'Fixture', distribution: { kind: 'release', provider: 'github', repository: 'https://github.com/example/project', asset: 'extension.zip' } }))
      if (url.includes('/releases?')) return strToU8(JSON.stringify([release]))
      return archive()
    } })
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://github.com/example/project', kind: 'extension' })
    expect(resolved.candidates[0]).toMatchObject({ recommended: true, version: '1.0.0', packageId: 'test.download', source: { adapterId: 'github' } })
    expect(resolved.candidates.length).toBeGreaterThan(1)
    const downloaded = await service.start({ candidateId: resolved.candidates[0]!.id })
    expect(await finished(service, downloaded.id)).toMatchObject({ status: 'ready', version: '1.0.0' })
    await service.close()
  }))

  it('allows a missing repository declaration, but does not ignore malformed declarations', async () => fixture(async directory => {
    let missing = true
    const service = createResourceDownloadService({ directory, transport: async url => {
      if (url.includes('/contents/manifest.json')) {
        if (missing) throw new Error('Extension download failed: HTTP 404')
        return strToU8(JSON.stringify({ download_url: 'https://raw.githubusercontent.com/example/project/main/manifest.json' }))
      }
      if (url.includes('raw.githubusercontent.com')) return strToU8(JSON.stringify({ id: 'test.download', version: '1.0.0', distribution: { kind: 'unsupported' } }))
      return strToU8('[]')
    } })
    await service.initialize()
    expect((await service.resolve({ url: 'https://github.com/example/project', kind: 'extension' })).candidates[0]?.name).toContain('Git repository')
    missing = false
    await expect(service.resolve({ url: 'https://github.com/example/project', kind: 'extension' })).rejects.toThrow('supported download distribution')
    await service.close()
  }))

  it('reads release identity from a container Manifest release envelope', async () => {
    const adapters = createBuiltinSourceAdapters(async url => {
      if (url.includes('/releases?')) return strToU8(JSON.stringify([{ tag_name: 'v2.0.0', assets: [{ name: 'preset.zip', browser_download_url: 'https://cdn.example/preset.zip' }, { name: 'manifest.json', browser_download_url: 'https://cdn.example/manifest.json' }] }]))
      return strToU8(JSON.stringify({ schema: 'loom.promptResource.zip.v2', release: { id: 'author.preset', version: '2.0.0' } }))
    })
    const github = adapters.find(adapter => adapter.id === 'github')!
    const next = await github.check!({ source: { adapterId: 'github', url: 'https://github.com/example/project', resourceId: 'example/project#preset.zip' }, installedVersion: '1.0.0', packageId: 'author.preset', kind: 'preset', prerelease: false }, new AbortController().signal)
    expect(next).toMatchObject({ packageId: 'author.preset', version: '2.0.0' })
  })

  it('rechecks an unavailable source when its adapter registers after initialization', async () => fixture(async directory => {
    const candidate = { name: 'Fixture', kind: 'extension' as const, source: { adapterId: 'platform', url: 'https://platform.example/work', resourceId: 'work' }, packageId: 'test.download', version: '1.0.0', target: { kind: 'file' as const, url: 'https://cdn.example/package.zip' } }
    const adapter = { id: 'platform', matches: (url: URL) => url.hostname === 'platform.example', resolve: async () => [candidate], check: async () => ({ ...candidate, version: '1.1.0' }) }
    const first = createResourceDownloadService({ directory, transport: async () => archive() })
    first.registerAdapter(adapter); await first.initialize()
    const resolved = await first.resolve({ url: candidate.source.url, kind: 'extension' })
    const task = await first.start({ candidateId: resolved.candidates[0]!.id })
    await finished(first, task.id); await first.track({ taskId: task.id }); await first.close()
    const second = createResourceDownloadService({ directory, transport: async () => archive() })
    await second.initialize()
    expect((await second.checkUpdates({ force: true }))[0]?.status).toBe('unavailable')
    second.registerAdapter(adapter)
    expect(second.listUpdates()[0]?.checkedAt).toBeUndefined()
    expect((await second.checkUpdates())[0]?.status).toBe('available')
    await second.close()
  }))

  it('resolves a remote release envelope using its outer distribution declaration', async () => {
    const adapters = createBuiltinSourceAdapters(async () => strToU8(JSON.stringify({ release: { id: 'author.fog', version: '1.3.0' }, distribution: { kind: 'url', url: 'https://cdn.example/fog.zip' } })))
    const manifest = adapters.find(adapter => adapter.id === 'manifest')!
    const result = await manifest.resolve({ url: 'https://cdn.example/manifest.json', kind: 'card' }, new AbortController().signal)
    expect(result[0]).toMatchObject({ packageId: 'author.fog', version: '1.3.0', target: { kind: 'file', url: 'https://cdn.example/fog.zip' } })
  })

  it('does not fall back to Git when GitHub release discovery fails', async () => fixture(async directory => {
    const service = createResourceDownloadService({ directory, transport: async () => { throw new Error('HTTP 429') } })
    await service.initialize()
    await expect(service.resolve({ url: 'https://github.com/example/project', kind: 'extension' })).rejects.toThrow('429')
    await service.close()
  }))
  it('persists policy changes without changing identity and protects pinned release sources', async () => fixture(async directory => {
    const candidate = { name: 'Fixture', kind: 'extension' as const, source: { adapterId: 'platform', url: 'https://platform.example/work', resourceId: 'work' }, target: { kind: 'file' as const, url: 'https://cdn.example/work.zip' }, dependencyTarget: 'card' as const }
    const service = createResourceDownloadService({ directory, transport: async () => archive() })
    service.registerAdapter({ id: 'platform', matches: () => true, resolve: async () => [candidate], check: async () => ({ ...candidate, dependencyTarget: 'global', packageId: 'test.download', version: '1.1.0' }) })
    await service.initialize()
    const resolved = await service.resolve({ url: candidate.source.url, kind: 'extension', adapterId: 'platform' })
    const task = await service.start({ candidateId: resolved.candidates[0]!.id }); await finished(service, task.id)
    const tracked = await service.track({ taskId: task.id, targetId: 'card:mine' })
    const before = (await service.checkUpdates({ force: true }))[0]!
    expect(before.status).toBe('available')
    expect(before.dependencyTarget).toBe('card')
    expect(before.candidate?.dependencyTarget).toBe('card')
    const changed = await service.updatePolicy({ id: tracked.id, prerelease: true, fixed: true })
    expect(changed).toMatchObject({ id: tracked.id, targetId: 'card:mine', source: tracked.source, installedVersion: '1.0.0', prerelease: true, fixed: true, status: 'unchecked' })
    expect(changed.candidate).toBeUndefined(); expect(changed.checkedAt).toBeUndefined()
    expect(service.list()).toHaveLength(1)
    expect(await service.track({ taskId: task.id, targetId: 'card:mine' })).toMatchObject({ id: tracked.id, prerelease: true, fixed: true })
    expect(await service.track({ taskId: task.id, targetId: 'card:mine', prerelease: false, fixed: false })).toMatchObject({ prerelease: false, fixed: false })
    await service.updatePolicy({ id: tracked.id, prerelease: true, fixed: true })
    await service.close()
    const restored = createResourceDownloadService({ directory })
    await restored.initialize()
    expect(restored.listUpdates()[0]).toMatchObject({ prerelease: true, fixed: true, dependencyTarget: 'card' })
    await restored.updatePolicy({ id: tracked.id, fixed: false })
    await restored.close()
    const pinned = createResourceDownloadService({ directory: join(directory, 'pinned'), transport: async () => archive() })
    pinned.registerAdapter({ id: 'platform', matches: () => true, resolve: async () => [{ ...candidate, fixedSource: true }] })
    await pinned.initialize()
    const resolvedPinned = await pinned.resolve({ url: candidate.source.url, kind: 'extension', adapterId: 'platform' })
    const pinnedTask = await pinned.start({ candidateId: resolvedPinned.candidates[0]!.id }); await finished(pinned, pinnedTask.id)
    const record = await pinned.track({ taskId: pinnedTask.id, fixed: false })
    expect(record).toMatchObject({ sourcePinned: true, fixed: true })
    await expect(pinned.updatePolicy({ id: record.id, fixed: false })).rejects.toThrow('pinned')
    await pinned.close()
  }))

  it.each(['global', 'card'] as const)('extracts Card dependencies for %s without installing and rejects identity mismatch', async target => fixture(async directory => {
    let declaredVersion = '1.0.0'
    const dependency = { id: 'author.external', version: '^2.0.0', target, source: { kind: 'zip' as const, url: 'https://cdn.example/dependency.zip?signature=secret' } }
    const service = createResourceDownloadService({ directory, transport: async () => encodeCardBundleZip({
      artifact: { schemaVersion: 4, artifactId: 'fog', displayName: 'Fog', card: { name: 'Fog', extensionAdoptions: [{ packageId: 'test.download', target: 'card' }, { packageId: 'author.missing', target: 'global' }] }, contextAssets: [], extensionPackages: [{ packageId: 'test.download', version: declaredVersion, archiveBase64: Buffer.from(archive('1.0.0', [dependency])).toString('base64') }] }, avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
    }) })
    await service.initialize()
    const resolved = await service.resolve({ url: 'https://cdn.example/card.zip', kind: 'card' })
    const task = await service.start({ candidateId: resolved.candidates[0]!.id }); await finished(service, task.id)
    const result = await service.prepareDependencies(task.id)
    expect(result.dependencies).toEqual([
      { id: 'test.download', version: '1.0.0', target: 'card', embedded: true },
      { ...dependency, requestedBy: 'test.download', source: { ...dependency.source, url: 'https://cdn.example/dependency.zip' } },
      { id: 'author.missing', target: 'global' },
    ])
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({ dependencyTarget: target })
    const dependencyTask = await service.start({ candidateId: result.candidates[0]!.id })
    expect(dependencyTask.dependencyTarget).toBe(target)
    await finished(service, dependencyTask.id)
    expect(service.list()).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('secret')
    declaredVersion = '9.0.0'
    const mismatch = await service.start({ candidateId: resolved.candidates[0]!.id }); await finished(service, mismatch.id)
    await expect(service.prepareDependencies(mismatch.id)).rejects.toThrow('identity differs')
    await service.close()
  }))

})
