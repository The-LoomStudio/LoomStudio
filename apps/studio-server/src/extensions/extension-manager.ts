import { listExtensionRecoveryRecords } from './extension-recovery.js'
import { loadPromptResourceFiles } from '../codecs/prompt-resource-files.js'
import type {
  EventCapabilityCategory,
  ExtensionAgentToolContribution,
  ExtensionAssetCapability,
  ExtensionHost,
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionModuleSummary,
  ExtensionPromptResourceContribution,
  ExtensionTextExtractorContribution,
  ExtensionTextTransformRuleContribution,
} from '@loom-studio/extension-host'
import type {
  ExtensionManagementService,
  ImportedExtensionPackageResources,
  ManagedExtensionModule,
  ManagedExtensionPackage,
  RemovedExtensionPackageResources,
} from '@loom-studio/kernel'
import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import { promptResourceDisplayMetadataSchema, type JsonValue } from '@loom-studio/shared'
import { extensionInstallationId, type ExtensionInstallationTarget, type ListExtensionInstallationsResult } from '@loom-studio/application-runtime'
import { parseExtensionManifest } from '@loom-studio/extension-host'
import { serializeError } from '@loom-studio/shared'
import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { cp, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { downloadExtensionZip, acquireExtension, checkGitUpdate, createDownloadWorkspace, extensionGit, parseDownloadSource, readDownloadMetadata, satisfiesExtensionVersion, type ExtensionCandidate } from './extension-download.js'
import { writeJsonAtomically } from '../platform/atomic-json.js'
import { discoverExtensionSources, removeExtensionDevLink, type DiscoveredExtensionSource, type ExtensionSource } from './extension-sources.js'
import {
  installExtensionPackageFromDirectory,
  type InstalledExtensionPackage,
  exportExtensionPackageZip,
  installExtensionPackageFromZip,
  uninstallExtensionPackageDirectory,
} from './extension-package-installer.js'
import type { ExtensionModuleDesiredState, ExtensionStateStore } from './extension-state-store.js'

type PackageCatalogRecord = {
  fileRevision?: string
  remote?: { source: NonNullable<ExtensionCandidate['source']>; commit?: string; canRollback: boolean }
  reloadIds?: Record<string, string>
  archiveDigest?: string
  manifest: ExtensionManifest
  sources: ExtensionSource[]
  directory: string
  available: boolean
}

class ExtensionInstallFailure extends Error {
  constructor(
    readonly stage: string,
    readonly codeCommitted: boolean,
    readonly recovery: { recordPath: string; backupDirectory: string; historyDirectory: string } | undefined,
    cause: unknown,
  ) {
    super(`${codeCommitted ? 'Package code installed; ' : ''}${stage} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}

export type ServerExtensionManager = ExtensionManagementService & {
  readCharacterPackage(packageId: string): { manifest: ExtensionManifest; fileUrl(path: string): string; read(path: string): Promise<Uint8Array> }
  validatePackageAsset(input: { packageId: string; packageVersion: string; target: ExtensionInstallationTarget; path: string }): Promise<void>
  withCardDeletions<T>(cardIds: string[], commit: () => Promise<T>): Promise<T>
  readCardPackageFile(cardId: string, packageId: string, version: string, archiveDigest: string, path: string): Promise<{ bytes: Uint8Array; mediaType: string }>
  initialize(): Promise<void>
  getGrantedEventCapabilities(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): readonly EventCapabilityCategory[]
  getGrantedAssetCapabilities(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): readonly ExtensionAssetCapability[]
  readPackageIcon(packageId: string, version: string): Promise<{
    bytes: Uint8Array
    mediaType: string
  } | undefined>
  readPackageFile(packageId: string, version: string, path: string): Promise<{
    bytes: Uint8Array
    mediaType: string
  }>
}

export function createServerExtensionManager(options: {
  host: ExtensionHost
  onModuleBatchCompleted?(result: import('@loom-studio/kernel').ExtensionModuleBatchResult): void
  diagnostics: DiagnosticsRegistry
  stateStore: ExtensionStateStore
  repositoryDirectory?: string
  installedDirectory: string
  devLinksFile: string
  deleteData?(packageId: string, documentTypes: string[]): Promise<void>
  officialSetupFile?: string
  /** Direct package sources with one-time resource/default setup; never copied into installedDirectory. */
  bundledDirectories?: string[]
  bundledEnabledModules?: Record<string, readonly string[]>
  exportExtensionArchive?: import('@loom-studio/application-runtime').ApplicationRuntimeOptions['exportExtensionArchive']
  readCardPackage(input: { cardId: string; packageId: string; source?: 'installed' }): Promise<{ cardVersion: number; archive: { packageId: string; version: string; archiveBase64: string } }>
  listInstallations(): Promise<ListExtensionInstallationsResult>
  assertDependencyConsumers?(packageId: string, target: ExtensionInstallationTarget, nextVersion?: string): Promise<void>
  importPackageResources(input: {
    participation?: 'timeline'
    source?: import('@loom-studio/application-runtime').ExtensionInstallationSource
    loomScripts?: Array<{ contribution: { id: string; source: string; orderIndex?: number; groupOrder?: number }; source: string }>
    target?: ExtensionInstallationTarget
    expectedCardVersion?: number
    update?: { expectedInstallationVersion: number; expectedPreviewFingerprint?: string; keepPromptResourceIds?: string[] }
    packageId: string
    packageVersion: string
    dependencies?: import('@loom-studio/extension-sdk').ExtensionManifest['dependencies']
    promptResources: Array<{
      contribution: ExtensionPromptResourceContribution
      artifact: JsonValue
    }>
    agentTools: Array<{
      contribution: ExtensionAgentToolContribution
      definition: JsonValue
    }>
    transformRules: Array<{
      contribution: ExtensionTextTransformRuleContribution
      artifact: JsonValue
    }>
    textExtractors: Array<{
      contribution: ExtensionTextExtractorContribution
      artifact: JsonValue
    }>
  }): Promise<import('@loom-studio/application-runtime').ImportExtensionPackageResourcesResult>
  previewPackageResources(input: import('@loom-studio/application-runtime').PreviewExtensionPackageResourcesInput): Promise<import('@loom-studio/application-runtime').PreviewExtensionPackageResourcesResult>
  uninstallInstallation(input: { packageId: string; target?: ExtensionInstallationTarget; expectedInstallationVersion: number }): Promise<unknown>
  removePackageResources(input: { packageId: string; target?: ExtensionInstallationTarget; expectedInstallationVersion?: number }): Promise<import('@loom-studio/application-runtime').RemoveExtensionPackageResourcesResult>
}): ServerExtensionManager {
  const catalog = new Map<string, PackageCatalogRecord>()
  const importingAssetSources = new Map<string, PackageCatalogRecord>()
  const assetSourceKey = (packageId: string, target: ExtensionInstallationTarget, version: string) => JSON.stringify([extensionInstallationId(packageId, target), version])
  const cardCatalog = new Map<string, { target: Extract<ExtensionInstallationTarget, { kind: 'card' }>; record: PackageCatalogRecord }>()
  let initialized = false
  type PreparedInstall = { root: string; candidates: ExtensionCandidate[]; replacement?: string; expected: string; timer: ReturnType<typeof setTimeout> }
  const prepared = new Map<string, PreparedInstall>()
  let preparing = 0
  const catalogFingerprint = () => JSON.stringify([...catalog].map(([id, entry]) => [id, entry.manifest.version, entry.directory, entry.fileRevision, entry.remote?.commit]))
  async function readOfficialState(): Promise<{ completed?: boolean; bundled?: string[] }> {
    if (!options.officialSetupFile) return {}
    try { return JSON.parse(await readFile(options.officialSetupFile, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error }
  }

  async function withPreparationSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (prepared.size + preparing >= 4) throw new Error('Extension preparation limit exceeded')
    preparing += 1
    try {
      return await operation()
    } finally {
      preparing -= 1
    }
  }

  async function prepareSources(sources: unknown[], replacement?: string, snapshot?: ExtensionCandidate, workspace?: string): Promise<import('@loom-studio/kernel').RemoteInstallPreview> {
    if (!sources.length || sources.length > 100) throw new Error('Extension preparation limit exceeded')
    const expected = catalogFingerprint()
    const root = workspace ?? await createDownloadWorkspace()
    const candidates = new Map<string, ExtensionCandidate>()
    const visiting = new Set<string>()
    try {
      async function visit(source: unknown, dependency?: { id: string; version: string }, depth = 0): Promise<void> {
        if (depth > 32 || candidates.size >= 100) throw new Error('Extension dependency limit exceeded')
        const candidate = snapshot && depth === 0 ? snapshot : await acquireExtension(parseDownloadSource(source), root)
        const { manifest } = candidate
        if (dependency && (manifest.id !== dependency.id || !satisfiesExtensionVersion(manifest.version, dependency.version))) throw new Error(`Downloaded dependency does not match ${dependency.id}@${dependency.version}`)
        if (visiting.has(manifest.id)) throw new Error(`Extension dependency cycle: ${manifest.id}`)
        const existingCandidate = candidates.get(manifest.id)
        if (existingCandidate) {
          if (existingCandidate.source?.url !== candidate.source?.url || existingCandidate.commit !== candidate.commit || existingCandidate.manifest.version !== manifest.version) throw new Error(`Conflicting dependency source: ${manifest.id}`)
          return
        }
        if (catalog.has(manifest.id) && manifest.id !== replacement) {
          const installed = catalog.get(manifest.id)!
          const origin = await readDownloadMetadata(installed.directory)
          if (depth !== 0 || sources.length !== 1 || replacement || !candidate.source || !origin
            || origin.source.kind !== candidate.source.kind || origin.source.url !== candidate.source.url) throw new Error(`Extension already exists with a different or local source: ${manifest.id}`)
          await assertClean(installed)
          replacement = manifest.id
        }
        visiting.add(manifest.id)
        for (const item of manifest.dependencies ?? []) {
          if (item.target === 'card') throw new Error('Global extension cannot depend on a Card installation')
          if (visiting.has(item.id)) throw new Error(`Extension dependency cycle: ${item.id}`)
          const known = candidates.get(item.id)
          const installed = catalog.get(item.id)
          const version = known?.manifest.version ?? installed?.manifest.version
          if (version) {
            if (installed && !installed.available) throw new Error(`Dependency is unavailable: ${item.id}`)
            if (!satisfiesExtensionVersion(version, item.version)) throw new Error(`Dependency version conflict: ${item.id}@${item.version}`)
            const origin = known ?? (installed ? await readDownloadMetadata(installed.directory) : undefined)
            if (origin?.source && item.source && origin.source.url !== parseDownloadSource(item.source).url) throw new Error(`Dependency source conflict: ${item.id}`)
            continue
          }
          if (!item.source) throw new Error(`Missing dependency ${item.id}; no download source declared`)
          await visit(item.source, item, depth + 1)
        }
        visiting.delete(manifest.id)
        candidates.set(manifest.id, candidate)
      }
      for (const source of sources) await visit(source)
      const complete = new Set<string>()
      const active = new Set<string>()
      function checkGraph(id: string) {
        if (active.has(id)) throw new Error(`Extension dependency cycle: ${id}`)
        if (complete.has(id)) return
        const manifest = candidates.get(id)?.manifest ?? catalog.get(id)?.manifest
        if (!manifest) throw new Error(`Missing dependency: ${id}`)
        active.add(id)
        for (const dependency of manifest.dependencies ?? []) {
          const resolved = candidates.get(dependency.id)?.manifest ?? catalog.get(dependency.id)?.manifest
          if (!resolved || !satisfiesExtensionVersion(resolved.version, dependency.version)) throw new Error(`Dependency version conflict: ${dependency.id}@${dependency.version}`)
          checkGraph(dependency.id)
        }
        active.delete(id)
        complete.add(id)
      }
      for (const id of candidates.keys()) checkGraph(id)
      if (replacement && !candidates.has(replacement)) throw new Error('Replacement Manifest ID does not match the installed extension')
      const token = randomUUID()
      const timer = setTimeout(() => {
        prepared.delete(token)
        void rm(root, { recursive: true, force: true }).catch(error => options.diagnostics.add({
          severity: 'error', code: 'extension.download_cleanup_failed', message: String(error), source: 'extension-manager',
        }))
      }, 10 * 60_000)
      timer.unref()
      prepared.set(token, { root, candidates: [...candidates.values()], replacement, expected, timer })
      return { token, packages: await Promise.all([...candidates.values()].map(async item => ({
        packageId: item.manifest.id, version: item.manifest.version, displayName: item.manifest.displayName, description: item.manifest.description, installedBytes: await packageBytes(item.directory),
        ...(item.source ? { source: { ...item.source } } : {}), ...(item.commit ? { commit: item.commit } : {}),
        replacing: item.manifest.id === replacement,
        modules: (item.manifest.modules ?? []).map(module => ({ id: module.id, runtime: module.runtime, capabilities: module.capabilities ?? {} })),
      }))) }
    } catch (error) {
      await rm(root, { recursive: true, force: true })
      throw error
    }
  }

  async function assertClean(record: PackageCatalogRecord): Promise<void> {
    const metadata = await readDownloadMetadata(record.directory)
    if (!metadata) {
      try {
        if (await readFile(join(record.directory, '.loom-zip-install'), 'utf8') === 'installed\n') return
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      throw new Error('Local development extensions are not remotely replaceable')
    }
    if (metadata.source.kind === 'git' && await extensionGit(['status', '--porcelain', '--untracked-files=all'], record.directory)) {
      throw new Error('Extension has local changes. Commit or resolve them before updating.')
    }
    if (metadata.source.kind === 'git' && await extensionGit(['rev-parse', 'HEAD'], record.directory) !== metadata.commit) throw new Error('Extension Git HEAD changed locally. Resolve it before updating.')
  }

  async function commitCandidate(candidate: ExtensionCandidate, replacing: boolean): Promise<void> {
    const id = candidate.manifest.id
    const previous = replacing ? requirePackage(catalog, id) : undefined
    if (previous) {
      if (!previous.available || previous.sources.length !== 1 || previous.sources[0]?.kind !== 'installed') throw new Error('Only a single installed source can be replaced')
      await assertClean(previous)
    } else if (catalog.has(id)) throw new Error(`Extension already exists: ${id}`)
    for (const [dependentId, dependent] of catalog) {
      const dependency = dependent.manifest.dependencies?.find(item => item.id === id)
      if (dependentId !== id && dependency && !satisfiesExtensionVersion(candidate.manifest.version, dependency.version)) throw new Error(`Update conflicts with dependency required by ${dependentId}: ${id}@${dependency.version}`)
    }
    await options.assertDependencyConsumers?.(id, { kind: 'global' }, candidate.manifest.version)
    const candidateRoot = join(options.installedDirectory, '.staging', randomUUID())
    const next = await installExtensionPackageFromDirectory({ sourceDirectory: candidate.directory, installedDirectory: candidateRoot, flat: true })
    const oldMetadata = previous ? await readDownloadMetadata(previous.directory) : undefined
    let stage = 'prepare'
    let codeCommitted = false
    let recovery: { recordPath: string; backupDirectory: string; historyDirectory: string } | undefined
    try {
      if (candidate.source?.kind === 'git') {
        await cp(join(candidate.directory, '.git'), join(next.directory, '.git'), { recursive: true })
        await extensionGit(['config', '--local', 'core.excludesFile', '.git/loom-excludes'], next.directory)
        await writeFile(join(next.directory, '.git', 'loom-excludes'), '.loom-source.json\n')
      }
      if (candidate.source) await writeFile(join(next.directory, '.loom-source.json'), JSON.stringify({
        source: candidate.source, ...(candidate.commit ? { commit: candidate.commit } : {}),
        ...(oldMetadata ? { previous: { source: oldMetadata.source, ...(oldMetadata.commit ? { commit: oldMetadata.commit } : {}) } } : {}),
      }))
      else await writeFile(join(next.directory, '.loom-zip-install'), 'installed\n')
      const destination = previous?.directory ?? join(options.installedDirectory, id)
      const historyRoot = join(options.installedDirectory, '.history')
      await mkdir(historyRoot, { recursive: true })
      const backup = join(historyRoot, `${id}-${randomUUID()}`)
      const desired = new Map((previous?.manifest.modules ?? []).map(module => [module.id, readDesiredState(options.stateStore, id, module.id)]))
      let backedUp = false
      let replacementInstalled = false
      const disposed = new Set<string>()
      try {
        if (previous) {
          stage = 'save-recovery'
          recovery = { recordPath: `${backup}.recovery.json`, backupDirectory: backup, historyDirectory: join(historyRoot, id) }
          await writeJsonAtomically(recovery.recordPath, {
            version: 1, packageId: id, fromVersion: previous.manifest.version, toVersion: candidate.manifest.version,
            destination, ...recovery, desired: Object.fromEntries(desired),
          })
          stage = 'disable-old-modules'
          for (const module of previous.manifest.modules ?? []) {
            const state = desired.get(module.id)!
            await options.stateStore.set(id, module.id, { ...state, enabled: false })
          }
          stage = 'dispose-old-modules'
          for (const module of serverModules(previous.manifest)) {
            disposed.add(module.id)
            await options.host.dispose(id, module.id)
          }
          stage = 'backup-old-code'
          await rename(previous.directory, backup)
          backedUp = true
        }
        stage = 'replace-code'
        await rename(next.directory, destination)
        replacementInstalled = true
        await options.host.discover(destination)
      } catch (error) {
        const failedStage = stage
        const errors: unknown[] = [error]
        let recoveryStage = 'restore-old-code'
        const recoveryFailures: string[] = []
        try {
          if (replacementInstalled) await rm(destination, { recursive: true, force: true })
          if (backedUp) {
            await rename(backup, destination)
            await options.host.discover(destination)
          }
        } catch (restoreError) { errors.push(restoreError); recoveryFailures.push(recoveryStage) }
        if (previous && stage !== 'save-recovery') {
          recoveryStage = 'restore-old-desired'
          for (const [moduleId, state] of desired) {
            try { await options.stateStore.set(id, moduleId, state) }
            catch (restoreError) { errors.push(restoreError); recoveryFailures.push(recoveryStage) }
          }
          if (errors.length === 1) {
            recoveryStage = 'reactivate-old-modules'
            for (const module of serverModules(previous.manifest)) {
              if (!disposed.has(module.id) || !desired.get(module.id)?.enabled) continue
              try {
                // dispose may reject after cleanup; an instance still live must not be activated twice.
                const current = findRuntime(options.host, id, module.id)
                if (current?.instance && ['active', 'degraded'].includes(current.instance.state)) continue
                await options.host.activate(id, module.id)
              } catch (restoreError) { errors.push(restoreError); recoveryFailures.push(recoveryStage) }
            }
          }
        }
        if (errors.length > 1) {
          try {
            if (recovery) await writeJsonAtomically(recovery.recordPath, {
              version: 1, packageId: id, fromVersion: previous?.manifest.version, toVersion: candidate.manifest.version,
              destination, ...recovery, desired: Object.fromEntries(desired), failedStage, recoveryStage: recoveryFailures[0], recoveryFailures,
              errors: errors.map(item => serializeError(item)),
            })
          } catch (recordError) { errors.push(recordError) }
          throw new AggregateError(errors, `${failedStage} failed; recovery incomplete at ${recoveryFailures.join(', ')}: ${errors.map(item => item instanceof Error ? item.message : String(item)).join('; ')}`, { cause: error })
        }
        throw error
      }
      const record: PackageCatalogRecord = {
        manifest: candidate.manifest, directory: destination,
        fileRevision: `${candidate.manifest.version}-${randomUUID()}`,
        sources: [{ kind: 'installed', directory: destination }], available: true,
        ...(candidate.source ? { remote: { source: candidate.source, ...(candidate.commit ? { commit: candidate.commit } : {}), canRollback: !!previous } } : {}),
      }
      catalog.set(id, record)
      codeCommitted = true
      if (previous) {
        stage = 'save-history'
        const saved = join(historyRoot, id)
        await rm(saved, { recursive: true, force: true })
        await rename(backup, saved)
        stage = 'forget-removed-modules'
        for (const module of serverModules(previous.manifest)) {
          if (!serverModules(candidate.manifest).some(next => next.id === module.id)) await options.host.forget(id, module.id)
        }
        for (const module of candidate.manifest.modules ?? []) {
          const oldModule = previous.manifest.modules?.find(item => item.id === module.id)
          const state = desired.get(module.id)
          if (state && oldModule?.runtime === module.runtime && isDeepStrictEqual(oldModule.capabilities ?? {}, module.capabilities ?? {})) {
            stage = 'restore-module-state'
            await options.stateStore.set(id, module.id, state)
            stage = 'activate-modules'
            if (state.enabled && module.runtime === 'server') await options.host.activate(id, module.id)
          }
        }
        stage = 'remove-recovery-record'
        await rm(recovery!.recordPath)
      }
    } catch (error) {
      throw new ExtensionInstallFailure(stage, codeCommitted, recovery, error)
    } finally {
      try {
        await rm(candidateRoot, { recursive: true, force: true })
      } catch (error) {
        options.diagnostics.add({
          severity: 'error', code: 'extension.install_cleanup_failed', source: 'extension-manager',
          packageId: id, message: String(error), details: { directory: candidateRoot },
        })
      }
    }
  }

  function packageRecord(packageId: string, target?: ExtensionInstallationTarget): PackageCatalogRecord {
    if (target?.kind !== 'card') return requirePackage(catalog, packageId)
    const entry = cardCatalog.get(extensionInstallationId(packageId, target))
    if (!entry) throw new Error(`Card extension package is not installed: ${packageId}`)
    return entry.record
  }

  async function prepareCardPackage(input: { cardId: string; packageId: string; source?: 'installed'; expectedCardVersion?: number }): Promise<PackageCatalogRecord> {
    const source = await options.readCardPackage(input)
    if (input.expectedCardVersion !== undefined && source.cardVersion !== input.expectedCardVersion) throw new Error('Card archive changed before package installation')
    const bytes = Buffer.from(source.archive.archiveBase64, 'base64')
    const digest = createHash('sha256').update(bytes).digest('hex')
    const root = resolve(options.installedDirectory, '.card-installed', digest)
    // The digest directory is outside global discovery and is shared only as immutable package bytes.
    const directory = resolve(root, source.archive.packageId, source.archive.version)
    if (relative(root, directory).startsWith('..') || directory === root) throw new Error('Invalid Card package archive identity')
    let record: PackageCatalogRecord
    try {
      const manifest = parseExtensionManifest(JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')))
      record = { manifest, directory, sources: [], available: true }
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      record = { ...await installExtensionPackageFromZip({ source: bytes, installedDirectory: root }), sources: [], available: true }
    }
    if (record.manifest.id !== source.archive.packageId || record.manifest.version !== source.archive.version) throw new Error('Embedded extension manifest identity does not match its Card reference')
    record.archiveDigest = digest
    return record
  }

  async function discoverCardPackage(cardId: string, packageId: string): Promise<PackageCatalogRecord> {
    const target = { kind: 'card' as const, cardId }
    const record = await prepareCardPackage({ cardId, packageId, source: 'installed' })
    await options.host.discover(record.directory, target)
    cardCatalog.set(extensionInstallationId(packageId, target), { target, record })
    return record
  }

  async function stopCardPackage(record: PackageCatalogRecord, target: Extract<ExtensionInstallationTarget, { kind: 'card' }>): Promise<void> {
    const packageId = record.manifest.id
    for (const module of record.manifest.modules ?? []) {
      const desired = readDesiredState(options.stateStore, packageId, module.id, target)
      if (desired.enabled) await options.stateStore.set(packageId, module.id, { ...desired, enabled: false }, target)
    }
    const errors: unknown[] = []
    for (const module of serverModules(record.manifest)) {
      try { await options.host.dispose(packageId, module.id, target) } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, `Card extension cleanup incomplete: ${packageId}; modules disabled, installation retained`)
  }

  async function forgetCardPackage(record: PackageCatalogRecord, target: Extract<ExtensionInstallationTarget, { kind: 'card' }>): Promise<void> {
    for (const module of serverModules(record.manifest)) await options.host.forget(record.manifest.id, module.id, target)
    await options.stateStore.deletePackage(record.manifest.id, target)
    cardCatalog.delete(extensionInstallationId(record.manifest.id, target))
  }

  async function validateDependencies(manifest: ExtensionManifest, target: ExtensionInstallationTarget = { kind: 'global' }, explicitOnly = false): Promise<void> {
    const installations = (await options.listInstallations()).installations
    for (const dependency of manifest.dependencies ?? []) {
      if (explicitOnly && !dependency.target) continue
      if (dependency.target === 'card' && target.kind !== 'card') throw new Error('Global extension cannot depend on a Card installation')
      const selected = dependency.target === 'card' ? target : { kind: 'global' as const }
      const record = selected.kind === 'global' ? catalog.get(dependency.id) : cardCatalog.get(extensionInstallationId(dependency.id, selected))?.record
      if (!record?.available || !satisfiesExtensionVersion(record.manifest.version, dependency.version)) {
        throw new Error(`Dependency ${dependency.id}@${dependency.version} is missing or incompatible in ${selected.kind}`)
      }
      if (dependency.target && !installations.some(item => item.id === extensionInstallationId(dependency.id, selected)
        && satisfiesExtensionVersion(item.packageVersion, dependency.version))) {
        throw new Error(`Dependency resources are not installed: ${dependency.id} (${selected.kind})`)
      }
    }
  }

  async function restoreModule(record: PackageCatalogRecord, moduleId: string, target: ExtensionInstallationTarget): Promise<void> {
    try {
      await validateDependencies(record.manifest, target)
    } catch (error) {
      options.diagnostics.add({ severity: 'error', code: 'extension.dependency_unavailable', source: 'extension-manager',
        packageId: record.manifest.id, message: `Extension dependency unavailable: ${record.manifest.id}`,
        details: { target, error: serializeError(error, 'extension.dependency_unavailable') } })
      return
    }
    await options.host.activate(record.manifest.id, moduleId, target)
  }

  type ResourceUpdate = { expectedInstallationVersion: number; packageVersion: string; expectedPreviewFingerprint?: string; keepPromptResourceIds?: string[] }
  type CardResourceSource = { record: PackageCatalogRecord; cardId: string; expectedCardVersion: number }
  function importResources(packageId: string, update?: ResourceUpdate, cardSource?: CardResourceSource, beforeCommit?: () => Promise<void>): Promise<ImportedExtensionPackageResources>
  function importResources(packageId: string, update: ResourceUpdate, cardSource: CardResourceSource | undefined, preview: true): Promise<import('@loom-studio/application-runtime').PreviewExtensionPackageResourcesResult>
  async function importResources(
    packageId: string,
    update?: ResourceUpdate,
    cardSource?: CardResourceSource,
    mode?: true | (() => Promise<void>),
  ): Promise<ImportedExtensionPackageResources | import('@loom-studio/application-runtime').PreviewExtensionPackageResourcesResult> {
    assertInitialized(initialized)
    const record = cardSource?.record ?? requireAvailablePackage(catalog, packageId)
    if (update && record.manifest.version !== update.packageVersion) throw new Error('Extension package changed; review the update again')
    const target: ExtensionInstallationTarget = cardSource ? { kind: 'card', cardId: cardSource.cardId } : { kind: 'global' }
    await validateDependencies(record.manifest, target, true)
    const promptResources = await Promise.all((record.manifest.contributes?.promptResources ?? []).map(async contribution => {
      const artifact = await loadPromptResourceFiles(await readPackageJson(record, contribution.source),
        async path => (await readFileFromPackage(record, posix.join(posix.dirname(contribution.source), path))).bytes)
      if (artifact && typeof artifact === 'object' && !Array.isArray(artifact) && artifact.metadata) {
        const { icon } = promptResourceDisplayMetadataSchema.parse(artifact.metadata)
        if (icon?.packageId === packageId) await readFileFromPackage(record, icon.path)
      }
      return { contribution, artifact }
    }))
    const assetKey = assetSourceKey(packageId, target, record.manifest.version)
    importingAssetSources.set(assetKey, record)
    try {
      const payload: Parameters<typeof options.importPackageResources>[0] = {
        packageId,
        packageVersion: record.manifest.version,
        ...(record.manifest.dependencies ? { dependencies: structuredClone(record.manifest.dependencies) } : {}),
        ...(record.manifest.participation ? { participation: record.manifest.participation } : {}),
        source: cardSource ? { kind: 'card' }
          : record.remote ? { kind: record.remote.source.kind, url: record.remote.source.url }
            : { kind: 'local', directory: record.directory },
        loomScripts: await Promise.all((record.manifest.contributes?.loomScripts ?? []).map(async contribution => ({
          contribution, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode((await readFileFromPackage(record, contribution.source)).bytes),
        }))),
        ...(cardSource ? { target: { kind: 'card' as const, cardId: cardSource.cardId }, expectedCardVersion: cardSource.expectedCardVersion } : {}),
        ...(update ? { update: { expectedInstallationVersion: update.expectedInstallationVersion, expectedPreviewFingerprint: update.expectedPreviewFingerprint, keepPromptResourceIds: update.keepPromptResourceIds } } : {}),
        promptResources,
        agentTools: await Promise.all((record.manifest.contributes?.agentTools ?? []).map(async contribution => ({
          contribution, definition: await readPackageJson(record, contribution.source),
        }))),
        transformRules: await Promise.all((record.manifest.contributes?.transformRules ?? []).map(async contribution => ({
          contribution, artifact: await readPackageJson(record, contribution.source),
        }))),
        textExtractors: await Promise.all((record.manifest.contributes?.textExtractors ?? []).map(async contribution => ({
          contribution, artifact: await readPackageJson(record, contribution.source),
        }))),
      }
      if (mode === true) return await options.previewPackageResources({ ...payload, update: payload.update! })
      if (mode) {
        if (payload.update?.expectedPreviewFingerprint) {
          const reviewed = await options.previewPackageResources({ ...payload, update: payload.update })
          if (reviewed.fingerprint !== payload.update.expectedPreviewFingerprint) {
            throw new Error('Extension resources changed; preview the package update again')
          }
        }
        await mode()
      }
      try {
        const imported = await options.importPackageResources(payload)
        return { packageId, version: record.manifest.version, ...imported }
      } catch (error) {
        if (!mode) throw error
        throw new Error(`Card package update failed; old modules remain stopped: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
    } finally { importingAssetSources.delete(assetKey) }
  }

  async function importNewGlobalResources(packageId: string): Promise<void> {
    requireAvailablePackage(catalog, packageId)
    // Asset-only packages also need an installation identity for dependency and scope checks.
    const { installations } = await options.listInstallations()
    if (installations.some(item => item.packageId === packageId && item.target.kind === 'global')) return
    try {
      await importResources(packageId)
    } catch (error) {
      throw new ExtensionInstallFailure('import-resources', true, undefined, error)
    }
  }
  async function finishLocalPackageInstall(installed: InstalledExtensionPackage, zip: boolean): Promise<ManagedExtensionPackage> {
    try {
      await validateDependencies(installed.manifest)
      if (zip) await writeFile(join(installed.directory, '.loom-zip-install'), 'installed\n')
      if (catalog.has(installed.manifest.id)) {
        throw new Error(`Extension Package source already exists: ${installed.manifest.id}`)
      }
      await options.host.discover(installed.directory)
      const record: PackageCatalogRecord = {
        manifest: installed.manifest,
        sources: [{ kind: 'installed', directory: installed.directory }],
        directory: installed.directory,
        available: true,
      }
      catalog.set(installed.manifest.id, record)
      for (const moduleManifest of serverModules(installed.manifest)) {
        if (!options.stateStore.get(installed.manifest.id, moduleManifest.id)?.enabled) continue
        await options.host.activate(installed.manifest.id, moduleManifest.id)
      }
    } catch (error) {
      await uninstallExtensionPackageDirectory({
        directory: installed.directory,
        installedDirectory: options.installedDirectory,
        flat: true,
      }).catch(() => undefined)
      throw error
    }
    await importNewGlobalResources(installed.manifest.id)
    return toManagedPackage(installed.manifest.id, requireAvailablePackage(catalog, installed.manifest.id), options.stateStore, globalRuntimes(options.host))
  }

  async function enableModule(packageId: string, moduleId: string, requestedGrants?: import('@loom-studio/kernel').ExtensionModuleCapabilityGrants, target?: ExtensionInstallationTarget): Promise<ManagedExtensionModule> {
    assertInitialized(initialized)
    const record = packageRecord(packageId, target)
    if (!record.available) throw new Error(`Extension package is unavailable: ${packageId}`)
    await validateDependencies(record.manifest, target)
    const moduleManifest = requireModule(record.manifest, moduleId)
    if (target?.kind === 'card') await options.readCardPackage({ cardId: target.cardId, packageId, source: 'installed' })
    const previous = readDesiredState(options.stateStore, packageId, moduleId, target)
    const eventGrants = requestedGrants?.eventCapabilities === undefined
      ? previous.grantedEventCapabilities
      : validateEventGrants(packageId, moduleManifest, requestedGrants.eventCapabilities)
    const assetGrants = requestedGrants?.assetCapabilities === undefined
      ? previous.grantedAssetCapabilities
      : validateAssetGrants(packageId, moduleManifest, requestedGrants.assetCapabilities)
    const uiGrants = requestedGrants?.uiCapabilities ?? previous.grantedUiCapabilities ?? []
    if (uiGrants.some(grant => grant !== 'ui.notify' || (moduleManifest.runtime !== 'client' && moduleManifest.runtime !== 'client-worker') || moduleManifest.capabilities?.[grant] !== true)) {
      throw new Error(`Extension module ${moduleKey(packageId, moduleId)} did not request a supported UI capability`)
    }
    const desired = await options.stateStore.set(packageId, moduleId, {
      enabled: true,
      grantedEventCapabilities: eventGrants,
      grantedAssetCapabilities: assetGrants,
      grantedUiCapabilities: uiGrants,
    }, target)

    let runtime: ExtensionModuleSummary | undefined
    if (moduleManifest.runtime === 'server') {
      const current = findRuntime(options.host, packageId, moduleId, target)
      if (current?.instance && (current.instance.state === 'active' || current.instance.state === 'degraded')) {
        if (sameCapabilities(previous.grantedEventCapabilities, eventGrants)
          && sameCapabilities(previous.grantedAssetCapabilities, assetGrants)) {
          runtime = current
        } else {
          runtime = await options.host.reload(packageId, moduleId, target)
          moduleReloadIds(record)[moduleId] = randomUUID()
        }
      } else {
        runtime = await options.host.activate(packageId, moduleId, target)
      }
    }
    return toManagedModule(packageId, record, moduleManifest, desired, runtime, target)

  }
  async function disableModule(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<ManagedExtensionModule> {
    assertInitialized(initialized)
    const record = packageRecord(packageId, target)
    const moduleManifest = requireModule(record.manifest, moduleId)
    const previous = readDesiredState(options.stateStore, packageId, moduleId, target)
    const desired = await options.stateStore.set(packageId, moduleId, {
      enabled: false,
      grantedEventCapabilities: previous.grantedEventCapabilities,
      grantedAssetCapabilities: previous.grantedAssetCapabilities,
      grantedUiCapabilities: previous.grantedUiCapabilities ?? [],
    }, target)
    if (moduleManifest.runtime === 'server') await options.host.dispose(packageId, moduleId, target)
    return toManagedModule(packageId, record, moduleManifest, desired, findRuntime(options.host, packageId, moduleId, target), target)

  }
  const moduleBatches = new Map<string, import('@loom-studio/kernel').ExtensionModuleBatchResult>()
  let operationQueue = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    previewPackageResources: input => serialize(async () => {
      if (input.target?.kind === 'card') {
        if (input.expectedCardVersion === undefined) throw new Error('Card resource preview requires expectedCardVersion')
        const cardId = input.target.cardId
        const record = await prepareCardPackage({ cardId, packageId: input.packageId, expectedCardVersion: input.expectedCardVersion })
        return importResources(input.packageId, input, { record, cardId, expectedCardVersion: input.expectedCardVersion }, true)
      }
      return importResources(input.packageId, input, undefined, true)
    }),
    listRecoveryRecords: () => listExtensionRecoveryRecords(options.installedDirectory),
    listModuleBatches: () => ({ batches: structuredClone([...moduleBatches.values()]) }),
    getModuleBatch: batchId => {
      const batch = moduleBatches.get(batchId)
      if (!batch) throw new Error(`Extension module batch not found: ${batchId}`)
      return structuredClone(batch)
    },
    startModuleBatch: async input => {
      assertInitialized(initialized)
      packageRecord(input.packageId, input.target)
      const ids = input.modules.map(item => item.moduleId)
      if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some(id => !id)) throw new Error('Extension module batch requires unique module IDs')
      const request = structuredClone(input)
      const batch: import('@loom-studio/kernel').ExtensionModuleBatchResult = {
        batchId: randomUUID(), packageId: input.packageId, target: input.target ?? { kind: 'global' }, enabled: input.enabled, state: 'queued', results: [],
      }
      moduleBatches.set(batch.batchId, batch)
      void serialize(async () => {
        batch.state = 'running'
        for (const item of request.modules) {
          try {
            const previous = readDesiredState(options.stateStore, request.packageId, item.moduleId, request.target)
            const record = packageRecord(request.packageId, request.target)
            const module = requireModule(record.manifest, item.moduleId)
            const current = findRuntime(options.host, request.packageId, item.moduleId, request.target)
            const active = current?.instance?.state === 'active' || current?.instance?.state === 'degraded'
            const grantsUnchanged = !item.grants || (
              (item.grants.eventCapabilities === undefined || sameCapabilities(previous.grantedEventCapabilities, item.grants.eventCapabilities))
              && (item.grants.assetCapabilities === undefined || sameCapabilities(previous.grantedAssetCapabilities, item.grants.assetCapabilities))
              && (item.grants.uiCapabilities === undefined || sameCapabilities(previous.grantedUiCapabilities ?? [], item.grants.uiCapabilities)))
            const unchanged = previous.enabled === request.enabled && grantsUnchanged
              && (module.runtime !== 'server' || (request.enabled ? active : !current?.instance))
            if (unchanged) {
              batch.results.push({ moduleId: item.moduleId, status: 'unchanged' })
              continue
            }
            if (request.enabled) await enableModule(request.packageId, item.moduleId, item.grants, request.target)
            else await disableModule(request.packageId, item.moduleId, request.target)
            batch.results.push({ moduleId: item.moduleId, status: unchanged ? 'unchanged' : 'completed' })
          } catch (error) {
            batch.results.push({ moduleId: item.moduleId, status: 'failed', message: error instanceof Error ? error.message : String(error) })
          }
        }
        batch.state = 'completed'
        const completed = [...moduleBatches.values()].filter(item => item.state === 'completed')
        for (const old of completed.slice(0, Math.max(0, completed.length - 100))) moduleBatches.delete(old.batchId)
        try { options.onModuleBatchCompleted?.(structuredClone(batch)) }
        catch (error) {
          options.diagnostics.add({ severity: 'error', code: 'extension.batch_notification_failed', source: 'extension-manager', packageId: batch.packageId,
            message: `Extension module batch completion notification failed: ${batch.batchId}`, details: { error: serializeError(error) } })
        }
      })
      return { batchId: batch.batchId }
    },
    previewPackageZip: source => withPreparationSlot(async () => {
      assertInitialized(initialized)
      const root = await createDownloadWorkspace()
      try {
        const installed = await installExtensionPackageFromZip({ source, installedDirectory: root })
        let replacement: string | undefined
        const current = catalog.get(installed.manifest.id)
        if (current) {
          const origin = await readDownloadMetadata(current.directory)
          if (origin?.source.kind === 'git') throw new Error('Git extension source conflicts with this ZIP. Uninstall the Git source before replacing it.')
          await assertClean(current)
          replacement = installed.manifest.id
        }
        return await prepareSources([undefined], replacement, installed, root)
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
    }),
    officialSetup: async () => {
      if (!options.officialSetupFile) throw new Error('Official selection state is unavailable')
      const completed = (await readOfficialState()).completed === true
      return {
        completed,
        items: await Promise.all([
          { id: 'official.loom-assistant', name: '诺姆助手', source: { kind: 'git' as const, url: 'https://github.com/The-LoomStudio/LS_Nom_Assistant.git' } },
          { id: 'official.backgrounds', name: '官方背景', source: { kind: 'git' as const, url: 'https://github.com/The-LoomStudio/LS_Background.git' } },
          { id: 'sillytavern.importer', name: 'ST 数据导入', source: { kind: 'git' as const, url: 'https://github.com/The-LoomStudio/LS_STBridge.git' } },
          { id: 'official.the-world', name: 'The World', source: { kind: 'git' as const, url: 'https://github.com/The-LoomStudio/LS_The_World.git' } },
        ].map(async item => {
          const installed = catalog.get(item.id)
          try {
            const manifest = installed?.manifest ?? parseExtensionManifest(JSON.parse(Buffer.from(await downloadExtensionZip({
              kind: 'zip', url: item.source.url.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace(/\.git$/, '/HEAD/manifest.json'),
            }, 0, { maxBytes: 1024 * 1024, timeoutMs: 8_000 })).toString('utf8')))
            if (manifest.id !== item.id) throw new Error('Manifest ID mismatch')
            return { ...item, name: manifest.displayName, description: manifest.description,
              ...(installed ? { installedVersion: installed.manifest.version } : {}) }
          } catch {
            return { ...item, metadataError: '无法读取扩展说明，请稍后重试',
              ...(installed ? { installedVersion: installed.manifest.version } : {}) }
          }
        })),
      }
    },
    finishOfficialSetup: () => serialize(async () => {
      if (!options.officialSetupFile) throw new Error('Official selection state is unavailable')
      await writeJsonAtomically(options.officialSetupFile, { ...await readOfficialState(), completed: true })
      return { completed: true }
    }),
    previewRemoteInstall: input => withPreparationSlot(async () => {
      assertInitialized(initialized)
      if (!input || typeof input !== 'object' || !Array.isArray((input as { sources?: unknown }).sources)) throw new Error('Download sources are required')
      return prepareSources((input as { sources: unknown[] }).sources)
    }),
    checkRemoteUpdate: async packageId => {
      assertInitialized(initialized)
      const record = requirePackage(catalog, packageId)
      const metadata = await readDownloadMetadata(record.directory)
      if (!metadata) throw new Error('This extension has no managed remote source')
      return checkGitUpdate(metadata)
    },
    previewRemoteChange: input => withPreparationSlot(async () => {
      assertInitialized(initialized)
      if (!input || typeof input !== 'object') throw new Error('Extension change is required')
      const value = input as { packageId?: unknown; ref?: unknown; rollback?: unknown }
      if (typeof value.packageId !== 'string') throw new Error('Package ID is required')
      const record = requirePackage(catalog, value.packageId)
      await assertClean(record)
      const metadata = (await readDownloadMetadata(record.directory))!
      const selected = value.rollback === true ? metadata.previous : metadata
      if (!selected || selected.source.kind !== 'git') throw new Error('No previous Git version available')
      if (value.rollback === true) {
        const snapshot = await readDownloadMetadata(join(options.installedDirectory, '.history', value.packageId))
        if (!snapshot || snapshot.manifest.id !== value.packageId) throw new Error('Previous code snapshot is unavailable')
        return prepareSources([snapshot.source], value.packageId, snapshot)
      }
      const source = value.rollback === true
        ? { ...selected.source, ref: selected.commit }
        : { ...selected.source, ...(value.ref !== undefined ? { ref: value.ref } : {}) }
      return prepareSources([source], value.packageId)
    }),
    commitRemoteInstall: token => serialize(async (): Promise<import('@loom-studio/kernel').RemoteInstallResult> => {
      const batch = prepared.get(token)
      if (!batch) throw new Error('Install preview expired. Prepare the download again.')
      prepared.delete(token)
      clearTimeout(batch.timer)
      const installed: Array<{ packageId: string; version: string }> = []
      try {
        if (batch.expected !== catalogFingerprint()) throw new Error('Installed extensions changed; review the download again')
        for (const candidate of batch.candidates) {
          try {
            await commitCandidate(candidate, candidate.manifest.id === batch.replacement)
            installed.push({ packageId: candidate.manifest.id, version: candidate.manifest.version })
            await importNewGlobalResources(candidate.manifest.id)
          } catch (error) {
            if (error instanceof ExtensionInstallFailure && error.codeCommitted && !installed.some(item => item.packageId === candidate.manifest.id)) {
              installed.push({ packageId: candidate.manifest.id, version: candidate.manifest.version })
            }
            return { installed, failed: {
              packageId: candidate.manifest.id, message: error instanceof Error ? error.message : String(error),
              ...(error instanceof ExtensionInstallFailure ? {
                stage: error.stage, codeCommitted: error.codeCommitted,
                ...(error.recovery ? { recovery: error.recovery } : {}),
              } : {}),
            } }
          }
        }
        return { installed }
      } finally {
        await rm(batch.root, { recursive: true, force: true })
      }
    }),
    withCardDeletions: (cardIds, commit) => serialize(async () => {
      const entries = [...cardCatalog.values()].filter(entry => cardIds.includes(entry.target.cardId))
      for (const { record, target } of entries) await stopCardPackage(record, target)
      const result = await commit()
      for (const { record, target } of entries) await forgetCardPackage(record, target)
      return result
    }),
    initialize: () => serialize(async () => {
      if (initialized) return
      await options.stateStore.load()
      const setup = await readOfficialState()
      const bundled = new Map<string, ReturnType<typeof parseExtensionManifest>>()
      for (const directory of options.bundledDirectories ?? []) {
        try {
          const manifest = parseExtensionManifest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
          if (setup.bundled?.includes(manifest.id)) continue
          bundled.set(directory, manifest)
        } catch (error) {
          reportDiscoveryFailure(options.diagnostics, { kind: 'repository', directory }, error)
        }
      }
      const result = await discoverExtensionSources(options)
      for (const failure of result.failures) reportDiscoveryFailure(options.diagnostics, failure.source, failure.error)

      for (const [packageId, sources] of groupSources(result.discovered)) {
        const uniqueDirectories = [...new Set(sources.map(source => source.directory))]
        const manifest = sources[0]!.manifest
        if (uniqueDirectories.length > 1) {
          catalog.set(packageId, {
            manifest,
            sources: sources.map(toSource),
            directory: uniqueDirectories[0] ?? '',
            available: false,
          })
          options.diagnostics.add({
            severity: 'error',
            code: 'extension.package_source_conflict',
            message: `Extension package ${packageId} was discovered in multiple directories`,
            source: 'extension-manager',
            packageId,
            extensionId: packageId,
            details: { directories: uniqueDirectories },
          })
          continue
        }

        const record: PackageCatalogRecord = {
          manifest,
          sources: sources.map(toSource),
          directory: uniqueDirectories[0]!,
          available: true,
        }
        catalog.set(packageId, record)
        try {
          const metadata = await readDownloadMetadata(record.directory)
          if (metadata) {
            record.remote = { source: metadata.source, ...(metadata.commit ? { commit: metadata.commit } : {}), canRollback: !!metadata.previous }
            record.fileRevision = `${manifest.version}-${randomUUID()}`
          }
          if (record.sources.some(source => source.kind === 'repository')) record.fileRevision = `${manifest.version}-${randomUUID()}`
          await options.host.discover(record.directory)
        } catch (error) {
          record.available = false
          options.diagnostics.add({
            severity: 'error',
            code: 'extension.package_discovery_failed',
            message: `Extension package ${packageId} could not be registered with the host`,
            source: 'extension-manager',
            packageId,
            extensionId: packageId,
            details: { error: serializeError(error, 'extension.package_discovery_failed') },
          })
        }
      }

      initialized = true
      const installations = await options.listInstallations()
      for (const [directory, manifest] of bundled) {
        try {
          if (!installations.installations.some(item => item.packageId === manifest.id && item.target.kind === 'global')) await importResources(manifest.id)
          for (const moduleId of options.bundledEnabledModules?.[manifest.id] ?? []) {
            requireModule(manifest, moduleId)
            if (options.stateStore.get(manifest.id, moduleId)) continue
            await options.stateStore.set(manifest.id, moduleId, {
              enabled: true, grantedEventCapabilities: [], grantedAssetCapabilities: [], grantedUiCapabilities: [],
            })
          }
          if (options.officialSetupFile) {
            const next = { ...setup, bundled: [...setup.bundled ?? [], manifest.id] }
            await writeJsonAtomically(options.officialSetupFile, next)
            setup.bundled = next.bundled
          }
        } catch (error) {
          const record = catalog.get(manifest.id)
          if (record) record.available = false
          options.diagnostics.add({
            severity: 'error', code: 'extension.bundled_setup_failed',
            message: `Bundled extension setup failed: ${manifest.id}`,
            source: 'extension-manager', packageId: manifest.id,
            details: { directory, error: serializeError(error, 'extension.bundled_setup_failed') },
          })
        }
      }
      for (const installation of (await options.listInstallations()).installations) {
        if (installation.target.kind !== 'card' || !installation.archiveBlobId) continue
        try {
          await discoverCardPackage(installation.target.cardId, installation.packageId)
        } catch (error) {
          options.diagnostics.add({
            severity: 'error', code: 'extension.card_package_discovery_failed',
            message: `Card extension package could not be restored: ${installation.packageId}`,
            source: 'extension-manager', packageId: installation.packageId,
            details: { installationId: installation.id, error: serializeError(error, 'extension.card_package_discovery_failed') },
          })
        }
      }
      for (const [packageId, record] of [...catalog.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        if (!record.available) continue
        for (const moduleManifest of serverModules(record.manifest)) {
          if (!options.stateStore.get(packageId, moduleManifest.id)?.enabled) continue
          await restoreModule(record, moduleManifest.id, { kind: 'global' })
        }
      }
      for (const { record, target } of cardCatalog.values()) {
        for (const moduleManifest of serverModules(record.manifest)) {
          if (options.stateStore.get(record.manifest.id, moduleManifest.id, target)?.enabled) {
            await restoreModule(record, moduleManifest.id, target)
          }
        }
      }
    }),

    listPackages: target => {
      assertInitialized(initialized)
      if (target?.kind === 'card') {
        return [...cardCatalog.values()].filter(entry => entry.target.cardId === target.cardId)
          .map(({ record }) => toManagedPackage(record.manifest.id, record, options.stateStore, installedRuntimes(options.host, target), target))
      }
      const runtimeByKey = globalRuntimes(options.host)
      return [...catalog.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([packageId, record]) => toManagedPackage(packageId, record, options.stateStore, runtimeByKey))
    },

    installCardPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const target = { kind: 'card' as const, cardId: input.cardId }
      const record = await prepareCardPackage(input)
      await importResources(input.packageId, undefined, { ...input, record })
      const existing = cardCatalog.get(extensionInstallationId(input.packageId, target))
      if (!existing) await discoverCardPackage(input.cardId, input.packageId)
      return toManagedPackage(input.packageId, packageRecord(input.packageId, target), options.stateStore, installedRuntimes(options.host, target), target)
    }),

    updateCardPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const target = { kind: 'card' as const, cardId: input.cardId }
      const previous = packageRecord(input.packageId, target)
      const installations = (await options.listInstallations()).installations
      const installation = installations.find(item => item.id === extensionInstallationId(input.packageId, target))
      if (installation?.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before update')
      const next = await prepareCardPackage(input)
      if (next.manifest.version !== input.packageVersion) throw new Error('Extension package changed; review the update again')
      assertCardDependentsCompatible(installations, input.packageId, target.cardId, next.manifest.version)
      const previousStates = new Map((previous.manifest.modules ?? []).map(module => [
        module.id, { module, desired: readDesiredState(options.stateStore, input.packageId, module.id, target) },
      ]))
      await importResources(input.packageId, {
        expectedInstallationVersion: input.expectedInstallationVersion, packageVersion: input.packageVersion, expectedPreviewFingerprint: input.expectedPreviewFingerprint, keepPromptResourceIds: input.keepPromptResourceIds,
      }, { ...input, record: next }, () => stopCardPackage(previous, target))
      // The archive/resources are committed now. A restart failure must not roll them back or resume old code.
      try {
        await forgetCardPackage(previous, target)
        const record = await discoverCardPackage(input.cardId, input.packageId)
        for (const module of record.manifest.modules ?? []) {
          const old = previousStates.get(module.id)
          if (!old || old.module.runtime !== module.runtime) continue
          const desired = await options.stateStore.set(input.packageId, module.id, {
            enabled: old.desired.enabled
              && isDeepStrictEqual(old.module.capabilities ?? {}, module.capabilities ?? {}),
            grantedEventCapabilities: old.desired.grantedEventCapabilities.filter(grant => module.capabilities?.['events.subscribe']?.includes(grant)),
            grantedAssetCapabilities: old.desired.grantedAssetCapabilities.filter(grant => module.capabilities?.[grant] === true),
            grantedUiCapabilities: module.capabilities?.['ui.notify'] === true ? old.desired.grantedUiCapabilities ?? [] : [],
          }, target)
          if (desired.enabled && module.runtime === 'server') await options.host.activate(input.packageId, module.id, target)
        }
        return toManagedPackage(input.packageId, record, options.stateStore, installedRuntimes(options.host, target), target)
      } catch (error) {
        throw new Error(`Card package ${input.packageId}@${input.packageVersion} was updated, but module recovery failed; resources were not rolled back`, { cause: error })
      }
    }),

    uninstallCardPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const target = { kind: 'card' as const, cardId: input.cardId }
      const record = packageRecord(input.packageId, target)
      const installations = (await options.listInstallations()).installations
      const installation = installations.find(item => item.id === extensionInstallationId(input.packageId, target))
      if (installation?.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before uninstall')
      assertCardDependentsCompatible(installations, input.packageId, target.cardId)
      await stopCardPackage(record, target)
      await options.uninstallInstallation({ packageId: input.packageId, target, expectedInstallationVersion: input.expectedInstallationVersion })
      await forgetCardPackage(record, target)
      // ponytail: Shared archives survive uninstall; reclaim only after an installation-aware cache collector exists.
      return { packageId: input.packageId, version: record.manifest.version, target, removed: true, resourcesRetained: true }
    }),

    installPackage: sourceDirectory => serialize(async () => {
      assertInitialized(initialized)
      const installed = await installExtensionPackageFromDirectory({
        sourceDirectory,
        installedDirectory: options.installedDirectory,
        flat: true,
      })
      return finishLocalPackageInstall(installed, false)
    }),

    installPackageZip: source => serialize(async () => {
      assertInitialized(initialized)
      const installed = await installExtensionPackageFromZip({
        source,
        installedDirectory: options.installedDirectory,
        flat: true,
      })
      return finishLocalPackageInstall(installed, true)
    }),

    uninstallPackage: (packageId, version, deleteData) => serialize(async () => {
      assertInitialized(initialized)
      const record = requirePackage(catalog, packageId)
      if (deleteData && !options.deleteData) throw new Error('Extension data deletion is unavailable')
      await options.assertDependencyConsumers?.(packageId, { kind: 'global' })
      const dependents = [...catalog].filter(([id, entry]) => id !== packageId && entry.manifest.dependencies?.some(item => item.id === packageId)).map(([id]) => id)
      if (dependents.length) throw new Error(`Extension is required by: ${dependents.join(', ')}. Uninstall dependent extensions first.`)
      if (version !== undefined && version !== record.manifest.version) {
        throw new Error(`Installed Extension Package version does not match: ${packageId}@${version}`)
      }
      if (record.sources.length !== 1 || !['installed', 'dev-link'].includes(record.sources[0]?.kind ?? '')) {
        throw new Error(`Only an installed or dev-linked Extension Package can be uninstalled: ${packageId}`)
      }
      for (const moduleManifest of record.manifest.modules ?? []) {
        const desired = readDesiredState(options.stateStore, packageId, moduleManifest.id)
        if (!desired.enabled) continue
        await options.stateStore.set(packageId, moduleManifest.id, {
          enabled: false,
          grantedEventCapabilities: desired.grantedEventCapabilities,
          grantedAssetCapabilities: desired.grantedAssetCapabilities,
          grantedUiCapabilities: desired.grantedUiCapabilities,
        })
      }
      const modules = serverModules(record.manifest)
      const errors: unknown[] = []
      for (const moduleManifest of modules) {
        try {
          await options.host.dispose(packageId, moduleManifest.id)
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `Extension Package uninstall incomplete: ${packageId}; modules disabled, package retained. Retry uninstall to finish.`)
      }
      for (const moduleManifest of modules) {
        await options.host.forget(packageId, moduleManifest.id)
      }
      if (deleteData) await options.deleteData!(packageId, (record.manifest.modules ?? []).flatMap(module => module.contributes?.documentTypes?.map(item => item.type) ?? []))
      await options.stateStore.deletePackage(packageId)
      if (record.sources[0]?.kind === 'installed') {
        await uninstallExtensionPackageDirectory({
          directory: record.directory,
          installedDirectory: options.installedDirectory,
          flat: true,
        })
      } else if (!await removeExtensionDevLink(options.devLinksFile, packageId)) {
        throw new Error(`Extension dev link not found: ${packageId}`)
      }
      catalog.delete(packageId)
      await rm(join(options.installedDirectory, '.history', packageId), { recursive: true, force: true })
      return {
        packageId,
        version: record.manifest.version,
        removed: true,
        resourcesRetained: true,
      }
    }),

    enableModule: (...args) => serialize(() => enableModule(...args)),
    disableModule: (...args) => serialize(() => disableModule(...args)),

    reloadModule: (packageId, moduleId, target) => serialize(async () => {
      assertInitialized(initialized)
      const record = packageRecord(packageId, target)
      if (!record.available) throw new Error(`Extension package is unavailable: ${packageId}`)
      const moduleManifest = requireModule(record.manifest, moduleId)
      if (target?.kind === 'card') await options.readCardPackage({ cardId: target.cardId, packageId, source: 'installed' })
      const desired = readDesiredState(options.stateStore, packageId, moduleId, target)
      if (!desired.enabled) throw new Error(`Extension module is not enabled: ${moduleKey(packageId, moduleId)}`)
      const runtime = moduleManifest.runtime === 'server' ? await options.host.reload(packageId, moduleId, target) : undefined
      moduleReloadIds(record)[moduleId] = randomUUID()
      if (target?.kind !== 'card') record.fileRevision = `${record.manifest.version}-${randomUUID()}`
      return toManagedModule(packageId, record, moduleManifest, desired, runtime, target)
    }),

    importPackageResources: packageId => serialize(() => importResources(packageId)),
    importCardPackageResources: input => serialize(async () => {
        assertInitialized(initialized)
        const record = await prepareCardPackage(input)
        if (record.manifest.modules?.length) throw new Error('Card code packages are not enabled yet; only resource-only packages can be installed')
        const existing = cardCatalog.get(extensionInstallationId(input.packageId, { kind: 'card', cardId: input.cardId }))
        if (existing?.record.manifest.modules?.length) throw new Error('Use the code package lifecycle to update an installed Card code package')
        const imported = await importResources(input.packageId, input.update, {
          cardId: input.cardId, expectedCardVersion: input.expectedCardVersion,
          record,
        })
        await discoverCardPackage(input.cardId, input.packageId)
        return imported
    }),
    removeCardPackageResources: input => serialize(async () => {
      assertInitialized(initialized)
      const removed = await options.removePackageResources({
        packageId: input.packageId, target: { kind: 'card', cardId: input.cardId },
        expectedInstallationVersion: input.expectedInstallationVersion,
      })
      return removed
    }),
    exportPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, input.packageId)
      if (record.manifest.version !== input.version) throw new Error('Extension package changed; review the export again')
      const source = await exportExtensionPackageZip(record.directory, record.manifest)
      const archive = options.exportExtensionArchive ? await options.exportExtensionArchive({
        archive: source, packageId: input.packageId, version: input.version,
        installationId: extensionInstallationId(input.packageId, { kind: 'global' }),
      }) : source
      return { ...input, archiveBase64: Buffer.from(archive).toString('base64') }
    }),
    updatePackageResources: input => serialize(() => importResources(input.packageId, input)),

    removePackageResources: packageId => serialize(async (): Promise<RemovedExtensionPackageResources> => {
      assertInitialized(initialized)
      const removed = await options.removePackageResources({ packageId })
      return removed
    }),

    getGrantedEventCapabilities: (packageId, moduleId, target) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId, target).grantedEventCapabilities
    },
    getGrantedAssetCapabilities: (packageId, moduleId, target) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId, target).grantedAssetCapabilities
    },
    readCharacterPackage: packageId => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      return { manifest: structuredClone(record.manifest),
        fileUrl: path => packageFileUrl(packageId, record.fileRevision ?? record.manifest.version, path),
        read: async path => (await readFileFromPackage(record, path)).bytes }
    },
    readPackageIcon: async (packageId, version) => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      if (record.manifest.version !== version || !record.manifest.icon) return undefined
      const packageDirectory = await realpath(record.directory)
      const iconPath = await realpath(resolve(packageDirectory, record.manifest.icon))
      const pathFromPackage = relative(packageDirectory, iconPath)
      if (!pathFromPackage || pathFromPackage === '..' || pathFromPackage.startsWith(`..${sep}`) || isAbsolute(pathFromPackage)) {
        throw new Error(`Extension Package icon escaped its directory: ${packageId}`)
      }
      const iconStat = await stat(iconPath)
      const maxIconBytes = 2 * 1024 * 1024
      if (!iconStat.isFile() || iconStat.size > maxIconBytes) {
        throw new Error(`Extension Package icon must be a file no larger than ${maxIconBytes} bytes: ${packageId}`)
      }
      return {
        bytes: await readFile(iconPath),
        mediaType: iconMediaType(iconPath),
      }
    },
    validatePackageAsset: async input => {
      assertInitialized(initialized)
      // Called from resource import as well as RPC: do not recursively acquire serialize().
      const record = importingAssetSources.get(assetSourceKey(input.packageId, input.target, input.packageVersion))
        ?? (input.target.kind === 'card'
          ? await prepareCardPackage({ cardId: input.target.cardId, packageId: input.packageId, source: 'installed' })
          : requireAvailablePackage(catalog, input.packageId))
      if (record.manifest.version !== input.packageVersion) throw new Error('Package asset version does not match its installation')
      await readFileFromPackage(record, input.path)
    },
    readPackageFile: async (packageId, version, path) => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      if ((record.fileRevision ?? record.manifest.version) !== version) throw new Error(`Extension Package revision does not match: ${packageId}@${version}`)
      return readFileFromPackage(record, path)
    },
    readCardPackageFile: (cardId, packageId, version, archiveDigest, path) => serialize(async () => {
      assertInitialized(initialized)
      const record = await prepareCardPackage({ cardId, packageId, source: 'installed' })
      if (record.manifest.version !== version) throw new Error('Card extension package version does not match')
      if (record.archiveDigest !== archiveDigest) throw new Error('Card extension package archive does not match')
      return readFileFromPackage(record, path)
    }),
  }
}

