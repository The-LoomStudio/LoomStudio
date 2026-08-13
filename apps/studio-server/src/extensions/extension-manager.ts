import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { EventCapabilityCategory, ExtensionHost, ExtensionManifest, ExtensionSummary } from '@loom-studio/extension-host'
import type { ExtensionManagementService } from '@loom-studio/kernel'
import type { JsonValue } from '@loom-studio/shared'
import { serializeError } from '@loom-studio/shared'
import { discoverExtensionSources, type DiscoveredExtensionSource, type ExtensionSource } from './extension-sources.js'
import type { ExtensionDesiredState, ExtensionStateStore } from './extension-state-store.js'

type CatalogRecord = {
  manifest: ExtensionManifest
  sources: ExtensionSource[]
  directory?: string
  available: boolean
}

export type ServerExtensionManager = ExtensionManagementService & {
  initialize(): Promise<void>
  getGrantedEventCapabilities(extensionId: string): readonly EventCapabilityCategory[]
}

export function createServerExtensionManager(options: {
  host: ExtensionHost
  diagnostics: DiagnosticsRegistry
  stateStore: ExtensionStateStore
  repositoryDirectory: string
  installedDirectory: string
  devLinksFile: string
}): ServerExtensionManager {
  const catalog = new Map<string, CatalogRecord>()
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

      for (const [extensionId, sources] of groupSources(result.discovered)) {
        const uniqueDirectories = [...new Set(sources.map(source => source.directory))]
        const manifest = sources[0]!.manifest
        if (uniqueDirectories.length > 1) {
          catalog.set(extensionId, {
            manifest,
            sources: sources.map(toSource),
            available: false,
          })
          options.diagnostics.add({
            severity: 'error',
            code: 'extension.source_conflict',
            message: `Extension ${extensionId} was discovered in multiple directories`,
            source: 'extension-manager',
            extensionId,
            details: { directories: uniqueDirectories },
          })
          continue
        }

        const directory = uniqueDirectories[0]!
        const record: CatalogRecord = {
          manifest,
          sources: sources.map(toSource),
          directory,
          available: true,
        }
        catalog.set(extensionId, record)
        try {
          await options.host.discover(directory)
        } catch (error) {
          record.available = false
          options.diagnostics.add({
            severity: 'error',
            code: 'extension.discovery_failed',
            message: `Extension ${extensionId} could not be registered with the host`,
            source: 'extension-manager',
            extensionId,
            details: { error: serializeError(error, 'extension.discovery_failed') },
          })
        }
      }

      initialized = true
      for (const extensionId of [...catalog.keys()].sort()) {
        const desired = options.stateStore.get(extensionId)
        if (!desired?.enabled) continue
        const record = catalog.get(extensionId)!
        if (!record.available) continue
        await options.host.activate(extensionId)
      }
    }),
    list: () => {
      assertInitialized(initialized)
      const runtimeById = new Map(options.host.list().map(summary => [summary.id, summary]))
      return [...catalog.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([extensionId, record]) => {
        const desired = readDesiredState(options.stateStore, extensionId)
        return toManagedSummary(extensionId, record, desired, runtimeById.get(extensionId))
      }) as unknown as JsonValue[]
    },
    enable: (extensionId, grantedEventCapabilities) => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailableRecord(catalog, extensionId)
      const previous = readDesiredState(options.stateStore, extensionId)
      const grants = grantedEventCapabilities === undefined
        ? previous.grantedEventCapabilities
        : validateGrants(record.manifest, grantedEventCapabilities)
      const desired = await options.stateStore.set(extensionId, {
        enabled: true,
        grantedEventCapabilities: grants,
      })
      const current = options.host.list().find(summary => summary.id === extensionId)
      const runtime = current?.instance && (current.instance.state === 'active' || current.instance.state === 'degraded')
        ? sameCapabilities(previous.grantedEventCapabilities, grants)
          ? current
          : await options.host.reload(extensionId)
        : await options.host.activate(extensionId)
      return toManagedSummary(extensionId, record, desired, runtime) as unknown as JsonValue
    }),
    disable: extensionId => serialize(async () => {
      assertInitialized(initialized)
      const record = requireCatalogRecord(catalog, extensionId)
      const previous = readDesiredState(options.stateStore, extensionId)
      const desired = await options.stateStore.set(extensionId, {
        enabled: false,
        grantedEventCapabilities: previous.grantedEventCapabilities,
      })
      await options.host.dispose(extensionId)
      const runtime = options.host.list().find(summary => summary.id === extensionId)
      return toManagedSummary(extensionId, record, desired, runtime) as unknown as JsonValue
    }),
    reload: extensionId => serialize(async () => {
      assertInitialized(initialized)
      const record = requireAvailableRecord(catalog, extensionId)
      const desired = readDesiredState(options.stateStore, extensionId)
      if (!desired.enabled) throw new Error(`Extension is not enabled: ${extensionId}`)
      const runtime = await options.host.reload(extensionId)
      return toManagedSummary(extensionId, record, desired, runtime) as unknown as JsonValue
    }),
    getGrantedEventCapabilities: extensionId => {
      if (!initialized) return []
      return readDesiredState(options.stateStore, extensionId).grantedEventCapabilities
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
  return { kind: source.kind, directory: source.directory, declaredId: source.declaredId }
}

