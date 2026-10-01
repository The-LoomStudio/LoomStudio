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
import type { JsonValue } from '@loom-studio/shared'
import { extensionInstallationId, type ExtensionInstallationTarget, type ListExtensionInstallationsResult } from '@loom-studio/application-runtime'
import { parseExtensionManifest } from '@loom-studio/extension-host'
import { serializeError } from '@loom-studio/shared'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { discoverExtensionSources, removeExtensionDevLink, type DiscoveredExtensionSource, type ExtensionSource } from './extension-sources.js'
import {
  installExtensionPackageFromDirectory,
  exportExtensionPackageZip,
  installExtensionPackageFromZip,
  uninstallExtensionPackageDirectory,
} from './extension-package-installer.js'
import type { ExtensionModuleDesiredState, ExtensionStateStore } from './extension-state-store.js'

type PackageCatalogRecord = {
  archiveDigest?: string
  manifest: ExtensionManifest
  sources: ExtensionSource[]
  directory: string
  available: boolean
}

export type ServerExtensionManager = ExtensionManagementService & {
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
  diagnostics: DiagnosticsRegistry
  stateStore: ExtensionStateStore
  repositoryDirectory?: string
  installedDirectory: string
  devLinksFile: string
  readCardPackage(input: { cardId: string; packageId: string; source?: 'installed' }): Promise<{ cardVersion: number; archive: { packageId: string; version: string; archiveBase64: string } }>
  listInstallations(): Promise<ListExtensionInstallationsResult>
  importPackageResources(input: {
    loomScripts?: Array<{ contribution: { id: string; source: string }; source: string }>
    target?: ExtensionInstallationTarget
    expectedCardVersion?: number
    update?: { expectedInstallationVersion: number }
    packageId: string
    packageVersion: string
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
  }): Promise<Record<string, JsonValue>>
  removePackageResources(input: { packageId: string; target?: ExtensionInstallationTarget; expectedInstallationVersion?: number; uninstall?: true }): Promise<Record<string, JsonValue>>
}): ServerExtensionManager {
  const catalog = new Map<string, PackageCatalogRecord>()
  const cardCatalog = new Map<string, { target: Extract<ExtensionInstallationTarget, { kind: 'card' }>; record: PackageCatalogRecord }>()
  let initialized = false

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
    const root = resolve(options.installedDirectory, '..', 'card-installed', digest)
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

  async function importResources(
    packageId: string,
    update?: { expectedInstallationVersion: number; packageVersion: string },
    cardSource?: { record: PackageCatalogRecord; cardId: string; expectedCardVersion: number },
  ): Promise<ImportedExtensionPackageResources> {
    assertInitialized(initialized)
    const record = cardSource?.record ?? requireAvailablePackage(catalog, packageId)
    if (update && record.manifest.version !== update.packageVersion) throw new Error('Extension package changed; review the update again')
    const imported = await options.importPackageResources({
      packageId,
      packageVersion: record.manifest.version,
      loomScripts: await Promise.all((record.manifest.contributes?.loomScripts ?? []).map(async contribution => ({
        contribution, source: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode((await readFileFromPackage(record, contribution.source)).bytes),
      }))),
      ...(cardSource ? { target: { kind: 'card' as const, cardId: cardSource.cardId }, expectedCardVersion: cardSource.expectedCardVersion } : {}),
      ...(update ? { update: { expectedInstallationVersion: update.expectedInstallationVersion } } : {}),
      promptResources: await Promise.all((record.manifest.contributes?.promptResources ?? []).map(async contribution => ({
        contribution, artifact: await readPackageJson(record, contribution.source),
      }))),
      agentTools: await Promise.all((record.manifest.contributes?.agentTools ?? []).map(async contribution => ({
        contribution, definition: await readPackageJson(record, contribution.source),
      }))),
      transformRules: await Promise.all((record.manifest.contributes?.transformRules ?? []).map(async contribution => ({
        contribution, artifact: await readPackageJson(record, contribution.source),
      }))),
      textExtractors: await Promise.all((record.manifest.contributes?.textExtractors ?? []).map(async contribution => ({
        contribution, artifact: await readPackageJson(record, contribution.source),
      }))),
    })
    return { packageId, version: record.manifest.version, ...imported }
  }
  let operationQueue = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
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
          await options.host.activate(packageId, moduleManifest.id)
        }
      }
      for (const { record, target } of cardCatalog.values()) {
        for (const moduleManifest of serverModules(record.manifest)) {
          if (options.stateStore.get(record.manifest.id, moduleManifest.id, target)?.enabled) {
            await options.host.activate(record.manifest.id, moduleManifest.id, target)
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
      return toManagedPackage(input.packageId, record, options.stateStore, installedRuntimes(options.host, target), target)
    }),

    updateCardPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const target = { kind: 'card' as const, cardId: input.cardId }
      const previous = packageRecord(input.packageId, target)
      const installation = (await options.listInstallations()).installations.find(item => item.id === extensionInstallationId(input.packageId, target))
      if (installation?.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before update')
      const next = await prepareCardPackage(input)
      if (next.manifest.version !== input.packageVersion) throw new Error('Extension package changed; review the update again')
      const previousStates = new Map((previous.manifest.modules ?? []).map(module => [
        module.id, { module, desired: readDesiredState(options.stateStore, input.packageId, module.id, target) },
      ]))
      await stopCardPackage(previous, target)
      try {
        await importResources(input.packageId, {
          expectedInstallationVersion: input.expectedInstallationVersion, packageVersion: input.packageVersion,
        }, { ...input, record: next })
      } catch (error) {
        throw new Error(`Card package update failed; old modules remain stopped: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      }
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
      const installation = (await options.listInstallations()).installations.find(item => item.id === extensionInstallationId(input.packageId, target))
      if (installation?.version !== input.expectedInstallationVersion) throw new Error('Extension installation changed before uninstall')
      await stopCardPackage(record, target)
      await options.removePackageResources({ packageId: input.packageId, target, expectedInstallationVersion: input.expectedInstallationVersion, uninstall: true })
      await forgetCardPackage(record, target)
      // ponytail: Shared archives survive uninstall; reclaim only after an installation-aware cache collector exists.
      return { packageId: input.packageId, version: record.manifest.version, target, removed: true }
    }),

    installPackage: sourceDirectory => serialize(async () => {
      assertInitialized(initialized)
      const installed = await installExtensionPackageFromDirectory({
        sourceDirectory,
        installedDirectory: options.installedDirectory,
      })
      try {
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
        const runtimeByKey = globalRuntimes(options.host)
        return toManagedPackage(installed.manifest.id, record, options.stateStore, runtimeByKey)
      } catch (error) {
        await uninstallExtensionPackageDirectory({
          directory: installed.directory,
          installedDirectory: options.installedDirectory,
        }).catch(() => undefined)
        throw error
      }
    }),

    installPackageZip: source => serialize(async () => {
      assertInitialized(initialized)
      const installed = await installExtensionPackageFromZip({
        source,
        installedDirectory: options.installedDirectory,
      })
      try {
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
        const runtimeByKey = globalRuntimes(options.host)
        return toManagedPackage(installed.manifest.id, record, options.stateStore, runtimeByKey)
      } catch (error) {
        await uninstallExtensionPackageDirectory({
          directory: installed.directory,
          installedDirectory: options.installedDirectory,
        }).catch(() => undefined)
        throw error
      }
    }),

    uninstallPackage: (packageId, version) => serialize(async () => {
      assertInitialized(initialized)
      const record = requirePackage(catalog, packageId)
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
      await options.stateStore.deletePackage(packageId)
      if (record.sources[0]?.kind === 'installed') {
        await uninstallExtensionPackageDirectory({
          directory: record.directory,
          installedDirectory: options.installedDirectory,
        })
      } else if (!await removeExtensionDevLink(options.devLinksFile, packageId)) {
        throw new Error(`Extension dev link not found: ${packageId}`)
      }
      catalog.delete(packageId)
      return {
        packageId,
        version: record.manifest.version,
        removed: true,
      }
    }),

    enableModule: (packageId, moduleId, requestedGrants, target) => serialize(async () => {
      assertInitialized(initialized)
      const record = packageRecord(packageId, target)
      if (!record.available) throw new Error(`Extension package is unavailable: ${packageId}`)
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
      if (uiGrants.some(grant => grant !== 'ui.notify' || moduleManifest.runtime !== 'client' || moduleManifest.capabilities?.[grant] !== true)) {
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
        runtime = current?.instance && (current.instance.state === 'active' || current.instance.state === 'degraded')
          ? sameCapabilities(previous.grantedEventCapabilities, eventGrants)
            && sameCapabilities(previous.grantedAssetCapabilities, assetGrants)
            ? current
            : await options.host.reload(packageId, moduleId, target)
          : await options.host.activate(packageId, moduleId, target)
      }
        return toManagedModule(packageId, record.manifest.version, moduleManifest, desired, runtime, target, record.archiveDigest)
    }),

    disableModule: (packageId, moduleId, target) => serialize(async () => {
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
      return toManagedModule(packageId, record.manifest.version, moduleManifest, desired, findRuntime(options.host, packageId, moduleId, target), target, record.archiveDigest)
    }),

    reloadModule: (packageId, moduleId, target) => serialize(async () => {
      assertInitialized(initialized)
      const record = packageRecord(packageId, target)
      if (!record.available) throw new Error(`Extension package is unavailable: ${packageId}`)
      const moduleManifest = requireModule(record.manifest, moduleId)
      if (target?.kind === 'card') await options.readCardPackage({ cardId: target.cardId, packageId, source: 'installed' })
      const desired = readDesiredState(options.stateStore, packageId, moduleId, target)
      if (!desired.enabled) throw new Error(`Extension module is not enabled: ${moduleKey(packageId, moduleId)}`)
      const runtime = moduleManifest.runtime === 'server' ? await options.host.reload(packageId, moduleId, target) : undefined
      return toManagedModule(packageId, record.manifest.version, moduleManifest, desired, runtime, target, record.archiveDigest)
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
      return { packageId: input.packageId, ...removed }
    }),
    exportPackage: input => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, input.packageId)
      if (record.manifest.version !== input.version) throw new Error('Extension package changed; review the export again')
      const archive = await exportExtensionPackageZip(record.directory, record.manifest)
      return { ...input, archiveBase64: Buffer.from(archive).toString('base64') }
    }),
    updatePackageResources: input => serialize(() => importResources(input.packageId, input)),

    removePackageResources: packageId => serialize(async (): Promise<RemovedExtensionPackageResources> => {
      assertInitialized(initialized)
      const removed = await options.removePackageResources({ packageId })
      return { packageId, ...removed }
    }),

    getGrantedEventCapabilities: (packageId, moduleId, target) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId, target).grantedEventCapabilities
    },
    getGrantedAssetCapabilities: (packageId, moduleId, target) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId, target).grantedAssetCapabilities
    },
    readPackageIcon: async (packageId, version) => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      if (record.manifest.version !== version || !record.manifest.icon) return undefined
      const packageDirectory = await realpath(record.directory)
      const iconPath = await realpath(resolve(packageDirectory, record.manifest.icon))
      const pathFromPackage = relative(packageDirectory, iconPath)
      if (!pathFromPackage || pathFromPackage.startsWith('..') || isAbsolute(pathFromPackage)) {
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
    readPackageFile: async (packageId, version, path) => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      if (record.manifest.version !== version) throw new Error(`Extension Package version does not match: ${packageId}@${version}`)
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
    ...(record.archiveDigest ? { archiveDigest: record.archiveDigest } : {}),
    ...(target?.kind === 'card' ? { target, installationId: extensionInstallationId(packageId, target) } : {}),
    version: record.manifest.version,
    displayName: record.manifest.displayName,
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
    available: record.available,
    sourceKinds: [...new Set(record.sources.map(source => source.kind))],
    modules: (record.manifest.modules ?? []).map(moduleManifest => toManagedModule(
      packageId,
      record.manifest.version,
      moduleManifest,
      readDesiredState(stateStore, packageId, moduleManifest.id, target),
      runtimeByKey.get(moduleKey(packageId, moduleManifest.id)),
      target,
      record.archiveDigest,
    )),
    resources: {
      loomScripts: record.manifest.contributes?.loomScripts ?? [],
      transformRules: record.manifest.contributes?.transformRules ?? [],
      textExtractors: record.manifest.contributes?.textExtractors ?? [],
      promptResources: record.manifest.contributes?.promptResources ?? [],
      agentTools: record.manifest.contributes?.agentTools ?? [],
      settings: record.manifest.contributes?.settings ?? [],
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

function toManagedModule(
  packageId: string,
  version: string,
  moduleManifest: ExtensionModuleManifest,
  desired: ExtensionModuleDesiredState,
  runtime?: ExtensionModuleSummary,
  target?: ExtensionInstallationTarget,
  archiveDigest?: string,
): ManagedExtensionModule {
  return {
    packageId,
    moduleId: moduleManifest.id,
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
    contributions: moduleManifest.contributes as unknown as JsonValue ?? {},
    ...(moduleManifest.runtime === 'client' ? { entryUrl: packageFileUrl(packageId, version, moduleManifest.entry, target, archiveDigest) } : {}),
    ...(runtime ? { runtime: runtime as unknown as JsonValue } : {}),
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
    case '.wasm': return 'application/wasm'
    case '.svg': return 'image/svg+xml'
    default: return iconMediaType(filename)
  }
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
