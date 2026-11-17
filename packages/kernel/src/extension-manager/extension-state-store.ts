import {
  extensionInstallationId,
  type EventCapabilityCategory,
  type ExtensionAssetCapability,
  type ExtensionInstallationTarget,
} from '@loom-studio/extension-sdk'
import { isRecord } from '@loom-studio/shared'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { DataCommitOperation, SqliteDataEngine } from '../data-engine/index.js'
import { writeJsonAtomically } from '../platform/atomic-json.js'

const extensionStateNamespace = 'platform.extension-state'
const extensionStateSchemaVersion = 1
const extensionStateActor = { kind: 'kernel' as const, id: extensionStateNamespace }

type ExtensionStateMigrationSource = 'installations' | 'official-setup' | 'dev-links'

const extensionStateMigrationsTableSql = `
  CREATE TABLE IF NOT EXISTS extension_state_migrations (
    source TEXT PRIMARY KEY,
    migrated_at TEXT NOT NULL
  );
`

export function markExtensionStateSourceMigrated(
  database: SqliteDataEngine['database'],
  source: ExtensionStateMigrationSource,
  migratedAt: string,
): void {
  database.exec(extensionStateMigrationsTableSql)
  database
    .prepare('INSERT OR IGNORE INTO extension_state_migrations (source, migrated_at) VALUES (?, ?)')
    .run(source, migratedAt)
}

export type ExtensionModuleDesiredState = {
  enabled: boolean
  grantedEventCapabilities: EventCapabilityCategory[]
  grantedAssetCapabilities: ExtensionAssetCapability[]
  grantedUiCapabilities?: Array<'ui.notify'>
  updatedAt: string
}

export type OfficialExtensionSetupState = {
  completed?: boolean
  bundled?: string[]
}

export type ExtensionDevLinkRecord = {
  packageId: string
  directory: string
}

type PersistedModuleState = {
  enabled: boolean
  grants: {
    'events.subscribe': EventCapabilityCategory[]
    assets: ExtensionAssetCapability[]
    ui?: Array<'ui.notify'>
  }
  updatedAt: string
}

