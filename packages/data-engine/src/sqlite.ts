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

export type SqliteSchema = {
  namespace: string
  version: number
  initialize(database: DatabaseSync): void
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
  initializeSchema(schema: SqliteSchema): void
  read<T>(operation: (database: DatabaseSync) => Promise<T> | T): Promise<T>
  /** Runs nested store reads on one SQLite snapshot; writes inside the callback are forbidden. */
  readSnapshot<T>(operation: () => Promise<T>): Promise<T>
  withTransactionGuard<T>(guard: (tx: SqliteDataTransaction) => Promise<void>, work: () => T): T
  transact<T>(
    input: DataTransactionInput,
    operation: (tx: SqliteDataTransaction) => Promise<T>,
  ): Promise<{ value: T; commit: DataCommitFact }>
  subscribeCommits(observer: DataCommitObserver): DataCommitSubscription
  close(): Promise<void>
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
  const activeSnapshotContext = new AsyncLocalStorage<{ active: boolean }>()
  const activeTransactionContext = new AsyncLocalStorage<SqliteDataTransaction>()
  const transactionGuards = new AsyncLocalStorage<ReadonlyArray<(tx: SqliteDataTransaction) => Promise<void>>>()
  let operationQueue = Promise.resolve()
  let isClosed = false
  let closePromise: Promise<void> | undefined

  function assertOpen(): void {
    if (isClosed || closePromise) {
      throw new DataEngineError('data.engine_closed', 'Data engine is closed')
    }
  }

  function assertNonReentrant(): void {
    if (activeSnapshotContext.getStore()?.active) {
      throw new DataEngineError('data.read_snapshot_write', 'Writes inside a read snapshot are forbidden')
    }
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
      return operation()
    })
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    database,
    initializeSchema: schema => {
      assertOpen()
      assertNonReentrant()
      initializeNamespace(database, schema)
    },
    read: async operation => {
      if (activeSnapshotContext.getStore()?.active) return operation(database)
      return serialize(() => operation(database))
    },
    readSnapshot: async operation => {
      if (activeSnapshotContext.getStore()?.active) return operation()
      return serialize(async () => {
        const snapshot = { active: true }
        database.exec('BEGIN')
        try {
          const value = await activeSnapshotContext.run(snapshot, operation)
          database.exec('COMMIT')
          return value
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        } finally {
          snapshot.active = false
        }
      })
    },
    withTransactionGuard: (guard, work) => transactionGuards.run(
      [...(transactionGuards.getStore() ?? []), guard], work,
    ),
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

        const value = await activeTransactionContext.run(tx, async () => {
          const guards = transactionGuards.getStore() ?? []
          for (const guard of guards) await guard(tx)
          const result = await operation(tx)
          for (const guard of guards) await guard(tx)
          return result
        })

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
        // Observers start independent work; they must not inherit the writer's authority.
        transactionGuards.run([], () => commitNotifier.notify(commit))
        return { value, commit }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }),
    subscribeCommits: observer => commitNotifier.subscribe(observer),
    close: () => {
      if (closePromise) return closePromise
      closePromise = operationQueue.then(() => {
        isClosed = true
        database.close()
      })
      return closePromise
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
    ensureRequiredColumns('changesets', changesetColumns, [
      'id',
      'created_at',
      'committed_at',
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

function initializeNamespace(database: DatabaseSync, schema: SqliteSchema): void {
  const currentVersion = readMigrationVersion(database, schema.namespace)
  if (currentVersion === schema.version) return
  if (currentVersion !== 0) {
    throw new DataEngineError(
      'data.sqlite_schema_unsupported',
      `SQLite schema ${schema.namespace}@${currentVersion} is not supported; expected ${schema.version}`,
    )
  }
  database.exec('BEGIN IMMEDIATE')
  try {
    schema.initialize(database)
    writeMigrationVersion(database, schema.namespace, schema.version)
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
