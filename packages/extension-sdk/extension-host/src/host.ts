import { createId } from '@loom-studio/shared'
import {
  type ExtensionHost,
  type ExtensionHostOptions,
  type ExtensionInstance,
  type ExtensionModuleRecord,
  type ExtensionModuleSummary,
} from './types.js'
import { readManifest, serverModules, contributionCounts } from './manifest.js'
import { moduleKey } from './storage.js'
import {
  createContext,
  createExtensionScope,
  disposeFailedActivation,
  hasContributionMismatch,
  isLiveInstance,
  loadServerModule,
  reportDiagnostic,
  stopInstance,
  toSummary,
} from './instance.js'

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
  const records = new Map<string, ExtensionModuleRecord>()

  return {
    discover: async directory => {
      const manifest = readManifest(directory)
      const summaries: ExtensionModuleSummary[] = []
      for (const moduleManifest of serverModules(manifest)) {
        const key = moduleKey(manifest.id, moduleManifest.id)
        const previous = records.get(key)
        if (previous?.instance && isLiveInstance(previous.instance.state)) {
          throw new Error(`Cannot rediscover active extension module: ${key}`)
        }
        const record: ExtensionModuleRecord = {
          directory,
          packageManifest: manifest,
          moduleManifest,
          state: 'manifestValidated',
          instance: previous?.instance,
        }
        records.set(key, record)
        summaries.push(toSummary(record))
      }
      options.logger?.info(`${manifest.id} discovered · v${manifest.version}`, {
        event: 'extension.discovered',
        data: {
          packageId: manifest.id,
          version: manifest.version,
          serverModuleCount: summaries.length,
        },
      })
      return summaries
    },

    activate: (packageId, moduleId) => activateRecord(packageId, moduleId, records, options),

    activateAll: async () => {
      const summaries: ExtensionModuleSummary[] = []
      for (const record of [...records.values()].sort(compareRecords)) {
        summaries.push(await activateRecord(record.packageManifest.id, record.moduleManifest.id, records, options))
      }
      return summaries
    },

    reload: async (packageId, moduleId) => {
      const record = records.get(moduleKey(packageId, moduleId))
      if (!record) throw new Error(`Extension module not found: ${moduleKey(packageId, moduleId)}`)
      await stopInstance(record, options)
      return activateRecord(packageId, moduleId, records, options)
    },

    dispose: async (packageId, moduleId) => {
      const key = moduleKey(packageId, moduleId)
      const record = records.get(key)
      if (!record) return
      try {
        await stopInstance(record, options)
      } finally {
        record.state = 'disabled'
        options.logger?.info(`${key} disposed`, {
          event: 'extension.disposed',
          data: {
            packageId,
            moduleId,
            ...(record.instance ? { instanceId: record.instance.instanceId } : {}),
            state: record.instance?.state ?? record.state,
          },
        })
      }
    },

    forget: async (packageId, moduleId) => {
      await stopAndForgetRecord(packageId, moduleId, records, options)
    },

    disposeAll: async () => {
      const errors: unknown[] = []
      for (const record of [...records.values()].reverse()) {
        if (!record.instance || !isLiveInstance(record.instance.state)) continue
        try {
          await stopInstance(record, options)
        } catch (error) {
          errors.push(error)
        }
        record.state = 'disabled'
      }
      if (errors.length > 0) throw new AggregateError(errors, 'One or more extensions failed to dispose')
    },

    list: () => [...records.values()].map(toSummary),
    diagnostics: (packageId, moduleId) => options.diagnostics.list({ packageId, moduleId }),
  }
}

async function stopAndForgetRecord(
  packageId: string,
  moduleId: string,
  records: Map<string, ExtensionModuleRecord>,
  options: ExtensionHostOptions,
): Promise<void> {
  const key = moduleKey(packageId, moduleId)
  const record = records.get(key)
  if (!record) return
  try {
    await stopInstance(record, options)
  } finally {
    records.delete(key)
  }
}

async function activateRecord(
  packageId: string,
  moduleId: string,
  records: Map<string, ExtensionModuleRecord>,
  options: ExtensionHostOptions,
): Promise<ExtensionModuleSummary> {
  const key = moduleKey(packageId, moduleId)
  const record = records.get(key)
  if (!record) throw new Error(`Extension module not found: ${key}`)
  if (record.instance && isLiveInstance(record.instance.state)) {
    throw new Error(`Extension module already active: ${key}`)
  }

  const startedAt = performance.now()
  const instanceId = createId('extinst')
  const instance: ExtensionInstance = {
    instanceId,
    state: 'created',
    scope: createExtensionScope(instanceId),
    registeredRpcNames: new Set(),
    registeredEventNames: new Set(),
    registeredAiProviderIds: new Set(),
    registeredAgentToolIds: new Set(),
    grantedEventCapabilities: [...new Set(options.grantEventCapabilities?.(record.packageManifest, record.moduleManifest) ?? [])],
    grantedAssetCapabilities: [...new Set(options.grantAssetCapabilities?.(record.packageManifest, record.moduleManifest) ?? [])],
  }
  record.instance = instance
  record.state = 'activating'
  instance.state = 'activating'
  options.logger?.info(`${key} activation started`, {
    event: 'extension.activation.started',
    data: { packageId, moduleId, instanceId, version: record.packageManifest.version, state: instance.state },
  })

  try {
    const module = await loadServerModule(record, instanceId)
    record.state = 'loaded'
    await instance.scope.run(() => module.activate(createContext(record, instance, options)))
    const mismatched = hasContributionMismatch(record, instance, options)
    instance.state = mismatched ? 'degraded' : 'active'
    record.state = instance.state
    const durationMs = elapsedMs(startedAt)
    options.logger?.info(`${key} activated · ${record.state} · ${durationMs} ms`, {
      event: 'extension.activation.completed',
      data: {
        packageId,
        moduleId,
        instanceId,
        version: record.packageManifest.version,
        state: instance.state,
        durationMs,
        contributions: contributionCounts(record.moduleManifest),
      },
    })
  } catch (error) {
    instance.state = 'activation_failed'
    record.state = 'disabled'
    reportDiagnostic(options.diagnostics, record, instanceId, {
      severity: 'error',
      code: 'extension.activation_failed',
      message: error instanceof Error ? error.message : String(error),
      source: 'extension-host',
    })
    await disposeFailedActivation(record, options)
    const durationMs = elapsedMs(startedAt)
    options.logger?.error(`${key} activation failed after ${durationMs} ms`, {
      event: 'extension.activation.failed',
      data: {
        packageId,
        moduleId,
        instanceId,
        version: record.packageManifest.version,
        state: instance.state,
        durationMs,
        failureType: error instanceof Error ? error.name : typeof error,
        ...errorCode(error),
      },
    })
  }

  return toSummary(record)
}

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2))
}

function errorCode(error: unknown): { errorCode?: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? { errorCode: error.code }
    : {}
}

function compareRecords(left: ExtensionModuleRecord, right: ExtensionModuleRecord): number {
  return moduleKey(left.packageManifest.id, left.moduleManifest.id)
    .localeCompare(moduleKey(right.packageManifest.id, right.moduleManifest.id))
}