type PersistedExtensionState = {
  version: 4
  installations: Record<string, {
    modules: Record<string, PersistedModuleState>
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
  /** Reads the in-memory snapshot of official extension setup state; requires `load()` first. */
  readOfficialSetup(): OfficialExtensionSetupState | undefined
  writeOfficialSetup(next: OfficialExtensionSetupState): Promise<void>
}

export function initializeExtensionStateSchema(engine: SqliteDataEngine): void {
  engine.initializeSchema({
    namespace: extensionStateNamespace,
    version: extensionStateSchemaVersion,
    initialize: database => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS extension_installations (
          installation_id TEXT PRIMARY KEY,
          modules_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS extension_official_setup (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          setup_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS extension_dev_links (
          package_id TEXT PRIMARY KEY,
          directory TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        ${extensionStateMigrationsTableSql}
      `)
    },
  })
}

export function createExtensionStateStore(options: {
  engine?: SqliteDataEngine
  filename?: string
  officialSetupFile?: string
  devLinksFile?: string
  onBeforeMigrate?(): Promise<void>
  now(): string
}): ExtensionStateStore {
  if (options.engine) {
    initializeExtensionStateSchema(options.engine)
  }

  let state = emptyState()
  let officialSetupState: OfficialExtensionSetupState | undefined
  let loaded = false
  let loadPromise: Promise<void> | undefined
  let writeQueue = Promise.resolve()

  async function performLoad(): Promise<void> {
    if (!options.engine) {
      state = options.filename ? await readState(options.filename) : emptyState()
      officialSetupState = options.officialSetupFile ? await readOfficialSetupFile(options.officialSetupFile) : undefined
      loaded = true
      return
    }

    const engine = options.engine
    const snapshot = await engine.read(db => {
      const installationRows = db
        .prepare('SELECT installation_id, modules_json FROM extension_installations')
        .all() as Array<{ installation_id: string; modules_json: string }>
      const officialRow = db
        .prepare('SELECT setup_json FROM extension_official_setup WHERE id = 1')
        .get() as { setup_json: string } | undefined
      const devLinksCountRow = db
        .prepare('SELECT COUNT(*) AS count FROM extension_dev_links')
        .get() as { count: number }
      const hasMigrationsTable = Boolean(
        db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'extension_state_migrations'").get(),
      )
      const migratedSources = new Set(
        hasMigrationsTable
          ? (db.prepare('SELECT source FROM extension_state_migrations').all() as Array<{ source: string }>).map(row => row.source)
          : [],
      )
      return {
        installationRows,
        officialRow,
        hasDevLinks: devLinksCountRow.count > 0,
        migratedSources,
      }
    })

    let nextState = emptyState()
    let installationsToMigrate: PersistedExtensionState['installations'] | undefined
    if (snapshot.installationRows.length > 0) {
      for (const row of snapshot.installationRows) {
        const modules = parseInstallationModules(row.installation_id, JSON.parse(row.modules_json) as unknown)
        nextState.installations[row.installation_id] = { modules }
      }
    } else if (!snapshot.migratedSources.has('installations') && options.filename) {
      const migrated = await readState(options.filename)
      if (Object.keys(migrated.installations).length > 0) {
        nextState = migrated
        installationsToMigrate = migrated.installations
      }
    }

    let nextOfficialSetup: OfficialExtensionSetupState | undefined
    let officialToMigrate: OfficialExtensionSetupState | undefined
    if (snapshot.officialRow) {
      nextOfficialSetup = parseOfficialSetup(JSON.parse(snapshot.officialRow.setup_json) as unknown)
    } else if (!snapshot.migratedSources.has('official-setup') && options.officialSetupFile) {
      const migratedOfficial = await readOfficialSetupFile(options.officialSetupFile)
      if (migratedOfficial !== undefined) {
        nextOfficialSetup = migratedOfficial
        officialToMigrate = migratedOfficial
      }
    }

    let devLinksToMigrate: ExtensionDevLinkRecord[] | undefined
    if (!snapshot.hasDevLinks && !snapshot.migratedSources.has('dev-links') && options.devLinksFile) {
      const migratedLinks = await readExtensionDevLinksFile(options.devLinksFile)
      if (migratedLinks.length > 0) {
        devLinksToMigrate = migratedLinks
      }
    }

    if (installationsToMigrate || officialToMigrate !== undefined || devLinksToMigrate) {
      await options.onBeforeMigrate?.()
      const migratedAt = options.now()
      await engine.transact(
        { actor: extensionStateActor, reason: 'extension-state.migrate' },
        async tx => {
          const ops: DataCommitOperation[] = []
          if (installationsToMigrate) {
            const insertInstallation = tx.database.prepare(
              'INSERT OR IGNORE INTO extension_installations (installation_id, modules_json, updated_at) VALUES (?, ?, ?)',
            )
            for (const [installationId, entry] of Object.entries(installationsToMigrate)) {
              const updatedAt = latestModuleUpdatedAt(entry.modules, migratedAt)
              const info = insertInstallation.run(installationId, JSON.stringify(entry.modules), updatedAt)
              if (info.changes > 0) {
                ops.push({
                  store: 'extension-state',
                  kind: 'create',
                  entityId: installationId,
                  entityType: 'extension.installation',
                })
              }
            }
            markExtensionStateSourceMigrated(tx.database, 'installations', migratedAt)
          }
          if (officialToMigrate !== undefined) {
            const info = tx.database
              .prepare('INSERT OR IGNORE INTO extension_official_setup (id, setup_json, updated_at) VALUES (1, ?, ?)')
              .run(JSON.stringify(officialToMigrate), migratedAt)
            if (info.changes > 0) {
              ops.push({
                store: 'extension-state',
                kind: 'create',
                entityId: 'official-setup',
                entityType: 'extension.official-setup',
              })
            }
            markExtensionStateSourceMigrated(tx.database, 'official-setup', migratedAt)
          }
          if (devLinksToMigrate) {
            const insertDevLink = tx.database.prepare(
              'INSERT OR IGNORE INTO extension_dev_links (package_id, directory, created_at) VALUES (?, ?, ?)',
            )
            for (const link of devLinksToMigrate) {
              const info = insertDevLink.run(link.packageId, link.directory, migratedAt)
              if (info.changes > 0) {
                ops.push({
                  store: 'extension-state',
                  kind: 'create',
                  entityId: link.packageId,
                  entityType: 'extension.dev-link',
                })
              }
            }
            markExtensionStateSourceMigrated(tx.database, 'dev-links', migratedAt)
          }
          if (ops.length > 0) {
            tx.recordOperations(ops)
          }
        },
      )
    }

    state = nextState
    officialSetupState = nextOfficialSetup
    loaded = true
  }

  return {
    load: async () => {
      if (loaded) return
      if (loadPromise) return loadPromise
      loadPromise = performLoad().finally(() => {
        loadPromise = undefined
      })
      return loadPromise
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
        if (options.engine) {
          await options.engine.transact(
            { actor: extensionStateActor, reason: 'extension-state.delete-package' },
            async tx => {
              tx.database
                .prepare('DELETE FROM extension_installations WHERE installation_id = ?')
                .run(installationId)
              markExtensionStateSourceMigrated(tx.database, 'installations', options.now())
              tx.recordOperations([
                {
                  store: 'extension-state',
                  kind: 'delete',
                  entityId: installationId,
                  entityType: 'extension.installation',
                },
              ])
            },
          )
        } else if (options.filename) {
          await writeState(options.filename, next)
        } else {
          throw new Error('Extension state store requires engine or filename')
        }
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
        const existed = Boolean(state.installations[installationId])
        const installation = state.installations[installationId] ?? { modules: {} }
        const nextInstallation = {
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
        }
        const next: PersistedExtensionState = {
          version: 4,
          installations: {
            ...state.installations,
            [installationId]: nextInstallation,
          },
        }
        if (options.engine) {
          await options.engine.transact(
            { actor: extensionStateActor, reason: 'extension-state.set' },
            async tx => {
              tx.database
                .prepare(
                  'INSERT INTO extension_installations (installation_id, modules_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET modules_json = excluded.modules_json, updated_at = excluded.updated_at',
                )
                .run(installationId, JSON.stringify(nextInstallation.modules), updatedAt)
              markExtensionStateSourceMigrated(tx.database, 'installations', updatedAt)
              tx.recordOperations([
                {
                  store: 'extension-state',
                  kind: existed ? 'update' : 'create',
                  entityId: installationId,
                  entityType: 'extension.installation',
                },
              ])
            },
          )
        } else if (options.filename) {
          await writeState(options.filename, next)
        } else {
          throw new Error('Extension state store requires engine or filename')
        }
        state = next
      })
      writeQueue = operation.then(() => undefined, () => undefined)
      await operation
      return desired
    },
    readOfficialSetup: () => {
      assertLoaded(loaded)
      return officialSetupState ? cloneOfficialSetup(officialSetupState) : undefined
    },
    writeOfficialSetup: async next => {
      assertLoaded(loaded)
      const normalized = parseOfficialSetup(next)
      const updatedAt = options.now()
      const operation = writeQueue.then(async () => {
        const existed = officialSetupState !== undefined
        if (options.engine) {
          await options.engine.transact(
            { actor: extensionStateActor, reason: 'extension-state.official-setup.write' },
            async tx => {
              tx.database
                .prepare(
                  'INSERT INTO extension_official_setup (id, setup_json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET setup_json = excluded.setup_json, updated_at = excluded.updated_at',
                )
                .run(JSON.stringify(normalized), updatedAt)
              markExtensionStateSourceMigrated(tx.database, 'official-setup', updatedAt)
              tx.recordOperations([
                {
                  store: 'extension-state',
                  kind: existed ? 'update' : 'create',
                  entityId: 'official-setup',
                  entityType: 'extension.official-setup',
                },
              ])
            },
          )
        } else if (options.officialSetupFile) {
          await writeJsonAtomically(options.officialSetupFile, normalized)
        } else {
          throw new Error('Extension official setup storage is not configured')
        }
        officialSetupState = normalized
      })
      writeQueue = operation.then(() => undefined, () => undefined)
      await operation
    },
  }
}

export async function readExtensionDevLinksFile(filename: string): Promise<ExtensionDevLinkRecord[]> {
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return []
    throw error
  }

  const value = JSON.parse(source) as unknown
  if (!isRecord(value) || !Array.isArray(value.extensions)) {
    throw new Error('Extension dev links must contain an extensions array')
  }

  return value.extensions.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string' || !isAbsolute(entry.path)) {
      throw new Error(`Invalid extension dev link at index ${index}`)
    }
    return { packageId: entry.id, directory: entry.path }
  })
}

async function readOfficialSetupFile(filename: string): Promise<OfficialExtensionSetupState | undefined> {
  let source: string
  try {
    source = await readFile(filename, 'utf8')
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return undefined
    throw error
  }

  return parseOfficialSetup(JSON.parse(source) as unknown)
}

function parseOfficialSetup(value: unknown): OfficialExtensionSetupState {
  if (!isRecord(value)) {
    throw new Error('Official extension setup state must be an object')
  }
  if (value.completed !== undefined && typeof value.completed !== 'boolean') {
    throw new Error('Official extension setup completed flag must be a boolean')
  }
  if (value.bundled !== undefined && (!Array.isArray(value.bundled) || !value.bundled.every(item => typeof item === 'string'))) {
    throw new Error('Official extension setup bundled list must be an array of strings')
  }
  return {
    ...(value.completed !== undefined ? { completed: value.completed } : {}),
    ...(value.bundled !== undefined ? { bundled: [...value.bundled] } : {}),
  }
}

function cloneOfficialSetup(value: OfficialExtensionSetupState): OfficialExtensionSetupState {
  return {
    ...(value.completed !== undefined ? { completed: value.completed } : {}),
    ...(value.bundled !== undefined ? { bundled: [...value.bundled] } : {}),
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
    const id = value.version === 4 ? packageId : extensionInstallationId(packageId, { kind: 'global' })
    installations[id] = { modules: parseInstallationModules(packageId, packageEntry.modules) }
  }

  return { version: 4, installations }
}

function parseInstallationModules(packageId: string, modulesValue: unknown): Record<string, PersistedModuleState> {
  if (!isRecord(modulesValue)) {
    throw new Error(`Invalid extension package state: ${packageId}`)
  }
  const modules: Record<string, PersistedModuleState> = {}
  for (const [moduleId, entry] of Object.entries(modulesValue)) {
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
  return modules
}

function latestModuleUpdatedAt(modules: Record<string, PersistedModuleState>, fallback: string): string {
  let latest = ''
  for (const entry of Object.values(modules)) {
    if (entry.updatedAt > latest) latest = entry.updatedAt
  }
  return latest || fallback
}

async function writeState(filename: string, state: PersistedExtensionState): Promise<void> {
  await writeJsonAtomically(filename, state)
}

function emptyState(): PersistedExtensionState {
  return { version: 4, installations: {} }
}

function toDesiredState(entry: PersistedModuleState): ExtensionModuleDesiredState {
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
