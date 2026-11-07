import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import type { Logger } from '@loom-studio/logging'
import type { ExtensionManifest } from '@loom-studio/extension-sdk'
import { acquireExtension, parseDownloadSource, satisfiesExtensionVersion, type ExtensionCandidate } from '../extensions/extension-download.js'
import { exportExtensionPackageZip, installExtensionPackageFromZip } from '../extensions/extension-package-installer.js'
import { decodeCardBundleZip } from '../codecs/card-bundle-zip.js'
import { decodePromptResourceZip } from '../codecs/prompt-resource-zip.js'
import { isPng, readCardPngArchive, readPolyglotArchive } from '../codecs/card-png.js'
import { writeJsonAtomically } from '../platform/atomic-json.js'
import { createBuiltinSourceAdapters, displayUrl, downloadPublicResource, publicUrl, safeDownloadError, semver, type DownloadTransport } from './sources.js'
import type { PreparedResourceCandidate, ResourceCandidate, ResourceDownloadArtifact, ResourceDownloadTask, ResourceDependency, ResourceSourceAdapter, ResourceUpdateRecord } from './types.js'
export type * from './types.js'

type StoredTask = { task: ResourceDownloadTask; artifact?: ResourceDownloadArtifact; manifestUrl?: string; needsResolve?: boolean; fixed?: boolean; verifiedVersion?: string }
type StoredUpdate = { record: ResourceUpdateRecord; manifestUrl?: string; prepared?: PreparedResourceCandidate }
const interval = 24 * 60 * 60_000