function readDesiredState(store: ExtensionStateStore, extensionId: string): ExtensionDesiredState {
  return store.get(extensionId) ?? {
    enabled: false,
    grantedEventCapabilities: [],
    updatedAt: '',
  }
}

function validateGrants(manifest: ExtensionManifest, grants: readonly EventCapabilityCategory[]): EventCapabilityCategory[] {
  const requested = new Set(manifest.capabilities?.['events.subscribe'] ?? [])
  const unique = [...new Set(grants)]
  for (const grant of unique) {
    if (!requested.has(grant)) throw new Error(`Extension ${manifest.id} did not request event capability: ${grant}`)
  }
  return unique
}

function sameCapabilities(left: readonly EventCapabilityCategory[], right: readonly EventCapabilityCategory[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every(capability => rightSet.has(capability))
}

function toManagedSummary(
  extensionId: string,
  record: CatalogRecord,
  desired: ExtensionDesiredState,
  runtime?: ExtensionSummary,
): Record<string, JsonValue> {
  return {
    id: extensionId,
    version: record.manifest.version,
    displayName: record.manifest.displayName,
    available: record.available,
    sources: record.sources.map(source => ({ kind: source.kind, directory: source.directory })),
    desired: {
      enabled: desired.enabled,
      grants: { 'events.subscribe': desired.grantedEventCapabilities },
      ...(desired.updatedAt ? { updatedAt: desired.updatedAt } : {}),
    },
    ...(runtime ? { runtime: runtime as unknown as JsonValue } : {}),
  }
}

function requireCatalogRecord(catalog: Map<string, CatalogRecord>, extensionId: string): CatalogRecord {
  const record = catalog.get(extensionId)
  if (!record) throw new Error(`Extension not found: ${extensionId}`)
  return record
}

function requireAvailableRecord(catalog: Map<string, CatalogRecord>, extensionId: string): CatalogRecord {
  const record = requireCatalogRecord(catalog, extensionId)
  if (!record.available) throw new Error(`Extension is unavailable: ${extensionId}`)
  return record
}

function reportDiscoveryFailure(registry: DiagnosticsRegistry, source: ExtensionSource, error: unknown): void {
  registry.add({
    severity: 'error',
    code: 'extension.source_invalid',
    message: `Extension source could not be discovered: ${source.directory}`,
    source: 'extension-manager',
    extensionId: source.declaredId,
    details: { kind: source.kind, directory: source.directory, error: serializeError(error, 'extension.source_invalid') },
  })
}

function assertInitialized(initialized: boolean): void {
  if (!initialized) throw new Error('Extension manager has not been initialized')
}
