import type { EventCapabilityCategory } from '@loom-studio/extension-host'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ExtensionDesiredState = {
  enabled: boolean
  grantedEventCapabilities: EventCapabilityCategory[]
  updatedAt: string
}

type PersistedExtensionState = {
  version: 1
  extensions: Record<string, {
    enabled: boolean
    grants: {
      'events.subscribe': EventCapabilityCategory[]
    }
    updatedAt: string
  }>
}

export type ExtensionStateStore = {
  load(): Promise<void>
  get(extensionId: string): ExtensionDesiredState | undefined
  set(extensionId: string, input: Omit<ExtensionDesiredState, 'updatedAt'>): Promise<ExtensionDesiredState>
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
    get: extensionId => {
      assertLoaded(loaded)
      const entry = state.extensions[extensionId]
      return entry ? toDesiredState(entry) : undefined
    },
    set: async (extensionId, input) => {
      assertLoaded(loaded)
      const updatedAt = options.now()
      const desired: ExtensionDesiredState = {
        enabled: input.enabled,
        grantedEventCapabilities: [...new Set(input.grantedEventCapabilities)],
        updatedAt,
      }

      const operation = writeQueue.then(async () => {
        const next: PersistedExtensionState = {
          version: 1,
          extensions: {
            ...state.extensions,
            [extensionId]: {
              enabled: desired.enabled,
              grants: { 'events.subscribe': [...desired.grantedEventCapabilities] },
              updatedAt,
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
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.extensions)) {
    throw new Error('Extension state must use version 1 with an extensions object')
  }

  const extensions: PersistedExtensionState['extensions'] = {}
  for (const [extensionId, entry] of Object.entries(value.extensions)) {
    if (!extensionId || !isRecord(entry) || typeof entry.enabled !== 'boolean' || !isRecord(entry.grants) || typeof entry.updatedAt !== 'string') {
      throw new Error(`Invalid extension state entry: ${extensionId}`)
    }
    const eventCapabilities = entry.grants['events.subscribe']
    if (!Array.isArray(eventCapabilities) || !eventCapabilities.every(isEventCapabilityCategory)) {
      throw new Error(`Invalid events.subscribe grants: ${extensionId}`)
    }
    extensions[extensionId] = {
      enabled: entry.enabled,
      grants: { 'events.subscribe': [...new Set(eventCapabilities)] },
      updatedAt: entry.updatedAt,
    }
  }

  return { version: 1, extensions }
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
  return { version: 1, extensions: {} }
}

function toDesiredState(entry: PersistedExtensionState['extensions'][string]): ExtensionDesiredState {
  return {
    enabled: entry.enabled,
    grantedEventCapabilities: [...entry.grants['events.subscribe']],
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
