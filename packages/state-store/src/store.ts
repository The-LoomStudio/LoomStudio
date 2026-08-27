import type {
  DataCommitOperation,
  SqliteDataEngine,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import { createId, nowIso, type JsonObject } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CreateStateRevisionInput,
  CreateStateRevisionResult,
  CreateStateScopeInput,
  SetGlobalStateHeadInput,
  StateRevision,
  StateScope,
  StateScopeKind,
  StateSnapshot,
  StateStore,
  StateTransaction,
  TombstoneStateScopeInput,
} from './types.js'

const migrationNamespace = 'application.state'

export class StateStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StateStoreError'
  }
}

export type CreateStateStoreOptions = {
  engine: SqliteDataEngine
  createId?(prefix: string): string
  now?(): string
}

export function createStateStore(options: CreateStateStoreOptions): StateStore {
  const { engine } = options
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso

  engine.migrate({
    namespace: migrationNamespace,
    migrations: [{ version: 1, migrate: migrateVersionOne }],
  })

  function transaction(tx: SqliteDataTransaction): StateTransaction {
    const { database } = tx

    return {
      createScope: input => {
        validateScopeInput(input)
        const timestamp = now()
        const scope: StateScope = {
          id: input.id ?? nextId('state-scope'),
          kind: input.kind,
          ownerId: input.ownerId,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        try {
          database.prepare(`
            INSERT INTO state_scopes (
              id, kind, owner_id, head_revision_id, created_at, updated_at, deleted_at
            ) VALUES (?, ?, ?, NULL, ?, ?, NULL)
          `).run(scope.id, scope.kind, scope.ownerId, scope.createdAt, scope.updatedAt)
        } catch (error) {
          if (isUniqueConstraint(error)) {
            throw new StateStoreError('state.scope_conflict', `State scope already exists: ${scope.kind}/${scope.ownerId}`)
          }
          throw error
        }
        tx.recordOperations([operation('create', scope.id, 'state.scope')])
        return scope
      },

      createRevision: input => createRevision(database, tx, input, nextId, now),

      setGlobalHead: input => {
        validateId(input.scopeId, 'scopeId')
        validateId(input.revisionId, 'revisionId')
        const scope = requireScopeById(database, input.scopeId)
        assertWritableScope(scope)
        if (scope.kind !== 'global') {
          throw new StateStoreError('state.scope_kind_invalid', `Timeline scope head is owned by Narrative Branch: ${scope.id}`)
        }
        const currentHead = scope.headRevisionId ?? null
        if (currentHead !== input.expectedRevisionId) {
          throw new StateStoreError('state.head_conflict', `Global state head conflict: ${scope.id}`)
        }
        const revision = requireRevision(database, input.revisionId)
        if (revision.scopeId !== scope.id) {
          throw new StateStoreError('state.revision_scope_mismatch', `State revision does not belong to scope: ${revision.id}`)
        }
        const updatedAt = now()
        database.prepare('UPDATE state_scopes SET head_revision_id = ?, updated_at = ? WHERE id = ?')
          .run(revision.id, updatedAt, scope.id)
        tx.recordOperations([operation('update', scope.id, 'state.scope')])
        return requireScopeById(database, scope.id)
      },

      tombstoneScope: input => tombstoneScope(database, tx, input, now),
    }
  }

  return {
    getScope: input => engine.read(database => readScope(database, input.kind, input.ownerId, input.includeDeleted)),
    getScopeById: (id, options) => engine.read(database => readScopeById(database, id, options?.includeDeleted)),
    getRevision: id => engine.read(database => readRevision(database, id)),
    getRevisionByIdempotencyKey: (scopeId, idempotencyKey) => engine.read(database => {
      validateId(scopeId, 'scopeId')
      validateId(idempotencyKey, 'idempotencyKey')
      return readRevisionByIdempotencyKey(database, scopeId, idempotencyKey)
    }),
    getGlobalSnapshot: (ownerId = 'workspace') => engine.read(database => readGlobalSnapshot(database, ownerId)),
    transaction,
    createScopeWithInitialRevision: async input => {
      const result = await engine.transact(input, async dataTx => {
        const stateTx = transaction(dataTx)
        const scope = stateTx.createScope(input.scope)
        const created = stateTx.createRevision({
          ...input.revision,
          scopeId: scope.id,
        })
        const updatedScope = input.scope.kind === 'global'
          ? stateTx.setGlobalHead({
              scopeId: scope.id,
              expectedRevisionId: null,
              revisionId: created.revision.id,
            })
          : scope
        return { scope: updatedScope, revision: created.revision }
      })
      return { snapshot: result.value, commit: result.commit }
    },
  }
}

function createRevision(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: CreateStateRevisionInput,
  nextId: (prefix: string) => string,
  now: () => string,
): CreateStateRevisionResult {
  validateId(input.scopeId, 'scopeId')
  validateOptionalId(input.parentRevisionId, 'parentRevisionId')
  validateOptionalId(input.idempotencyKey, 'idempotencyKey')
  validateJsonObject(input.snapshot, 'snapshot')
  validateOperations(input.operations)

  const scope = requireScopeById(database, input.scopeId)
  assertWritableScope(scope)
  if (input.parentRevisionId) {
    const parent = requireRevision(database, input.parentRevisionId)
    if (parent.scopeId !== scope.id) {
      throw new StateStoreError('state.revision_scope_mismatch', `Parent revision does not belong to scope: ${parent.id}`)
    }
  }

  if (input.idempotencyKey) {
    const replay = readRevisionByIdempotencyKey(database, scope.id, input.idempotencyKey)
    if (replay) {
      if (
        replay.parentRevisionId !== input.parentRevisionId
        || !jsonEquals(replay.snapshot, input.snapshot)
        || !jsonEquals(replay.operations, input.operations)
      ) {
        throw new StateStoreError('state.idempotency_conflict', `State idempotency key was reused with different content: ${input.idempotencyKey}`)
      }
      return { revision: replay, replayed: true }
    }
  }

  const revision: StateRevision = {
    id: input.id ?? nextId('state-revision'),
    scopeId: scope.id,
    parentRevisionId: input.parentRevisionId,
    changesetId: tx.changesetId,
    snapshot: structuredClone(input.snapshot),
    operations: structuredClone(input.operations),
    idempotencyKey: input.idempotencyKey,
    createdAt: now(),
  }
  database.prepare(`
    INSERT INTO state_revisions (
      id, scope_id, parent_revision_id, changeset_id,
      snapshot_json, operations_json, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revision.id,
    revision.scopeId,
    revision.parentRevisionId ?? null,
    revision.changesetId,
    JSON.stringify(revision.snapshot),
    JSON.stringify(revision.operations),
    revision.idempotencyKey ?? null,
    revision.createdAt,
  )
  tx.recordOperations([operation('create', revision.id, 'state.revision')])
  return { revision, replayed: false }
}

function tombstoneScope(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: TombstoneStateScopeInput,
  now: () => string,
): StateScope {
  validateId(input.scopeId, 'scopeId')
  const scope = requireScopeById(database, input.scopeId, true)
  if (scope.deletedAt) return scope
  const timestamp = now()
  database.prepare('UPDATE state_scopes SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(timestamp, timestamp, scope.id)
  tx.recordOperations([operation('delete', scope.id, 'state.scope')])
  return requireScopeById(database, scope.id, true)
}

function readGlobalSnapshot(database: DatabaseSync, ownerId: string): StateSnapshot | null {
  const scope = readScope(database, 'global', ownerId)
  if (!scope?.headRevisionId) return null
  return { scope, revision: requireRevision(database, scope.headRevisionId) }
}

function readScope(
  database: DatabaseSync,
  kind: StateScopeKind,
  ownerId: string,
  includeDeleted = false,
): StateScope | null {
  validateScopeKind(kind)
  validateId(ownerId, 'ownerId')
  const row = database.prepare(`
    SELECT id, kind, owner_id, head_revision_id, created_at, updated_at, deleted_at
    FROM state_scopes
    WHERE kind = ? AND owner_id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}
  `).get(kind, ownerId)
  return row ? mapScope(row) : null
}

function readScopeById(database: DatabaseSync, id: string, includeDeleted = false): StateScope | null {
  validateId(id, 'scopeId')
  const row = database.prepare(`
    SELECT id, kind, owner_id, head_revision_id, created_at, updated_at, deleted_at
    FROM state_scopes
    WHERE id = ?${includeDeleted ? '' : ' AND deleted_at IS NULL'}
  `).get(id)
  return row ? mapScope(row) : null
}

function requireScopeById(database: DatabaseSync, id: string, includeDeleted = false): StateScope {
  const scope = readScopeById(database, id, includeDeleted)
  if (!scope) throw new StateStoreError('state.scope_not_found', `State scope not found: ${id}`)
  return scope
}

function readRevision(database: DatabaseSync, id: string): StateRevision | null {
  validateId(id, 'revisionId')
  const row = database.prepare(`
    SELECT id, scope_id, parent_revision_id, changeset_id,
           snapshot_json, operations_json, idempotency_key, created_at
    FROM state_revisions
    WHERE id = ?
  `).get(id)
  return row ? mapRevision(row) : null
}

function requireRevision(database: DatabaseSync, id: string): StateRevision {
  const revision = readRevision(database, id)
  if (!revision) throw new StateStoreError('state.revision_not_found', `State revision not found: ${id}`)
  return revision
}

function readRevisionByIdempotencyKey(database: DatabaseSync, scopeId: string, key: string): StateRevision | null {
  const row = database.prepare(`
    SELECT id, scope_id, parent_revision_id, changeset_id,
           snapshot_json, operations_json, idempotency_key, created_at
    FROM state_revisions
    WHERE scope_id = ? AND idempotency_key = ?
  `).get(scopeId, key)
  return row ? mapRevision(row) : null
}

function mapScope(value: unknown): StateScope {
  const row = value as Record<string, unknown>
  const kind = String(row.kind)
  validateScopeKind(kind)
  return {
    id: String(row.id),
    kind,
    ownerId: String(row.owner_id),
    ...(row.head_revision_id === null ? {} : { headRevisionId: String(row.head_revision_id) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.deleted_at === null ? {} : { deletedAt: String(row.deleted_at) }),
  }
}

function mapRevision(value: unknown): StateRevision {
  const row = value as Record<string, unknown>
  return {
    id: String(row.id),
    scopeId: String(row.scope_id),
    ...(row.parent_revision_id === null ? {} : { parentRevisionId: String(row.parent_revision_id) }),
    changesetId: String(row.changeset_id),
    snapshot: parseJsonObject(row.snapshot_json, 'snapshot'),
    operations: parseOperations(row.operations_json),
    ...(row.idempotency_key === null ? {} : { idempotencyKey: String(row.idempotency_key) }),
    createdAt: String(row.created_at),
  }
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE state_scopes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('global', 'timeline')),
      owner_id TEXT NOT NULL,
      head_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(kind, owner_id),
      CHECK (kind = 'global' OR head_revision_id IS NULL)
    );

    CREATE TABLE state_revisions (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL REFERENCES state_scopes(id),
      parent_revision_id TEXT REFERENCES state_revisions(id),
      changeset_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      operations_json TEXT NOT NULL,
      idempotency_key TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_state_revisions_scope_idempotency
      ON state_revisions(scope_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE INDEX idx_state_revisions_scope_created
      ON state_revisions(scope_id, created_at, id);
    CREATE INDEX idx_state_revisions_parent
      ON state_revisions(parent_revision_id);
  `)
}