async function readFileFromPackage(record: PackageCatalogRecord, path: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const packageId = record.manifest.id
  const packageDirectory = await realpath(record.directory)
  const requestedPath = resolve(packageDirectory, path)
  const pathFromPackage = relative(packageDirectory, requestedPath)
  if (!pathFromPackage || pathFromPackage.startsWith(`..${sep}`) || pathFromPackage === '..' || isAbsolute(pathFromPackage)) {
    throw new Error(`Extension Package file escaped its directory: ${packageId}`)
  }
  const filePath = await realpath(requestedPath)
  const realPathFromPackage = relative(packageDirectory, filePath)
  if (!realPathFromPackage || realPathFromPackage.startsWith(`..${sep}`) || realPathFromPackage === '..' || isAbsolute(realPathFromPackage)) {
    throw new Error(`Extension Package file escaped its directory: ${packageId}`)
  }
  const fileStat = await stat(filePath)
  const maxFileBytes = 16 * 1024 * 1024
  if (!fileStat.isFile() || fileStat.size > maxFileBytes) {
    throw new Error(`Extension Package file must be no larger than ${maxFileBytes} bytes: ${packageId}`)
  }
  return { bytes: await readFile(filePath), mediaType: packageFileMediaType(filePath) }
}

function groupSources(discovered: DiscoveredExtensionSource[]): Map<string, DiscoveredExtensionSource[]> {
  const grouped = new Map<string, DiscoveredExtensionSource[]>()
  for (const source of discovered) {
    const sources = grouped.get(source.manifest.id) ?? []
    sources.push(source)
    grouped.set(source.manifest.id, sources)
  }
  return grouped
}

