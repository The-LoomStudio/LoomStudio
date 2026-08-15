import type {
  EventCapabilityCategory,
  ExtensionAssetCapability,
  ExtensionHost,
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionModuleSummary,
} from '@loom-studio/extension-host'
import type { ExtensionManagementService } from '@loom-studio/kernel'
import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { JsonValue } from '@loom-studio/shared'
import { serializeError } from '@loom-studio/shared'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { discoverExtensionSources, type DiscoveredExtensionSource, type ExtensionSource } from './extension-sources.js'
import {
  installExtensionPackageFromDirectory,
  uninstallExtensionPackageDirectory,
} from './extension-package-installer.js'
import type { ExtensionModuleDesiredState, ExtensionStateStore } from './extension-state-store.js'

type PackageCatalogRecord = {
  manifest: ExtensionManifest
  sources: ExtensionSource[]
  directory: string
  available: boolean
}

export type ServerExtensionManager = ExtensionManagementService & {
  initialize(): Promise<void>
  getGrantedEventCapabilities(packageId: string, moduleId: string): readonly EventCapabilityCategory[]
  getGrantedAssetCapabilities(packageId: string, moduleId: string): readonly ExtensionAssetCapability[]
  readPackageIcon(packageId: string, version: string): Promise<{
    bytes: Uint8Array
    mediaType: string
  } | undefined>
}

export function createServerExtensionManager(options: {
  host: ExtensionHost
  diagnostics: DiagnosticsRegistry
  stateStore: ExtensionStateStore
  repositoryDirectory: string
  installedDirectory: string
  devLinksFile: string
}): ServerExtensionManager {
  const catalog = new Map<string, PackageCatalogRecord>()
  let initialized = false
  let operationQueue = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationQueue.then(operation, operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
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
      for (const [packageId, record] of [...catalog.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        if (!record.available) continue
        for (const moduleManifest of serverModules(record.manifest)) {
          if (!options.stateStore.get(packageId, moduleManifest.id)?.enabled) continue
          await options.host.activate(packageId, moduleManifest.id)
        }
      }
    }),

    listPackages: () => {
      assertInitialized(initialized)
      const runtimeByKey = new Map(options.host.list().map(summary => [moduleKey(summary.packageId, summary.moduleId), summary]))
      return [...catalog.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([packageId, record]) => toManagedPackage(packageId, record, options.stateStore, runtimeByKey)) as unknown as JsonValue[]
    },

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
        const runtimeByKey = new Map(options.host.list().map(summary => [moduleKey(summary.packageId, summary.moduleId), summary]))
        return toManagedPackage(installed.manifest.id, record, options.stateStore, runtimeByKey) as unknown as JsonValue
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
      if (record.sources.length !== 1 || record.sources[0]?.kind !== 'installed') {
        throw new Error(`Only an installed Extension Package can be uninstalled: ${packageId}`)
      }
      for (const moduleManifest of serverModules(record.manifest)) {
        await options.host.dispose(packageId, moduleManifest.id)
      }
      await uninstallExtensionPackageDirectory({
        directory: record.directory,
        installedDirectory: options.installedDirectory,
      })
      catalog.delete(packageId)
      return {
        packageId,
        version: record.manifest.version,
        removed: true,
      } as unknown as JsonValue
    }),

    enableModule: (packageId, moduleId, requestedGrants) => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      const moduleManifest = requireModule(record.manifest, moduleId)
      const previous = readDesiredState(options.stateStore, packageId, moduleId)
      const eventGrants = requestedGrants?.eventCapabilities === undefined
        ? previous.grantedEventCapabilities
        : validateEventGrants(packageId, moduleManifest, requestedGrants.eventCapabilities)
      const assetGrants = requestedGrants?.assetCapabilities === undefined
        ? previous.grantedAssetCapabilities
        : validateAssetGrants(packageId, moduleManifest, requestedGrants.assetCapabilities)
      const desired = await options.stateStore.set(packageId, moduleId, {
        enabled: true,
        grantedEventCapabilities: eventGrants,
        grantedAssetCapabilities: assetGrants,
      })

      let runtime: ExtensionModuleSummary | undefined
      if (moduleManifest.runtime === 'server') {
        const current = findRuntime(options.host, packageId, moduleId)
        runtime = current?.instance && (current.instance.state === 'active' || current.instance.state === 'degraded')
          ? sameCapabilities(previous.grantedEventCapabilities, eventGrants)
            && sameCapabilities(previous.grantedAssetCapabilities, assetGrants)
            ? current
            : await options.host.reload(packageId, moduleId)
          : await options.host.activate(packageId, moduleId)
      }
      return toManagedModule(packageId, moduleManifest, desired, runtime) as unknown as JsonValue
    }),

    disableModule: (packageId, moduleId) => serialize(async () => {
      assertInitialized(initialized)
      const record = requirePackage(catalog, packageId)
      const moduleManifest = requireModule(record.manifest, moduleId)
      const previous = readDesiredState(options.stateStore, packageId, moduleId)
      const desired = await options.stateStore.set(packageId, moduleId, {
        enabled: false,
        grantedEventCapabilities: previous.grantedEventCapabilities,
        grantedAssetCapabilities: previous.grantedAssetCapabilities,
      })
      if (moduleManifest.runtime === 'server') await options.host.dispose(packageId, moduleId)
      return toManagedModule(packageId, moduleManifest, desired, findRuntime(options.host, packageId, moduleId)) as unknown as JsonValue
    }),

    reloadModule: (packageId, moduleId) => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailablePackage(catalog, packageId)
      const moduleManifest = requireModule(record.manifest, moduleId)
      if (moduleManifest.runtime !== 'server') throw new Error(`Client module reload belongs to the Client Host: ${moduleKey(packageId, moduleId)}`)
      const desired = readDesiredState(options.stateStore, packageId, moduleId)
      if (!desired.enabled) throw new Error(`Extension module is not enabled: ${moduleKey(packageId, moduleId)}`)
      const runtime = await options.host.reload(packageId, moduleId)
      return toManagedModule(packageId, moduleManifest, desired, runtime) as unknown as JsonValue
    }),

    getGrantedEventCapabilities: (packageId, moduleId) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId).grantedEventCapabilities
    },
    getGrantedAssetCapabilities: (packageId, moduleId) => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, packageId, moduleId).grantedAssetCapabilities
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
  }
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

