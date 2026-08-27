import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createDataCommitNotifier } from './commit.js'
import type {
  DataActorRef,
  DataCommitFact,
  DataCommitOperation,
  DataCommitObserver,
  DataCommitSubscription,
} from './commit.js'

const currentCoreSchemaVersion = 1

export class DataEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DataEngineError'
  }
}

export type SqliteDataEngineOptions = {
  filename: string
  createId(prefix: string): string
  now(): string
}

export type SqliteMigration = {
  version: number
  migrate(database: DatabaseSync): void
}

export type SqliteMigrationSet = {
  namespace: string
  migrations: SqliteMigration[]
}

export type DataTransactionInput = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type SqliteDataTransaction = {
  readonly database: DatabaseSync
  readonly changesetId: string
  readonly createdAt: string
  readonly actor: DataActorRef
  readonly reason?: string
  readonly correlationId?: string
  readonly callId?: string
  readonly parentCallId?: string
  recordOperations(operations: DataCommitOperation[]): void
}

export type SqliteDataEngine = {
  readonly database: DatabaseSync
  migrate(set: SqliteMigrationSet): void
  read<T>(operation: (database: DatabaseSync) => Promise<T> | T): Promise<T>
  transact<T>(
    input: DataTransactionInput,
    operation: (tx: SqliteDataTransaction) => Promise<T>,
  ): Promise<{ value: T; commit: DataCommitFact }>
  subscribeCommits(observer: DataCommitObserver): DataCommitSubscription
  close(): void
}

export function createSqliteDataEngine(options: SqliteDataEngineOptions): SqliteDataEngine {
  if (options.filename !== ':memory:') {
    mkdirSync(dirname(options.filename), { recursive: true })
  }

  const database = new DatabaseSync(options.filename)
  try {
    initializeCoreSchema(database)
  } catch (error) {
    database.close()
    throw error
  }

  const commitNotifier = createDataCommitNotifier<DataCommitFact>()
  const activeTransactionContext = new AsyncLocalStorage<SqliteDataTransaction>()
  let operationQueue = Promise.resolve()
  let isClosed = false

  function assertOpen(): void {
    if (isClosed) {
      throw new DataEngineError('data.engine_closed', 'Data engine is closed')
    }
  }

  function assertNonReentrant(): void {
    if (activeTransactionContext.getStore()) {
      throw new DataEngineError(
        'data.reentrant_transaction',
        'Reentrant call to data engine read/transact inside an active transaction is forbidden. Use the transaction instance directly.',
      )
    }
  }

  async function serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    // ponytail: One FIFO protects the single SQLite connection; reentrancy is guarded by AsyncLocalStorage fail-fast.
    assertOpen()
    assertNonReentrant()
    const result = operationQueue.then(() => {
      assertOpen()
      return operation()
    })
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    database,
    migrate: set => {
      assertOpen()
      migrateNamespace(database, set)
    },
    read: operation => serialize(() => operation(database)),
    transact: (input, operation) => serialize(async () => {
      const changesetId = options.createId('chg')
      const createdAt = options.now()
      const operations: DataCommitOperation[] = []
      database.exec('BEGIN IMMEDIATE')

      try {
        const tx: SqliteDataTransaction = {
          database,
          changesetId,
          createdAt,
          actor: structuredClone(input.actor) as DataActorRef,
          reason: input.reason,
          correlationId: input.correlationId,
          callId: input.callId,
          parentCallId: input.parentCallId,
          recordOperations: recorded => operations.push(...structuredClone(recorded) as DataCommitOperation[]),
        }

        const value = await activeTransactionContext.run(tx, () => operation(tx))

        if (operations.length === 0) {
          throw new DataEngineError('data.transaction_empty', 'Data transaction produced no changes')
        }

        const commit: DataCommitFact = {
          changesetId,
          createdAt,
          committedAt: options.now(),
          actor: structuredClone(input.actor) as DataActorRef,
          reason: input.reason,
          correlationId: input.correlationId,
          callId: input.callId,
          parentCallId: input.parentCallId,
          operations,
        }
        insertCommit(database, commit)
        database.exec('COMMIT')
        commitNotifier.notify(commit)
        return { value, commit }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }),
    subscribeCommits: observer => commitNotifier.subscribe(observer),
    close: () => {
      if (isClosed) return
      isClosed = true
      database.close()
    },
  }
}