function toSource(source: DiscoveredExtensionSource): ExtensionSource {
  return { kind: source.kind, directory: source.directory, declaredPackageId: source.declaredPackageId }
}

function readDesiredState(store: ExtensionStateStore, packageId: string, moduleId: string, target?: ExtensionInstallationTarget): ExtensionModuleDesiredState {
  return store.get(packageId, moduleId, target) ?? {
    enabled: false,
    grantedEventCapabilities: [],
    grantedAssetCapabilities: [],
    updatedAt: '',
  }
}

function validateEventGrants(
  packageId: string,
  moduleManifest: ExtensionModuleManifest,
  grants: readonly EventCapabilityCategory[],
): EventCapabilityCategory[] {
  const requested = new Set(moduleManifest.capabilities?.['events.subscribe'] ?? [])
  const unique = [...new Set(grants)]
  for (const grant of unique) {
    if (!requested.has(grant)) throw new Error(`Extension module ${moduleKey(packageId, moduleManifest.id)} did not request event capability: ${grant}`)
  }
  return unique
}

function validateAssetGrants(
  packageId: string,
  moduleManifest: ExtensionModuleManifest,
  grants: readonly ExtensionAssetCapability[],
): ExtensionAssetCapability[] {
  const unique = [...new Set(grants)]
  for (const grant of unique) {
    if (moduleManifest.capabilities?.[grant] !== true) {
      throw new Error(`Extension module ${moduleKey(packageId, moduleManifest.id)} did not request asset capability: ${grant}`)
    }
  }
  return unique
}

