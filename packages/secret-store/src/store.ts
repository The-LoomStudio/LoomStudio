import type { DataCommitFact, SqliteDataEngine } from '@loom-studio/data-engine'
import type {
  SecretBackend,
  SecretMetadata,
  SecretOwner,
  SecretPlaintext,
  SecretRef,
  SecretStore,
  SecretUseContext,
  SecretWriteContext,
} from './types.js'

const migrationNamespace = 'platform.secret-store'
const maximumPlaintextBytes = 64 * 1024

type StoredSecretMetadata = SecretMetadata & { backendKey: string }

export class SecretStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SecretStoreError'
  }
}

export function createSecretStore(options: {
  engine: SqliteDataEngine
  backend: SecretBackend
  createId(prefix: string): string
  now(): string
  authorizeUse(metadata: SecretMetadata, context: SecretUseContext): Promise<boolean> | boolean
}): SecretStore {
  options.engine.migrate({
    namespace: migrationNamespace,
    migrations: [{ version: 1, migrate: migrateVersionOne }],
  })

  return {
    create: input => createSecret(options, input),
    replace: input => replaceSecret(options, input),
    getMetadata: ref => options.engine.read(database => {
      const metadata = readStoredMetadata(database, ref)
      return metadata ? toPublicMetadata(metadata) : undefined
    }),
    delete: input => deleteSecret(options, input),
    withSecret: (ref, context, operation) => withSecret(options, ref, context, operation),
    retryPendingCleanup: context => retryPendingCleanup(options, context),
  }
}