function validateScopeInput(input: CreateStateScopeInput): void {
  validateOptionalId(input.id, 'id')
  validateScopeKind(input.kind)
  validateId(input.ownerId, 'ownerId')
}

function validateScopeKind(value: unknown): asserts value is StateScopeKind {
  if (value !== 'global' && value !== 'timeline') {
    throw new StateStoreError('state.scope_kind_invalid', `Unsupported state scope kind: ${String(value)}`)
  }
}

function validateOperations(value: unknown): asserts value is JsonObject[] {
  if (!Array.isArray(value) || value.some(item => !isJsonObject(item))) {
    throw new StateStoreError('state.operations_invalid', 'State operations must be an array of JSON objects')
  }
}

function validateJsonObject(value: unknown, field: string): asserts value is JsonObject {
  if (!isJsonObject(value)) {
    throw new StateStoreError('state.snapshot_invalid', `State ${field} must be a JSON object`)
  }
  try {
    JSON.stringify(value)
  } catch {
    throw new StateStoreError('state.snapshot_invalid', `State ${field} must be JSON serializable`)
  }
}

function validateId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new StateStoreError('state.input_invalid', `${field} must be a non-empty string`)
  }
}

function validateOptionalId(value: unknown, field: string): void {
  if (value !== undefined) validateId(value, field)
}

function assertWritableScope(scope: StateScope): void {
  if (scope.deletedAt) throw new StateStoreError('state.scope_deleted', `State scope is deleted: ${scope.id}`)
}

function parseJsonObject(value: unknown, field: string): JsonObject {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (!isJsonObject(parsed)) throw new Error()
    return parsed
  } catch {
    throw new StateStoreError('state.data_invalid', `State ${field} JSON is invalid`)
  }
}

function parseOperations(value: unknown): JsonObject[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    validateOperations(parsed)
    return parsed
  } catch (error) {
    if (error instanceof StateStoreError) throw error
    throw new StateStoreError('state.data_invalid', 'State operations JSON is invalid')
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed')
}

function operation(kind: DataCommitOperation['kind'], entityId: string, entityType: string): DataCommitOperation {
  return { store: 'state', kind, entityId, entityType }
}