function sameCapabilities<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(capability => rightSet.has(capability))
}

function toManagedPackage(
  packageId: string,
  record: PackageCatalogRecord,
  stateStore: ExtensionStateStore,
  runtimeByKey: Map<string, ExtensionModuleSummary>,
  target?: ExtensionInstallationTarget,
): ManagedExtensionPackage {
  return {
    packageId,
    ...(record.manifest.participation ? { participation: record.manifest.participation } : {}),
    ...(record.archiveDigest ? { archiveDigest: record.archiveDigest } : {}),
    ...(target?.kind === 'card' ? { target, installationId: extensionInstallationId(packageId, target) } : {}),
    version: record.manifest.version,
    displayName: record.manifest.displayName,
    ...(target?.kind !== 'card' && record.fileRevision ? { fileRevision: record.fileRevision } : {}),
    ...(record.manifest.description ? { description: record.manifest.description } : {}),
    ...(record.manifest.author ? { author: record.manifest.author } : {}),
    ...(record.manifest.homepage ? { homepage: record.manifest.homepage } : {}),
    ...(record.manifest.repository ? { repository: record.manifest.repository } : {}),
    ...(record.manifest.icon ? {
      iconUrl: target?.kind === 'card'
        ? packageFileUrl(packageId, record.manifest.version, record.manifest.icon, target, record.archiveDigest)
        : `/extensions/${encodeURIComponent(packageId)}/${encodeURIComponent(record.manifest.version)}/icon`,
    } : {}),
    tags: record.manifest.tags ?? [],
    ...(record.remote ? { remote: record.remote } : {}),
    available: record.available,
    sourceKinds: [...new Set(record.sources.map(source => source.kind))],
    modules: (record.manifest.modules ?? []).map(moduleManifest => toManagedModule(
      packageId,
      record,
      moduleManifest,
      readDesiredState(stateStore, packageId, moduleManifest.id, target),
      runtimeByKey.get(moduleKey(packageId, moduleManifest.id)),
      target,
    )),
    resources: {
      loomScripts: record.manifest.contributes?.loomScripts ?? [],
      transformRules: record.manifest.contributes?.transformRules ?? [],
      textExtractors: record.manifest.contributes?.textExtractors ?? [],
      promptResources: record.manifest.contributes?.promptResources ?? [],
      agentTools: record.manifest.contributes?.agentTools ?? [],
      settings: record.manifest.contributes?.settings ?? [],
      backgrounds: record.manifest.contributes?.backgrounds ?? [],
      themes: record.manifest.contributes?.themes ?? [],
      styles: record.manifest.contributes?.styles ?? [],
    },
  }
}

