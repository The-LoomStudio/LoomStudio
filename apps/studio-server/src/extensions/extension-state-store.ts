import type { EventCapabilityCategory, ExtensionAssetCapability } from '@loom-studio/extension-host'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ExtensionModuleDesiredState = {
  enabled: boolean
  grantedEventCapabilities: EventCapabilityCategory[]
  grantedAssetCapabilities: ExtensionAssetCapability[]
  updatedAt: string
}

type PersistedExtensionState = {
  version: 3
  packages: Record<string, {
    modules: Record<string, {
      enabled: boolean
      grants: {
        'events.subscribe': EventCapabilityCategory[]
        assets: ExtensionAssetCapability[]
      }
      updatedAt: string
    }>
  }>
}

export type ExtensionStateStore = {
  load(): Promise<void>
  get(packageId: string, moduleId: string): ExtensionModuleDesiredState | undefined
  set(
    packageId: string,
    moduleId: string,
    input: Omit<ExtensionModuleDesiredState, 'updatedAt'>,
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
    get: (packageId, moduleId) => {
      assertLoaded(loaded)
      const entry = state.packages[packageId]?.modules[moduleId]
      return entry ? toDesiredState(entry) : undefined
    },
    set: async (packageId, moduleId, input) => {
      assertLoaded(loaded)
      const updatedAt = options.now()
      const desired: ExtensionModuleDesiredState = {
        enabled: input.enabled,
        grantedEventCapabilities: [...new Set(input.grantedEventCapabilities)],
        grantedAssetCapabilities: [...new Set(input.grantedAssetCapabilities)],
        updatedAt,
      }

      const operation = writeQueue.then(async () => {
        const packageState = state.packages[packageId] ?? { modules: {} }
        const next: PersistedExtensionState = {
          version: 3,
          packages: {
            ...state.packages,
            [packageId]: {
              modules: {
                ...packageState.modules,
                [moduleId]: {
                  enabled: desired.enabled,
                  grants: {
                    'events.subscribe': [...desired.grantedEventCapabilities],
                    assets: [...desired.grantedAssetCapabilities],
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
  if (!isRecord(value) || (value.version !== 2 && value.version !== 3) || !isRecord(value.packages)) {
    throw new Error('Extension state must use version 2 or 3 with a packages object')
  }

  const packages: PersistedExtensionState['packages'] = {}
  for (const [packageId, packageEntry] of Object.entries(value.packages)) {
    if (!packageId || !isRecord(packageEntry) || !isRecord(packageEntry.modules)) {
      throw new Error(`Invalid extension package state: ${packageId}`)
    }
    const modules: PersistedExtensionState['packages'][string]['modules'] = {}
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
      modules[moduleId] = {
        enabled: entry.enabled,
        grants: {
          'events.subscribe': [...new Set(eventCapabilities)],
          assets: [...new Set(assetCapabilities)],
        },
        updatedAt: entry.updatedAt,
      }
    }
    packages[packageId] = { modules }
  }

  return { version: 3, packages }
}

async function writeState(filename: string, state: PersistedExtensionState): Promise<void> {
  await mkdir(dirname(filename), { recursive: true })
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, filename)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function emptyState(): PersistedExtensionState {
  return { version: 3, packages: {} }
}

function toDesiredState(entry: PersistedExtensionState['packages'][string]['modules'][string]): ExtensionModuleDesiredState {
  return {
    enabled: entry.enabled,
    grantedEventCapabilities: [...entry.grants['events.subscribe']],
    grantedAssetCapabilities: [...entry.grants.assets],
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
    || (typeof value === 'string' && /^extension:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
}

function isExtensionAssetCapability(value: unknown): value is ExtensionAssetCapability {
  return value === 'assets.publish' || value === 'assets.read'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
