import type { EventCapabilityCategory, ExtensionAssetCapability } from '@loom-studio/extension-host'
import { extensionInstallationId, type ExtensionInstallationTarget } from '@loom-studio/application-runtime'
import { isRecord } from '@loom-studio/shared'
import { readFile } from 'node:fs/promises'
import { writeJsonAtomically } from '../platform/atomic-json.js'

export type ExtensionModuleDesiredState = {
  enabled: boolean
  grantedEventCapabilities: EventCapabilityCategory[]
  grantedAssetCapabilities: ExtensionAssetCapability[]
  grantedUiCapabilities?: Array<'ui.notify'>
  updatedAt: string
}

type PersistedExtensionState = {
  version: 4
  installations: Record<string, {
    modules: Record<string, {
      enabled: boolean
      grants: {
        'events.subscribe': EventCapabilityCategory[]
        assets: ExtensionAssetCapability[]
        ui?: Array<'ui.notify'>
      }
      updatedAt: string
    }>
  }>
}

export type ExtensionStateStore = {
  load(): Promise<void>
  get(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): ExtensionModuleDesiredState | undefined
  deletePackage(packageId: string, target?: ExtensionInstallationTarget): Promise<boolean>
  set(
    packageId: string,
    moduleId: string,
    input: Omit<ExtensionModuleDesiredState, 'updatedAt'>,
    target?: ExtensionInstallationTarget,
  ): Promise<ExtensionModuleDesiredState>
}

export function createExtensionStateStore(options: {
  filename: string
  now(): string
}): ExtensionStateStore {
  let state = emptyState()
  let loaded = false
  let writeQueue = Promise.resolve()

  return {
    load: async () => {
      if (loaded) return
      state = await readState(options.filename)
      loaded = true
    },
    get: (packageId, moduleId, target = { kind: 'global' }) => {
      assertLoaded(loaded)
      const entry = state.installations[extensionInstallationId(packageId, target)]?.modules[moduleId]
      return entry ? toDesiredState(entry) : undefined
    },
    deletePackage: async (packageId, target = { kind: 'global' }) => {
      assertLoaded(loaded)
      const installationId = extensionInstallationId(packageId, target)
      let removed = false
      const operation = writeQueue.then(async () => {
        if (!state.installations[installationId]) return
        const installations = { ...state.installations }
        delete installations[installationId]
        const next: PersistedExtensionState = { version: 4, installations }
        await writeState(options.filename, next)
        state = next
        removed = true
      })
      writeQueue = operation.then(() => undefined, () => undefined)
      await operation
      return removed
    },
    set: async (packageId, moduleId, input, target = { kind: 'global' }) => {
      assertLoaded(loaded)
      const installationId = extensionInstallationId(packageId, target)
      const updatedAt = options.now()
      const desired: ExtensionModuleDesiredState = {
        enabled: input.enabled,
        grantedEventCapabilities: [...new Set(input.grantedEventCapabilities)],
        grantedAssetCapabilities: [...new Set(input.grantedAssetCapabilities)],
        grantedUiCapabilities: [...new Set(input.grantedUiCapabilities ?? [])],
        updatedAt,
      }

      const operation = writeQueue.then(async () => {
        const installation = state.installations[installationId] ?? { modules: {} }
        const next: PersistedExtensionState = {
          version: 4,
          installations: {
            ...state.installations,
            [installationId]: {
              modules: {
                ...installation.modules,
                [moduleId]: {
                  enabled: desired.enabled,
                  grants: {
                    'events.subscribe': [...desired.grantedEventCapabilities],
                    assets: [...desired.grantedAssetCapabilities],
                    ui: [...(desired.grantedUiCapabilities ?? [])],
                  },
                  updatedAt,
                },
              },
            },
          },
        }
        await writeState(options.filename, next)
        state = next
      })
      writeQueue = operation.then(() => undefined, () => undefined)
      await operation
      return desired
    },
  }
}

async function readState(filename: string): Promise<PersistedExtensionState> {
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return emptyState()
    throw error
  }

  return parseState(JSON.parse(source) as unknown)
}

function parseState(value: unknown): PersistedExtensionState {
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3 && value.version !== 4)) {
    throw new Error('Extension state must use version 2, 3 or 4')
  }
  const entries = value.version === 4 ? value.installations : value.packages
  if (!isRecord(entries)) throw new Error('Extension state entries must be an object')

  const installations: PersistedExtensionState['installations'] = {}
  for (const [packageId, packageEntry] of Object.entries(entries)) {
    if (!packageId || !isRecord(packageEntry) || !isRecord(packageEntry.modules)) {
      throw new Error(`Invalid extension package state: ${packageId}`)
    }
    const modules: PersistedExtensionState['installations'][string]['modules'] = {}
    for (const [moduleId, entry] of Object.entries(packageEntry.modules)) {
      if (!moduleId || !isRecord(entry) || typeof entry.enabled !== 'boolean' || !isRecord(entry.grants) || typeof entry.updatedAt !== 'string') {
        throw new Error(`Invalid extension module state: ${packageId}/${moduleId}`)
      }
      const eventCapabilities = entry.grants['events.subscribe']
      if (!Array.isArray(eventCapabilities) || !eventCapabilities.every(isEventCapabilityCategory)) {
        throw new Error(`Invalid events.subscribe grants: ${packageId}/${moduleId}`)
      }
      const assetCapabilities = entry.grants.assets ?? []
      if (!Array.isArray(assetCapabilities) || !assetCapabilities.every(isExtensionAssetCapability)) {
        throw new Error(`Invalid asset grants: ${packageId}/${moduleId}`)
      }
      const uiCapabilities = entry.grants.ui ?? []
      if (!Array.isArray(uiCapabilities) || !uiCapabilities.every(value => value === 'ui.notify')) {
        throw new Error(`Invalid UI grants: ${packageId}/${moduleId}`)
      }
      modules[moduleId] = {
        enabled: entry.enabled,
        grants: {
          'events.subscribe': [...new Set(eventCapabilities)],
          assets: [...new Set(assetCapabilities)],
          ui: [...new Set(uiCapabilities)] as Array<'ui.notify'>,
        },
        updatedAt: entry.updatedAt,
      }
    }
    const id = value.version === 4 ? packageId : extensionInstallationId(packageId, { kind: 'global' })
    installations[id] = { modules }
  }

  return { version: 4, installations }
}

async function writeState(filename: string, state: PersistedExtensionState): Promise<void> {
  await writeJsonAtomically(filename, state)
}

function emptyState(): PersistedExtensionState {
  return { version: 4, installations: {} }
}

function toDesiredState(entry: PersistedExtensionState['installations'][string]['modules'][string]): ExtensionModuleDesiredState {
  return {
    enabled: entry.enabled,
    grantedEventCapabilities: [...entry.grants['events.subscribe']],
    grantedAssetCapabilities: [...entry.grants.assets],
    grantedUiCapabilities: [...(entry.grants.ui ?? [])],
    updatedAt: entry.updatedAt,
  }
}

function assertLoaded(loaded: boolean): void {
  if (!loaded) throw new Error('Extension state store has not been loaded')
}

function isEventCapabilityCategory(value: unknown): value is EventCapabilityCategory {
  return value === 'documents'
    || value === 'narrative'
    || value === 'agent'
    || value === 'diagnostics'
    || value === 'platform-data'
    || value === 'state'
    || (typeof value === 'string' && /^extension:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
}

function isExtensionAssetCapability(value: unknown): value is ExtensionAssetCapability {
  return value === 'assets.publish' || value === 'assets.read'
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