async function readPackageJson(record: PackageCatalogRecord, path: string): Promise<JsonValue> {
  const packageDirectory = await realpath(record.directory)
  const filePath = await realpath(resolve(packageDirectory, path))
  const pathFromPackage = relative(packageDirectory, filePath)
  if (!pathFromPackage || pathFromPackage.startsWith(`..${sep}`) || pathFromPackage === '..' || isAbsolute(pathFromPackage)) {
    throw new Error(`Extension Package resource escaped its directory: ${record.manifest.id}`)
  }
  const fileStat = await stat(filePath)
  const maxResourceBytes = 1024 * 1024
  if (!fileStat.isFile() || fileStat.size > maxResourceBytes) {
    throw new Error(`Extension Package JSON resource must be no larger than ${maxResourceBytes} bytes: ${record.manifest.id}`)
  }
  return JSON.parse(await readFile(filePath, 'utf8')) as JsonValue
}

function iconMediaType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function moduleReloadIds(record: PackageCatalogRecord): Record<string, string> {
  return record.reloadIds ??= Object.fromEntries((record.manifest.modules ?? []).map(module => [module.id, randomUUID()]))
}

function toManagedModule(
  packageId: string,
  record: PackageCatalogRecord,
  moduleManifest: ExtensionModuleManifest,
  desired: ExtensionModuleDesiredState,
  runtime?: ExtensionModuleSummary,
  target?: ExtensionInstallationTarget,
): ManagedExtensionModule {
  return {
    packageId,
    moduleId: moduleManifest.id,
    reloadId: moduleReloadIds(record)[moduleManifest.id]!,
    ...(target?.kind === 'card' ? { target } : {}),
    runtimeKind: moduleManifest.runtime,
    requestedCapabilities: Object.fromEntries(Object.entries(moduleManifest.capabilities ?? {}).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)),
    requestedEventCapabilities: moduleManifest.capabilities?.['events.subscribe'] ?? [],
    requestedAssetCapabilities: (['assets.read', 'assets.publish'] as const).filter(capability => moduleManifest.capabilities?.[capability] === true),
    requestedUiCapabilities: moduleManifest.capabilities?.['ui.notify'] === true ? ['ui.notify'] : [],
    desired: {
      enabled: desired.enabled,
      grants: {
        'events.subscribe': desired.grantedEventCapabilities,
        assets: desired.grantedAssetCapabilities,
        ui: desired.grantedUiCapabilities ?? [],
      },
      ...(desired.updatedAt ? { updatedAt: desired.updatedAt } : {}),
    },
    contributions: moduleManifest.contributes ?? {},
    ...((moduleManifest.runtime === 'client' || moduleManifest.runtime === 'client-worker') ? { entryUrl: packageFileUrl(packageId, target?.kind === 'card' ? record.manifest.version : record.fileRevision ?? record.manifest.version, moduleManifest.entry, target, record.archiveDigest) } : {}),
    ...(runtime ? { runtime: runtime } : {}),
  }
}