function initializeCoreSchema(database: DatabaseSync): void {
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;')
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        namespace TEXT PRIMARY KEY,
        version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS changesets (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        committed_at TEXT,
        created_by_json TEXT NOT NULL,
        reason TEXT,
        correlation_id TEXT,
        call_id TEXT,
        parent_call_id TEXT,
        operations_json TEXT NOT NULL
      );
    `)
    const changesetColumns = readTableColumns(database, 'changesets')
    ensureOptionalColumn(database, 'changesets', changesetColumns, 'committed_at', 'TEXT')
    ensureRequiredColumns('changesets', changesetColumns, [
      'id',
      'created_at',
      'created_by_json',
      'reason',
      'correlation_id',
      'call_id',
      'parent_call_id',
      'operations_json',
    ])
    const coreVersion = readMigrationVersion(database, 'platform.data-engine')
    if (coreVersion > currentCoreSchemaVersion) {
      throw new DataEngineError(
        'data.sqlite_schema_newer',
        `SQLite schema platform.data-engine@${coreVersion} is newer than supported version ${currentCoreSchemaVersion}`,
      )
    }
    writeMigrationVersion(database, 'platform.data-engine', currentCoreSchemaVersion)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function migrateNamespace(database: DatabaseSync, set: SqliteMigrationSet): void {
  const migrations = [...set.migrations].sort((left, right) => left.version - right.version)
  const supportedVersion = migrations.at(-1)?.version ?? 0
  const currentVersion = readMigrationVersion(database, set.namespace)

  if (currentVersion > supportedVersion) {
    throw new DataEngineError(
      'data.sqlite_schema_newer',
      `SQLite schema ${set.namespace}@${currentVersion} is newer than supported version ${supportedVersion}`,
    )
  }

  if (currentVersion === supportedVersion) return

  database.exec('BEGIN IMMEDIATE')
  try {
    let migratedVersion = currentVersion
    for (const migration of migrations) {
      if (migration.version <= migratedVersion) continue
      if (migration.version !== migratedVersion + 1) {
        throw new DataEngineError(
          'data.sqlite_migration_gap',
          `Missing SQLite migration for ${set.namespace} after version ${migratedVersion}`,
        )
      }
      migration.migrate(database)
      writeMigrationVersion(database, set.namespace, migration.version)
      migratedVersion = migration.version
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function insertCommit(database: DatabaseSync, commit: DataCommitFact): void {
  database
    .prepare('INSERT INTO changesets (id, created_at, committed_at, created_by_json, reason, correlation_id, call_id, parent_call_id, operations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      commit.changesetId,
      commit.createdAt,
      commit.committedAt,
      JSON.stringify(commit.actor),
      commit.reason ?? null,
      commit.correlationId ?? null,
      commit.callId ?? null,
      commit.parentCallId ?? null,
      JSON.stringify(commit.operations),
    )
}

function readMigrationVersion(database: DatabaseSync, namespace: string): number {
  const row = database
    .prepare('SELECT version FROM schema_migrations WHERE namespace = ?')
    .get(namespace) as { version?: number } | undefined
  return row?.version ?? 0
}

function writeMigrationVersion(database: DatabaseSync, namespace: string, version: number): void {
  database
    .prepare('INSERT INTO schema_migrations (namespace, version) VALUES (?, ?) ON CONFLICT(namespace) DO UPDATE SET version = excluded.version')
    .run(namespace, version)
}

function readTableColumns(database: DatabaseSync, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
  return new Set(rows.map(row => row.name).filter((name): name is string => typeof name === 'string'))
}

function ensureRequiredColumns(table: string, available: Set<string>, required: string[]): void {
  const missing = required.filter(column => !available.has(column))
  if (missing.length > 0) {
    throw new DataEngineError('data.sqlite_schema_invalid', `SQLite table ${table} is missing required columns: ${missing.join(', ')}`)
  }
}

function ensureOptionalColumn(database: DatabaseSync, table: string, available: Set<string>, column: string, definition: string): void {
  if (!available.has(column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    available.add(column)
  }
}