export function createResourceDownloadService(options: {
  directory: string
  logger?: Logger
  transport?: DownloadTransport
  acquireGit?: (source: { kind: 'git'; url: string; ref?: string }, directory: string, signal: AbortSignal) => Promise<ExtensionCandidate>
  now?: () => number
}) {
  const download = options.transport ?? downloadPublicResource
  const now = options.now ?? Date.now
  const adapters = new Map(createBuiltinSourceAdapters(download).map(adapter => [adapter.id, adapter]))
  const candidates = new Map<string, PreparedResourceCandidate>()
  const tasks = new Map<string, StoredTask>()
  const updates = new Map<string, StoredUpdate>()
  const controllers = new Map<string, AbortController>()
  const running = new Map<string, Promise<void>>()
  let initialized = false
  let closed = false
  let timer: ReturnType<typeof setInterval> | undefined
  let checking: Promise<ResourceUpdateRecord[]> | undefined
  let writes: Promise<void> = Promise.resolve()
  const filename = join(options.directory, 'tasks.json')
  const stamp = () => new Date(now()).toISOString()
  const clone = <T>(value: T): T => structuredClone(value)
  function assertReady() { if (!initialized || closed) throw new Error('Resource download service is unavailable') }
  function save() {
    const snapshot = { version: 1, tasks: [...tasks.values()], updates: [...updates.values()] }
    const write = writes.then(() => writeJsonAtomically(filename, snapshot))
    writes = write.catch(() => undefined)
    return write
  }
  function task(id: string) {
    const value = tasks.get(id)
    if (!value) throw new Error('Download task not found')
    return value
  }
  function log(id: string, message: string) {
    options.logger?.info(message, { event: 'resource.download.stage', data: { taskId: id, phase: tasks.get(id)?.task.phase ?? 'waiting' } })
  }
  function publish(candidate: PreparedResourceCandidate, id: string = randomUUID()): ResourceCandidate {
    if (!adapters.has(candidate.source.adapterId)) throw new Error('Source adapter is unavailable')
    publicUrl(candidate.source.url)
    publicUrl(candidate.target.url)
    if (candidate.kind !== 'extension' && candidate.target.kind === 'git') throw new Error('Git directory sources only support extension packages')
    if (candidate.target.kind === 'git') parseDownloadSource(candidate.target)
    candidates.set(id, clone(candidate))
    if (candidates.size > 500) candidates.delete(candidates.keys().next().value!)
    const { target: _target, manifestUrl: _url, sha256: _sha256, expectedVersionRange: _range, ...display } = candidate
    return { ...display, source: { ...display.source, url: displayUrl(display.source.url) }, id }
  }
  async function resolve(input: { url: string; kind: 'extension' | 'card' | 'preset'; ref?: string; adapterId?: string }) {
    assertReady()
    const url = publicUrl(input.url)
    const matching = input.adapterId ? [adapters.get(input.adapterId)].filter((value): value is ResourceSourceAdapter => !!value) : [...adapters.values()].filter(adapter => adapter.matches(url))
    if (input.adapterId && !matching.length) throw new Error('Source adapter is unavailable')
    if (matching.length > 1) return { candidates: [] as ResourceCandidate[], adapters: matching.map(adapter => ({ id: adapter.id })) }
    const adapter = matching[0] ?? adapters.get('direct')!
    try {
      const result = await adapter.resolve(input, AbortSignal.timeout(30_000))
      if (result.length > 100) throw new Error('Too many resource candidates')
      if (result.some(candidate => candidate.kind !== input.kind || candidate.source.adapterId !== adapter.id)) throw new Error('Source adapter returned an invalid identity')
      return { candidates: result.map(candidate => publish(candidate)) }
    } catch (error) { throw new Error(safeDownloadError(error), { cause: error }) }
  }
  async function initialize() {
    if (initialized) return
    await mkdir(options.directory, { recursive: true, mode: 0o700 })
    let stored: { version: number; tasks: StoredTask[]; updates: StoredUpdate[] } | undefined
    try { stored = JSON.parse(await readFile(filename, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (stored) {
      if (stored.version !== 1 || !Array.isArray(stored.tasks) || !Array.isArray(stored.updates)) throw new Error('Unsupported download task store')
      for (const entry of stored.tasks) {
        if (!/^[a-f0-9-]{36}$/.test(entry.task.id)) throw new Error('Invalid persisted download task ID')
        if (entry.task.status === 'queued' || entry.task.status === 'downloading') {
          entry.task.status = 'interrupted'; entry.task.phase = 'failed'; entry.task.error = 'Download was interrupted by service shutdown; retry to start again'
        }
        tasks.set(entry.task.id, entry)
      }
      for (const entry of stored.updates) {
        updates.set(entry.record.id, entry)
        if (entry.prepared && entry.record.candidate && adapters.has(entry.record.source.adapterId)) {
          if (entry.prepared.source.adapterId !== entry.record.source.adapterId || entry.prepared.source.resourceId !== entry.record.source.resourceId || displayUrl(entry.prepared.source.url) !== displayUrl(entry.record.source.url)) throw new Error('Persisted update source identity mismatch')
          entry.record.candidate = publish(entry.prepared, entry.record.candidate.id)
        }
      }
    }
    initialized = true
    await save()
    timer = setInterval(() => { void checkUpdates().catch(error => options.logger?.error('Resource update check failed', { event: 'resource.update.failed', data: { message: safeDownloadError(error) } })) }, 60_000)
    timer.unref()
    void checkUpdates().catch(error => options.logger?.error('Resource update check failed', { event: 'resource.update.failed', data: { message: safeDownloadError(error) } }))
  }
  function releaseMetadata(bytes: Uint8Array): { id: string; version: string; manifestUrl?: string } | undefined {
    const files = unzipSync(bytes, { filter: entry => {
      if (entry.name !== 'manifest.json') return false
      if (entry.originalSize > 64 * 1024) throw new Error('Resource Manifest exceeds metadata size limit')
      return true
    } })
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files['manifest.json'])) as { release?: { id?: unknown; version?: unknown; update?: { manifestUrl?: unknown } } }
    if (manifest.release === undefined) return undefined
    const release = manifest.release
    if (!release || typeof release.id !== 'string' || !release.id.trim() || typeof release.version !== 'string' || !semver.valid(release.version)) throw new Error('Resource release metadata requires a stable ID and SemVer version')
    const manifestUrl = release.update?.manifestUrl
    if (manifestUrl !== undefined && typeof manifestUrl !== 'string') throw new Error('Invalid release update Manifest URL')
    return { id: release.id, version: release.version, ...(typeof manifestUrl === 'string' ? { manifestUrl: publicUrl(manifestUrl).href } : {}) }
  }
  async function inspect(bytes: Uint8Array, kind: ResourceCandidate['kind'], root: string) {
    if (kind === 'extension') {
      const installed = await installExtensionPackageFromZip({ source: bytes, installedDirectory: join(root, 'package'), flat: true })
      return { directory: installed.directory, manifest: installed.manifest }
    }
    if (kind === 'preset') {
      const artifact = decodePromptResourceZip(bytes)
      if (artifact.resourceKind !== 'preset') throw new Error('Downloaded resource is not a preset')
      return { release: releaseMetadata(bytes) }
    }
    if (isPng(bytes)) {
      const archive = readCardPngArchive(bytes) ?? readPolyglotArchive(bytes)
      if (archive) { await decodeCardBundleZip(archive); return { release: releaseMetadata(archive) } }
      // Non-Loom PNGs remain staged for the existing explicit ST conversion importer.
      return {}
    }
    await decodeCardBundleZip(bytes)
    return { release: releaseMetadata(bytes) }
  }
  async function run(id: string, candidate: PreparedResourceCandidate, controller: AbortController) {
    const entry = task(id)
    const root = join(options.directory, id)
    let manifest: ExtensionManifest | undefined
    try {
      entry.task.status = 'downloading'; entry.task.phase = 'fetching'; entry.task.updatedAt = stamp()
      await save(); log(id, 'Resource download started')
      await rm(root, { recursive: true, force: true })
      await mkdir(root, { recursive: true, mode: 0o700 })
      const adapter = adapters.get(candidate.source.adapterId)
      if (!adapter) throw new Error('Source adapter is unavailable')
      const prepared = adapter.prepare ? await adapter.prepare(clone(candidate), controller.signal) : candidate
      if (prepared.source.adapterId !== candidate.source.adapterId || prepared.source.resourceId !== candidate.source.resourceId || displayUrl(prepared.source.url) !== displayUrl(candidate.source.url) || prepared.packageId !== candidate.packageId || prepared.kind !== candidate.kind || prepared.version !== candidate.version || prepared.revision !== candidate.revision) throw new Error('Download preparation changed the selected resource version')
      entry.fixed = candidate.fixedSource === true
      let bytes: Uint8Array
      let directory: string | undefined
      if (prepared.target.kind === 'git') {
        const acquired = await (options.acquireGit ? options.acquireGit(prepared.target, root, controller.signal) : acquireExtension(prepared.target, root, { signal: controller.signal }))
        manifest = acquired.manifest; directory = acquired.directory
        if (acquired.source?.kind === 'git') {
          const ref = acquired.source.ref
          entry.fixed ||= !!ref && (/^[a-f0-9]{40}$/i.test(ref) || ref.startsWith('refs/tags/'))
        }
        bytes = await exportExtensionPackageZip(directory, manifest)
        entry.task.revision = acquired.commit
      } else {
        bytes = await download(prepared.target.url, { maxBytes: 256 * 1024 * 1024, timeoutMs: 120_000, signal: controller.signal, onProgress(receivedBytes, totalBytes) { entry.task.receivedBytes = receivedBytes; entry.task.totalBytes = totalBytes; entry.task.updatedAt = stamp() } })
      }
      controller.signal.throwIfAborted()
      entry.task.phase = 'validating'; entry.task.receivedBytes = bytes.length; entry.task.updatedAt = stamp()
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (prepared.sha256 && digest !== prepared.sha256.toLowerCase()) throw new Error('Downloaded package checksum does not match selected candidate')
      if (!manifest) {
        const inspected = await inspect(bytes, entry.task.kind, root)
        manifest = inspected.manifest; directory = inspected.directory
        if (inspected.release) {
          if (candidate.packageId && candidate.packageId !== inspected.release.id) throw new Error('Downloaded resource identity does not match selected candidate')
          if (candidate.version && candidate.version !== inspected.release.version) throw new Error('Downloaded Manifest version does not match selected candidate')
          entry.task.packageId = inspected.release.id; entry.task.version = inspected.release.version; entry.verifiedVersion = inspected.release.version
          if (inspected.release.manifestUrl && !publicUrl(inspected.release.manifestUrl).search) entry.manifestUrl = inspected.release.manifestUrl
        } else if (entry.task.kind !== 'extension') {
          entry.task.version = undefined; entry.task.packageId = undefined
          if (candidate.version || candidate.packageId) throw new Error('Downloaded resource has no release metadata to verify the selected candidate')
        }
      }
      controller.signal.throwIfAborted()
      if (manifest) {
        if (candidate.packageId && candidate.packageId !== manifest.id) throw new Error('Downloaded package identity does not match selected candidate')
        if (candidate.expectedVersionRange && !satisfiesExtensionVersion(manifest.version, candidate.expectedVersionRange)) throw new Error('Downloaded dependency does not satisfy its required version')
        if (candidate.version && candidate.version !== manifest.version) throw new Error('Downloaded Manifest version does not match selected candidate')
        entry.task.packageId = manifest.id; entry.task.version = manifest.version; entry.verifiedVersion = manifest.version
        entry.task.dependencies = (manifest.dependencies ?? []).map(dependency => ({ ...dependency, ...(dependency.source ? { source: { ...dependency.source, url: displayUrl(dependency.source.url) } } : {}) }))
        const update = (manifest as ExtensionManifest & { update?: { manifestUrl?: string } }).update
        if (update?.manifestUrl) {
          const parsed = publicUrl(update.manifestUrl)
          if (!parsed.search) entry.manifestUrl = parsed.href
        }
      }
      const path = join(root, isPng(bytes) ? 'artifact.png' : 'artifact.zip')
      await writeFile(path, bytes, { mode: 0o600 })
      entry.artifact = { kind: entry.task.kind, path, directory, fileName: isPng(bytes) ? 'resource.png' : 'resource.zip' }
      entry.task.sha256 = digest; entry.task.status = 'ready'; entry.task.phase = 'staged'; entry.task.error = undefined; entry.task.updatedAt = stamp()
      await save(); log(id, 'Resource staged; no installation or activation performed')
    } catch (error) {
      entry.task.status = controller.signal.aborted ? 'cancelled' : 'failed'
      entry.task.phase = controller.signal.aborted ? 'cancelled' : 'failed'
      entry.task.error = controller.signal.aborted ? 'Download cancelled' : safeDownloadError(error)
      entry.task.updatedAt = stamp()
      await save(); log(id, entry.task.error)
    } finally { controllers.delete(id); running.delete(id) }
  }
  function launch(id: string, candidate: PreparedResourceCandidate) {
    const controller = new AbortController(); controllers.set(id, controller)
    const operation = run(id, candidate, controller)
    running.set(id, operation)
    void operation.catch(error => options.logger?.error('Download task could not be persisted', { event: 'resource.download.persistence_failed', data: { taskId: id, message: safeDownloadError(error) } }))
  }
  async function start({ candidateId }: { candidateId: string }) {
    assertReady()
    const candidate = candidates.get(candidateId) ?? await restoreCandidate(candidateId)
    if (!candidate) throw new Error('Source candidate expired; resolve the link again')
    if (controllers.size >= 3) throw new Error('Three downloads are already running; wait or cancel a task')
    const id = randomUUID()
    const { target: _target, manifestUrl, sha256: _sha256, expectedVersionRange: _range, ...display } = candidate
    const value: ResourceDownloadTask = { ...display, source: { ...display.source, url: displayUrl(display.source.url) }, id, candidateId, status: 'queued', phase: 'waiting', createdAt: stamp(), updatedAt: stamp(), receivedBytes: 0, dependencies: [] }
    tasks.set(id, { task: value, ...(manifestUrl && !publicUrl(manifestUrl).search ? { manifestUrl } : {}), needsResolve: !!publicUrl(candidate.target.url).search })
    await save(); launch(id, candidate)
    return clone(value)
  }
  async function cancel(id: string) {
    assertReady(); task(id)
    controllers.get(id)?.abort()
    await running.get(id)
    return clone(task(id).task)
  }
  async function retry(id: string) {
    assertReady()
    const entry = task(id)
    if (!['failed', 'cancelled', 'interrupted'].includes(entry.task.status)) throw new Error('Only a stopped download can be retried')
    let candidate = candidates.get(entry.task.candidateId)
    if (!candidate) {
      if (entry.needsResolve) throw new Error('Temporary download link expired; resolve the original platform link again')
      const result = await resolve({ url: entry.task.source.url, kind: entry.task.kind, adapterId: entry.task.source.adapterId })
      const match = result.candidates.find(item => item.source.resourceId === entry.task.source.resourceId && item.revision === entry.task.revision && (!entry.task.version || item.version === entry.task.version))
      if (!match) throw new Error('The original selected version is unavailable; choose a version again')
      candidate = candidates.get(match.id)!
      entry.task.candidateId = match.id
    }
    entry.task.receivedBytes = 0; entry.task.totalBytes = undefined; entry.task.error = undefined
    if (controllers.size >= 3) throw new Error('Three downloads are already running')
    launch(id, candidate)
    return clone(entry.task)
  }
  async function prepareDependencies(id: string) {
    assertReady()
    const entry = task(id)
    if (entry.task.status !== 'ready') throw new Error('Download must complete before reading dependencies')
    if (!entry.artifact) throw new Error('Staged artifact is unavailable')
    if (entry.task.kind === 'preset') return { dependencies: [] as ResourceDependency[], candidates: [] as ResourceCandidate[], unsupported: 'Preset packages do not declare external extension download dependencies' }
    let dependencies: ResourceDependency[]
    if (entry.artifact.directory) {
      const manifest = JSON.parse(await readFile(join(entry.artifact.directory, 'manifest.json'), 'utf8')) as ExtensionManifest
      dependencies = manifest.dependencies ?? []
    } else {
      const bytes = await readFile(entry.artifact.path)
      const archive = isPng(bytes) ? readCardPngArchive(bytes) ?? readPolyglotArchive(bytes) : bytes
      if (!archive) return { dependencies: [] as ResourceDependency[], candidates: [] as ResourceCandidate[], unsupported: 'This card format has no native extension dependency declaration' }
      const { artifact } = await decodeCardBundleZip(archive)
      dependencies = []
      const inspection = await mkdtemp(join(options.directory, id, 'dependency-inspection-'))
      try {
        for (const embedded of artifact.extensionPackages ?? []) {
          const installed = await installExtensionPackageFromZip({ source: Buffer.from(embedded.archiveBase64, 'base64'), installedDirectory: inspection })
          if (installed.manifest.id !== embedded.packageId || installed.manifest.version !== embedded.version) throw new Error('Embedded extension Manifest identity differs from Card declaration')
          dependencies.push({ id: embedded.packageId, version: embedded.version, target: 'card', embedded: true })
          dependencies.push(...(installed.manifest.dependencies ?? []).map(dependency => ({ ...dependency, requestedBy: embedded.packageId })))
          // Only inspect bytes here: no discovery, resource import, or activation.
          await rm(installed.directory, { recursive: true, force: true })
        }
      } finally { await rm(inspection, { recursive: true, force: true }) }
      for (const adoption of artifact.card.extensionAdoptions ?? []) {
        if (adoption.target === 'card' && dependencies.some(dependency => dependency.embedded && dependency.id === adoption.packageId)) continue
        dependencies.push({ id: adoption.packageId, target: adoption.target })
      }
    }
    const result: ResourceCandidate[] = []
    for (const dependency of dependencies) {
      if (!dependency.source) continue
      const source = parseDownloadSource(dependency.source)
      result.push(publish({ name: `${dependency.id} · ${dependency.version}`, kind: 'extension', packageId: dependency.id,
        expectedVersionRange: dependency.version, dependencyTarget: dependency.target ?? 'global',
        source: { adapterId: 'direct', url: displayUrl(source.url), resourceId: dependency.id },
        target: source.kind === 'git' ? source : { kind: 'file', url: source.url },
      }))
    }
    entry.task.dependencies = dependencies.map(dependency => ({ ...dependency, ...(dependency.source ? { source: { ...dependency.source, url: displayUrl(dependency.source.url) } } : {}) }))
    await save()
    return { dependencies: clone(entry.task.dependencies), candidates: result }
  }
  async function track(input: { taskId: string; targetId?: string; installedVersion?: string; prerelease?: boolean; fixed?: boolean }) {
    assertReady()
    const entry = task(input.taskId)
    if (entry.task.status !== 'ready') throw new Error('Only a staged task can be recorded after adoption')
    if (!entry.verifiedVersion) throw new Error('This package has no verifiable Manifest release version; automatic update tracking is unavailable')
    const installedVersion = input.installedVersion ?? entry.verifiedVersion
    if (installedVersion !== entry.verifiedVersion) throw new Error('Adopted version must match the staged Manifest version')
    if (!installedVersion || !semver.valid(installedVersion)) throw new Error('Adopted resource requires a SemVer Manifest version')
    const existing = [...updates.values()].find(value => value.record.source.adapterId === entry.task.source.adapterId && value.record.source.resourceId === entry.task.source.resourceId && publicUrl(value.record.source.url).origin === publicUrl(entry.task.source.url).origin && value.record.kind === entry.task.kind && value.record.targetId === input.targetId && value.record.dependencyTarget === entry.task.dependencyTarget)
    const id = existing?.record.id ?? randomUUID()
    const record: ResourceUpdateRecord = { id, source: entry.task.source, name: entry.task.name, kind: entry.task.kind, targetId: input.targetId, dependencyTarget: entry.task.dependencyTarget, installedVersion, packageId: entry.task.packageId, prerelease: input.prerelease ?? existing?.record.prerelease ?? false, fixed: entry.fixed || (input.fixed ?? existing?.record.fixed ?? false), sourcePinned: entry.fixed === true, status: 'unchecked' }
    updates.set(id, { record, manifestUrl: entry.manifestUrl })
    await save(); return clone(record)
  }
  async function discoverUpdate(entry: StoredUpdate): Promise<PreparedResourceCandidate | null> {
    const record = entry.record
    const adapter = adapters.get(record.source.adapterId)
    if (!adapter) throw new Error('Source adapter is unavailable')
    const checkAdapter = entry.manifestUrl ? adapters.get('manifest') : adapter
    if (!checkAdapter?.check) throw new Error('Source does not support automatic update checks')
    const candidate = await checkAdapter.check({ source: entry.manifestUrl ? { ...record.source, url: entry.manifestUrl } : record.source, installedVersion: record.installedVersion, packageId: record.packageId, kind: record.kind, prerelease: record.prerelease }, AbortSignal.timeout(30_000))
    if (!candidate) return null
    if (candidate.source.adapterId !== checkAdapter.id || candidate.kind !== record.kind) throw new Error('Update adapter returned an invalid identity')
    if (!entry.manifestUrl && (candidate.source.resourceId !== record.source.resourceId || displayUrl(candidate.source.url) !== displayUrl(record.source.url))) throw new Error('Update adapter changed the source identity')
    if (record.packageId && candidate.packageId !== record.packageId) throw new Error('Update source returned a different package identity')
    if (!candidate.version || !semver.valid(candidate.version)) throw new Error('Update source did not provide a valid Manifest version')
    // The Manifest URL is a check endpoint, not permission to migrate the source association.
    return { ...candidate, dependencyTarget: record.dependencyTarget, source: clone(record.source), ...(entry.manifestUrl ? { manifestUrl: entry.manifestUrl } : {}) }
  }
  function rememberCandidate(entry: StoredUpdate, candidate: PreparedResourceCandidate, id?: string) {
    entry.record.candidate = publish(candidate, id)
    // Signed targets remain ephemeral. Their stable source/version can regenerate a target on demand.
    entry.prepared = publicUrl(candidate.target.url).search || (candidate.manifestUrl && publicUrl(candidate.manifestUrl).search) ? undefined : clone(candidate)
  }
  async function restoreCandidate(id: string): Promise<PreparedResourceCandidate | undefined> {
    const entry = [...updates.values()].find(value => value.record.candidate?.id === id)
    if (!entry) return undefined
    const selected = entry.record.candidate!
    const candidate = entry.prepared ?? await discoverUpdate(entry)
    if (!candidate || candidate.version !== selected.version || candidate.revision !== selected.revision) throw new Error('Selected update is no longer available; check updates and review the new candidate')
    rememberCandidate(entry, candidate, id)
    await save()
    return candidates.get(id)
  }
  async function checkOne(entry: StoredUpdate) {
    const record = entry.record
    record.checkedAt = stamp(); record.error = undefined
    if (record.fixed) { record.status = 'unsupported'; record.candidate = undefined; entry.prepared = undefined; return }
    const adapter = adapters.get(record.source.adapterId)
    if (!adapter) { record.status = 'unavailable'; return }
    if (!(entry.manifestUrl ? adapters.get('manifest') : adapter)?.check) { record.status = 'unsupported'; record.candidate = undefined; entry.prepared = undefined; return }
    try {
      const candidate = await discoverUpdate(entry)
      if (!candidate || !semver.gt(candidate.version!, record.installedVersion) || (!record.prerelease && semver.prerelease(candidate.version!))) { record.status = 'current'; record.candidate = undefined; entry.prepared = undefined; return }
      const previous = record.candidate
      const unchanged = previous?.version === candidate.version && previous?.revision === candidate.revision
      // Stable candidate IDs preserve ignore/notification state and download actions after restart.
      rememberCandidate(entry, candidate, unchanged ? previous!.id : undefined)
      record.status = 'available'
    } catch (error) { record.status = 'failed'; record.error = safeDownloadError(error) }
  }
  function checkUpdates({ force = false }: { force?: boolean } = {}) {
    assertReady()
    if (checking) return checking
    checking = (async () => {
      let changed = false
      for (const entry of updates.values()) {
        if (closed) break
        if (!force && entry.record.checkedAt && now() - Date.parse(entry.record.checkedAt) < interval) continue
        await checkOne(entry); changed = true
      }
      if (changed) await save()
      return [...updates.values()].map(entry => clone(entry.record))
    })().finally(() => { checking = undefined })
    return checking
  }
  async function updatePolicy(input: { id: string; prerelease?: boolean; fixed?: boolean }) {
    assertReady()
    // Finish a pending check before invalidating its result under a new policy.
    if (checking) await checking
    const entry = updates.get(input.id)
    if (!entry) throw new Error('Update source not found')
    const record = entry.record
    if (record.sourcePinned && input.fixed === false) throw new Error('This source is pinned to a tag or commit; select a new source to follow updates')
    if (input.prerelease === undefined && input.fixed === undefined) return clone(record)
    if (input.prerelease !== undefined) record.prerelease = input.prerelease
    if (input.fixed !== undefined) record.fixed = input.fixed
    if (record.candidate) candidates.delete(record.candidate.id)
    record.candidate = undefined; entry.prepared = undefined
    record.checkedAt = undefined; record.error = undefined; record.status = 'unchecked'
    await save()
    return clone(record)
  }
  async function ignore({ id, candidateId }: { id: string; candidateId?: string }) {
    assertReady()
    const entry = updates.get(id)
    if (!entry) throw new Error('Update source not found')
    if (candidateId && entry.record.candidate?.id !== candidateId) throw new Error('Update candidate changed; inspect it again')
    entry.record.ignoredCandidate = candidateId
    await save(); return clone(entry.record)
  }
  async function acknowledge(id: string) {
    assertReady()
    const entry = updates.get(id)
    if (!entry) throw new Error('Update source not found')
    entry.record.notifiedCandidate = entry.record.candidate?.id
    await save(); return clone(entry.record)
  }
  return {
    initialize, resolve, start, cancel, retry, prepareDependencies, track, checkUpdates, updatePolicy, ignore, acknowledge,
    list: () => { assertReady(); return [...tasks.values()].map(entry => clone(entry.task)) },
    get: (id: string) => { assertReady(); return clone(task(id).task) },
    listUpdates: () => { assertReady(); return [...updates.values()].map(entry => clone(entry.record)) },
    readArtifact: (id: string): ResourceDownloadArtifact => { assertReady(); const entry = task(id); if (entry.task.status !== 'ready' || !entry.artifact) throw new Error('Resource artifact is not ready'); return clone(entry.artifact) },
    registerAdapter(adapter: ResourceSourceAdapter) {
      if (adapters.has(adapter.id)) throw new Error(`Source adapter already registered: ${adapter.id}`)
      adapters.set(adapter.id, adapter)
      let resumed = false
      for (const entry of updates.values()) {
        if (entry.record.source.adapterId !== adapter.id || entry.record.status !== 'unavailable') continue
        entry.record.status = 'unchecked'
        entry.record.checkedAt = undefined
        entry.record.error = undefined
        resumed = true
      }
      if (resumed && initialized && !closed) {
        // Extensions can register after startup checks. Retry after any in-flight check,
        // rather than leaving the source unavailable for another daily interval.
        void (checking ?? Promise.resolve()).then(() => closed ? undefined : checkUpdates()).catch(error => options.logger?.error('Restored source check failed', { event: 'resource.update.failed', data: { adapterId: adapter.id, message: safeDownloadError(error) } }))
      }
      return { dispose() { if (adapters.get(adapter.id) === adapter) adapters.delete(adapter.id) } }
    },
    async close() { closed = true; if (timer) clearInterval(timer); for (const controller of controllers.values()) controller.abort(); await Promise.allSettled([...running.values()]); await checking; await writes },
  }
}
export type ResourceDownloadService = ReturnType<typeof createResourceDownloadService>