function packageFileUrl(packageId: string, version: string, path: string, target?: ExtensionInstallationTarget, archiveDigest?: string): string {
  if (target?.kind === 'card' && !archiveDigest) throw new Error('Card package archive digest is required')
  const encodedPath = path.replace(/^\.\//, '').split('/').map(encodeURIComponent).join('/')
  const prefix = target?.kind === 'card' ? `/card-extensions/${encodeURIComponent(target.cardId)}` : '/extensions'
  return `${prefix}/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}${target?.kind === 'card' ? `/${archiveDigest}` : ''}/files/${encodedPath}`
}

function packageFileMediaType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.woff': return 'font/woff'
    case '.woff2': return 'font/woff2'
    case '.ttf': return 'font/ttf'
    case '.otf': return 'font/otf'
    case '.wasm': return 'application/wasm'
    case '.svg': return 'image/svg+xml'
    case '.avif': return 'image/avif'
    default: return iconMediaType(filename)
  }
}

function assertCardDependentsCompatible(
  installations: ListExtensionInstallationsResult['installations'], packageId: string, cardId: string, nextVersion?: string,
): void {
  const blocked = installations.filter(item => item.packageId !== packageId && item.target.kind === 'card' && item.target.cardId === cardId
    && item.dependencies?.some(dependency => dependency.id === packageId && dependency.target !== 'global'
      && (nextVersion === undefined || !satisfiesExtensionVersion(nextVersion, dependency.version))))
  if (blocked.length) throw new Error(`Extension is required by incompatible Card dependents: ${blocked.map(item => item.packageId).join(', ')}`)
}