function readDesiredState(store: ExtensionStateStore, packageId: string, moduleId: string): ExtensionModuleDesiredState {
  return store.get(packageId, moduleId) ?? {
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
): Record<string, JsonValue> {
  return {
    packageId,
    version: record.manifest.version,
    displayName: record.manifest.displayName,
    ...(record.manifest.description ? { description: record.manifest.description } : {}),
    ...(record.manifest.author ? { author: record.manifest.author } : {}),
    ...(record.manifest.homepage ? { homepage: record.manifest.homepage } : {}),
    ...(record.manifest.repository ? { repository: record.manifest.repository } : {}),
    ...(record.manifest.icon ? {
      iconUrl: `/extensions/${encodeURIComponent(packageId)}/${encodeURIComponent(record.manifest.version)}/icon`,
    } : {}),
    tags: record.manifest.tags ?? [],
    available: record.available,
    sourceKinds: [...new Set(record.sources.map(source => source.kind))],
    modules: (record.manifest.modules ?? []).map(moduleManifest => toManagedModule(
      packageId,
      moduleManifest,
      readDesiredState(stateStore, packageId, moduleManifest.id),
      runtimeByKey.get(moduleKey(packageId, moduleManifest.id)),
    )),
    resources: {
      transformRules: record.manifest.contributes?.transformRules ?? [],
    },
  }
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
  moduleManifest: ExtensionModuleManifest,
  desired: ExtensionModuleDesiredState,
  runtime?: ExtensionModuleSummary,
): Record<string, JsonValue> {
  return {
    packageId,
    moduleId: moduleManifest.id,
    runtimeKind: moduleManifest.runtime,
    desired: {
      enabled: desired.enabled,
      grants: {
        'events.subscribe': desired.grantedEventCapabilities,
        assets: desired.grantedAssetCapabilities,
      },
      ...(desired.updatedAt ? { updatedAt: desired.updatedAt } : {}),
    },
    contributions: moduleManifest.contributes as unknown as JsonValue ?? {},
    ...(runtime ? { runtime: runtime as unknown as JsonValue } : {}),
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

function findRuntime(host: ExtensionHost, packageId: string, moduleId: string): ExtensionModuleSummary | undefined {
  return host.list().find(summary => summary.packageId === packageId && summary.moduleId === moduleId)
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