async function createSecret(
  options: SecretStoreOptions,
  input: SecretWriteContext & { owner: SecretOwner; purpose: string; label?: string; plaintext: SecretPlaintext },
): Promise<{ metadata: SecretMetadata; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
  assertOwner(input.owner)
  assertNonEmpty(input.purpose, 'purpose')
  assertPlaintext(input.plaintext)
  const id = options.createId('secret')
  const ref = toSecretRef(id)
  const backendKey = options.createId('secret-bytes')
  const timestamp = options.now()
  const metadata: StoredSecretMetadata = {
    ref,
    owner: structuredClone(input.owner),
    purpose: input.purpose.trim(),
    label: normalizeLabel(input.label),
    state: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    backendKey,
  }

  await writeBackend(options.backend, backendKey, input.plaintext)
  try {
    const result = await options.engine.transact(toTransactionInput(input, 'secret.create'), async tx => {
      tx.database.prepare(`
        INSERT INTO secret_metadata (id, owner_type, owner_id, purpose, label, backend_key, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(id, metadata.owner.type, metadata.owner.id, metadata.purpose, metadata.label ?? null, backendKey, timestamp, timestamp)
      tx.recordOperations([{ store: 'secrets', kind: 'create', entityId: id, entityType: 'platform.secret.metadata', toVersion: 1 }])
      return toPublicMetadata(metadata)
    })
    return { metadata: result.value, commit: result.commit }
  } catch (error) {
    await queueOrDeleteUnreferencedBackendKey(options, id, backendKey, input)
    throw error
  }
}

async function replaceSecret(
  options: SecretStoreOptions,
  input: SecretWriteContext & { ref: SecretRef; owner: SecretOwner; plaintext: SecretPlaintext },
): Promise<{ metadata: SecretMetadata; cleanupPending: boolean; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
  assertPlaintext(input.plaintext)
  const existing = await requireOwnedActiveSecret(options.engine, input.ref, input.owner)
  const newBackendKey = options.createId('secret-bytes')
  const timestamp = options.now()
  await writeBackend(options.backend, newBackendKey, input.plaintext)

  let result: { value: StoredSecretMetadata | undefined; commit: DataCommitFact }
  try {
    result = await options.engine.transact(toTransactionInput(input, 'secret.replace'), async tx => {
      const update = tx.database.prepare(`
        UPDATE secret_metadata SET backend_key = ?, updated_at = ?
        WHERE id = ? AND backend_key = ? AND state = 'active'
      `).run(newBackendKey, timestamp, secretId(input.ref), existing.backendKey)
      if (Number(update.changes) !== 1) throw new SecretStoreError('secret.concurrent_change', 'Secret changed during replacement')
      tx.database.prepare('INSERT OR IGNORE INTO secret_backend_cleanup (backend_key, secret_id, queued_at) VALUES (?, ?, ?)')
        .run(existing.backendKey, secretId(input.ref), timestamp)
      tx.recordOperations([{
        store: 'secrets',
        kind: 'update',
        entityId: secretId(input.ref),
        entityType: 'platform.secret.metadata',
        fromVersion: 1,
        toVersion: 1,
      }])
      return readStoredMetadata(tx.database, input.ref)
    })
  } catch (error) {
    await queueOrDeleteUnreferencedBackendKey(options, secretId(input.ref), newBackendKey, input)
    throw error
  }
  if (!result.value) throw new SecretStoreError('secret.not_found', 'Secret metadata disappeared during replacement')
  const cleaned = await drainCleanupKey(options, existing.backendKey, input)
  return { metadata: toPublicMetadata(result.value), cleanupPending: !cleaned, commit: result.commit }
}

async function deleteSecret(
  options: SecretStoreOptions,
  input: SecretWriteContext & { ref: SecretRef; owner: SecretOwner },
): Promise<{ deleted: boolean; cleanupPending: boolean; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
  const existing = await requireOwnedActiveSecret(options.engine, input.ref, input.owner)
  const timestamp = options.now()
  const pending = await options.engine.transact(toTransactionInput(input, 'secret.delete.pending'), async tx => {
    const update = tx.database.prepare(`
      UPDATE secret_metadata SET state = 'pending-delete', updated_at = ?
      WHERE id = ? AND backend_key = ? AND state = 'active'
    `).run(timestamp, secretId(input.ref), existing.backendKey)
    if (Number(update.changes) !== 1) throw new SecretStoreError('secret.concurrent_change', 'Secret changed during deletion')
    tx.database.prepare('INSERT OR IGNORE INTO secret_backend_cleanup (backend_key, secret_id, queued_at) VALUES (?, ?, ?)')
      .run(existing.backendKey, secretId(input.ref), timestamp)
    tx.recordOperations([{
      store: 'secrets',
      kind: 'update',
      entityId: secretId(input.ref),
      entityType: 'platform.secret.metadata',
      fromVersion: 1,
      toVersion: 1,
    }])
    return undefined
  })
  const cleaned = await drainCleanupKey(options, existing.backendKey, input)
  return { deleted: cleaned, cleanupPending: !cleaned, commit: pending.commit }
}

async function withSecret<T>(
  options: SecretStoreOptions,
  ref: SecretRef,
  context: SecretUseContext,
  operation: (plaintext: SecretPlaintext) => Promise<T>,
): Promise<T> {
  const metadata = await options.engine.read(database => readStoredMetadata(database, ref))
  if (!metadata || metadata.state !== 'active') throw new SecretStoreError('secret.not_found', 'Secret is unavailable')
  if (!sameOwner(metadata.owner, context.owner) || metadata.purpose !== context.purpose) {
    throw new SecretStoreError('secret.scope_mismatch', 'Secret use does not match its owner and purpose')
  }
  if (!await options.authorizeUse(toPublicMetadata(metadata), context)) {
    throw new SecretStoreError('secret.access_denied', 'Secret use was denied')
  }
  const plaintext = await readBackend(options.backend, metadata.backendKey)
  if (!plaintext) throw new SecretStoreError('secret.bytes_missing', 'Secret bytes are unavailable')
  return await operation(clonePlaintext(plaintext))
}

async function retryPendingCleanup(options: SecretStoreOptions, context: SecretWriteContext): Promise<number> {
  const keys = await options.engine.read(database => database.prepare('SELECT backend_key FROM secret_backend_cleanup ORDER BY queued_at').all() as Array<{ backend_key: string }>)
  let cleaned = 0
  for (const row of keys) {
    if (await drainCleanupKey(options, row.backend_key, context)) cleaned += 1
  }
  return cleaned
}

async function drainCleanupKey(options: SecretStoreOptions, backendKey: string, context: SecretWriteContext): Promise<boolean> {
  try {
    await options.backend.delete(backendKey)
  } catch {
    return false
  }
  const queued = await options.engine.read(database => database.prepare('SELECT secret_id FROM secret_backend_cleanup WHERE backend_key = ?').get(backendKey) as { secret_id?: string } | undefined)
  if (!queued?.secret_id) return true
  const queuedSecretId = queued.secret_id
  try {
    await options.engine.transact(toTransactionInput(context, 'secret.cleanup'), async tx => {
      const pending = tx.database.prepare(`
        SELECT id FROM secret_metadata WHERE id = ? AND backend_key = ? AND state = 'pending-delete'
      `).get(queuedSecretId, backendKey) as { id?: string } | undefined
      if (pending?.id) tx.database.prepare('DELETE FROM secret_metadata WHERE id = ?').run(pending.id)
      tx.database.prepare('DELETE FROM secret_backend_cleanup WHERE backend_key = ?').run(backendKey)
      tx.recordOperations([{
        store: pending?.id ? 'secrets' : 'secret-cleanup',
        kind: 'delete',
        entityId: pending?.id ?? backendKey,
        entityType: pending?.id ? 'platform.secret.metadata' : 'platform.secret.backend-cleanup',
        ...(pending?.id ? { fromVersion: 1 } : {}),
      }])
      return undefined
    })
    return true
  } catch {
    return false
  }
}

async function queueOrDeleteUnreferencedBackendKey(
  options: SecretStoreOptions,
  secretIdValue: string,
  backendKey: string,
  context: SecretWriteContext,
): Promise<void> {
  try {
    await options.backend.delete(backendKey)
    return
  } catch {
    // Keep the backend identifier only; plaintext never enters SQLite or the commit payload.
  }
  await options.engine.transact(toTransactionInput(context, 'secret.cleanup.queue'), async tx => {
    tx.database.prepare('INSERT OR IGNORE INTO secret_backend_cleanup (backend_key, secret_id, queued_at) VALUES (?, ?, ?)')
      .run(backendKey, secretIdValue, options.now())
    tx.recordOperations([{
      store: 'secret-cleanup',
      kind: 'create',
      entityId: backendKey,
      entityType: 'platform.secret.backend-cleanup',
      toVersion: 1,
    }])
    return undefined
  }).then(() => undefined, () => undefined)
}

async function requireOwnedActiveSecret(engine: SqliteDataEngine, ref: SecretRef, owner: SecretOwner): Promise<StoredSecretMetadata> {
  assertOwner(owner)
  const metadata = await engine.read(database => readStoredMetadata(database, ref))
  if (!metadata || metadata.state !== 'active') throw new SecretStoreError('secret.not_found', 'Secret is unavailable')
  if (!sameOwner(metadata.owner, owner)) throw new SecretStoreError('secret.owner_mismatch', 'Secret does not belong to this owner')
  return metadata
}

function migrateVersionOne(database: SqliteDataEngine['database']): void {
  database.exec(`
    CREATE TABLE secret_metadata (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      label TEXT,
      backend_key TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK (state IN ('active', 'pending-delete')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_secret_metadata_owner ON secret_metadata(owner_type, owner_id);

    CREATE TABLE secret_backend_cleanup (
      backend_key TEXT PRIMARY KEY,
      secret_id TEXT NOT NULL,
      queued_at TEXT NOT NULL
    );
  `)
}

function readStoredMetadata(database: SqliteDataEngine['database'], ref: SecretRef): StoredSecretMetadata | undefined {
  const row = database.prepare(`
    SELECT id, owner_type, owner_id, purpose, label, backend_key, state, created_at, updated_at
    FROM secret_metadata WHERE id = ?
  `).get(secretId(ref)) as Record<string, unknown> | undefined
  if (!row) return undefined
  if (
    typeof row.id !== 'string'
    || typeof row.owner_type !== 'string'
    || typeof row.owner_id !== 'string'
    || typeof row.purpose !== 'string'
    || typeof row.backend_key !== 'string'
    || (row.state !== 'active' && row.state !== 'pending-delete')
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) throw new SecretStoreError('secret.metadata_invalid', 'Stored Secret metadata is invalid')
  return {
    ref: toSecretRef(row.id),
    owner: { type: row.owner_type, id: row.owner_id },
    purpose: row.purpose,
    label: typeof row.label === 'string' ? row.label : undefined,
    backendKey: row.backend_key,
    state: row.state === 'active' ? 'active' : 'pending-delete',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toPublicMetadata(metadata: StoredSecretMetadata): SecretMetadata {
  return structuredClone({
    ref: metadata.ref,
    owner: metadata.owner,
    purpose: metadata.purpose,
    label: metadata.label,
    state: metadata.state,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  }) as SecretMetadata
}

function toSecretRef(id: string): SecretRef {
  assertNonEmpty(id, 'secret id')
  return `secret:${id}`
}

function secretId(ref: SecretRef): string {
  const id = typeof ref === 'string' && ref.startsWith('secret:') ? ref.slice('secret:'.length) : ''
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(id)) {
    throw new SecretStoreError('secret.invalid_ref', 'Secret reference is invalid')
  }
  return id
}

function assertOwner(owner: SecretOwner): void {
  assertNonEmpty(owner.type, 'owner.type')
  assertNonEmpty(owner.id, 'owner.id')
}

function assertPlaintext(plaintext: SecretPlaintext): void {
  if (!plaintext || typeof plaintext !== 'object' || !plaintext.values || typeof plaintext.values !== 'object' || Array.isArray(plaintext.values)) {
    throw new SecretStoreError('secret.invalid_plaintext', 'Secret plaintext must contain a string value record')
  }
  const entries = Object.entries(plaintext.values)
  if (
    entries.length === 0
    || entries.length > 64
    || entries.some(([key, value]) => !/^[A-Za-z0-9._-]{1,128}$/.test(key) || typeof value !== 'string')
  ) {
    throw new SecretStoreError('secret.invalid_plaintext', 'Secret plaintext values must contain non-empty keys and string values')
  }
  if (Buffer.byteLength(JSON.stringify(plaintext), 'utf8') > maximumPlaintextBytes) {
    throw new SecretStoreError('secret.too_large', `Secret plaintext exceeds ${maximumPlaintextBytes} bytes`)
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new SecretStoreError('secret.invalid_input', `Secret ${label} cannot be empty`)
}

function normalizeLabel(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function sameOwner(left: SecretOwner, right: SecretOwner): boolean {
  return left.type === right.type && left.id === right.id
}

function clonePlaintext(plaintext: SecretPlaintext): SecretPlaintext {
  return Object.freeze({ values: Object.freeze({ ...plaintext.values }) })
}

async function writeBackend(backend: SecretBackend, key: string, plaintext: SecretPlaintext): Promise<void> {
  try {
    await backend.write(key, clonePlaintext(plaintext))
  } catch {
    throw new SecretStoreError('secret.backend_write_failed', 'Secret backend write failed')
  }
}

async function readBackend(backend: SecretBackend, key: string): Promise<SecretPlaintext | undefined> {
  try {
    return await backend.read(key)
  } catch {
    throw new SecretStoreError('secret.backend_read_failed', 'Secret backend read failed')
  }
}

function toTransactionInput(context: SecretWriteContext, defaultReason: string) {
  return {
    actor: context.actor,
    reason: context.reason ?? defaultReason,
    correlationId: context.correlationId,
    callId: context.callId,
    parentCallId: context.parentCallId,
  }
}

type SecretStoreOptions = {
  engine: SqliteDataEngine
  backend: SecretBackend
  createId(prefix: string): string
  now(): string
  authorizeUse(metadata: SecretMetadata, context: SecretUseContext): Promise<boolean> | boolean
}