function requirePackage(catalog: Map<string, PackageCatalogRecord>, packageId: string): PackageCatalogRecord {
  const record = catalog.get(packageId)
  if (!record) throw new Error(`Extension package not found: ${packageId}`)
  return record
}

function requireAvailablePackage(catalog: Map<string, PackageCatalogRecord>, packageId: string): PackageCatalogRecord {
  const record = requirePackage(catalog, packageId)
  if (!record.available) throw new Error(`Extension package is unavailable: ${packageId}`)
  return record
}

function requireModule(manifest: ExtensionManifest, moduleId: string): ExtensionModuleManifest {
  const moduleManifest = manifest.modules?.find(candidate => candidate.id === moduleId)
  if (!moduleManifest) throw new Error(`Extension module not found: ${moduleKey(manifest.id, moduleId)}`)
  return moduleManifest
}

function serverModules(manifest: ExtensionManifest): Array<ExtensionModuleManifest & { runtime: 'server' }> {
  return (manifest.modules ?? []).filter((moduleManifest): moduleManifest is ExtensionModuleManifest & { runtime: 'server' } => (
    moduleManifest.runtime === 'server'
  ))
}

function findRuntime(host: ExtensionHost, packageId: string, moduleId: string, target: ExtensionInstallationTarget = { kind: 'global' }): ExtensionModuleSummary | undefined {
  return host.list().find(summary => summary.installationId === extensionInstallationId(packageId, target) && summary.moduleId === moduleId)
}

function globalRuntimes(host: ExtensionHost): Map<string, ExtensionModuleSummary> {
  return installedRuntimes(host, { kind: 'global' })
}

function installedRuntimes(host: ExtensionHost, target: ExtensionInstallationTarget): Map<string, ExtensionModuleSummary> {
  return new Map(host.list().filter(summary => summary.target.kind === target.kind
    && (target.kind === 'global' || (summary.target.kind === 'card' && summary.target.cardId === target.cardId)))
    .map(summary => [moduleKey(summary.packageId, summary.moduleId), summary]))
}

function reportDiscoveryFailure(registry: DiagnosticsRegistry, source: ExtensionSource, error: unknown): void {
  registry.add({
    severity: 'error',
    code: 'extension.source_invalid',
    message: `Extension package source could not be discovered: ${source.directory}`,
    source: 'extension-manager',
    packageId: source.declaredPackageId,
    extensionId: source.declaredPackageId,
    details: { kind: source.kind, directory: source.directory, error: serializeError(error, 'extension.source_invalid') },
  })
}

function moduleKey(packageId: string, moduleId: string): string {
  return `${packageId}/${moduleId}`
}

function assertInitialized(initialized: boolean): void {
  if (!initialized) throw new Error('Extension manager has not been initialized')
}

// Count package payload only; Git metadata is not installed content.
async function packageBytes(directory: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.git') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) bytes += await packageBytes(path)
    else if (entry.isFile()) bytes += (await stat(path)).size
  }
  return bytes
}
