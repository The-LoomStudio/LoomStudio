import type { SqliteDataEngine } from '@loom-studio/data-engine'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { BlobRecord, BlobStore, BlobWriteInput, BlobWriteResult } from './types.js'

const migrationNamespace = 'platform.blob-store'
const defaultMaxBytes = 256 * 1024 * 1024
const defaultReadMaxBytes = 32 * 1024 * 1024

export class BlobStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BlobStoreError'
  }
}

export function createBlobStore(options: {
  engine: SqliteDataEngine
  rootDirectory: string
  createId(prefix: string): string
  now(): string
  defaultMaxBytes?: number
}): BlobStore {
  options.engine.migrate({
    namespace: migrationNamespace,
    migrations: [{ version: 1, migrate: migrateVersionOne }],
  })
  let writeQueue = Promise.resolve()

  return {
    write: input => {
      // ponytail: Blob finalization is serialized per Store instance; multi-process writers rely on the SQLite unique hash constraint.
      const operation = writeQueue.then(
        () => writeBlob(options, input),
        () => writeBlob(options, input),
      )
      writeQueue = operation.then(() => undefined, () => undefined)
      return operation
    },
    get: blobId => options.engine.read(database => readBlob(database, blobId)),
    getBySha256: sha256 => {
      assertSha256(sha256)
      return options.engine.read(database => readBlobBySha256(database, sha256))
    },
    open: async blobId => {
      const blob = await options.engine.read(database => readBlob(database, blobId))
      if (!blob) throw new BlobStoreError('blob.not_found', `Blob not found: ${blobId}`)
      const filename = blobFilename(options.rootDirectory, blob.sha256)
      try {
        await access(filename)
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) {
          throw new BlobStoreError('blob.bytes_missing', `Blob bytes are missing: ${blobId}`)
        }
        throw error
      }
      return createReadStream(filename)
    },
    read: async (blobId, readOptions = {}) => {
      const maxBytes = readOptions.maxBytes ?? defaultReadMaxBytes
      const stream = await options.engine.read(database => {
        const blob = readBlob(database, blobId)
        if (!blob) throw new BlobStoreError('blob.not_found', `Blob not found: ${blobId}`)
        if (blob.sizeBytes > maxBytes) {
          throw new BlobStoreError('blob.read_too_large', `Blob ${blobId} exceeds read limit ${maxBytes}`)
        }
        return createReadStream(blobFilename(options.rootDirectory, blob.sha256))
      })
      const chunks: Buffer[] = []
      try {
        for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) {
          throw new BlobStoreError('blob.bytes_missing', `Blob bytes are missing: ${blobId}`)
        }
        throw error
      }
      return Buffer.concat(chunks)
    },
  }
}

async function writeBlob(
  options: {
    engine: SqliteDataEngine
    rootDirectory: string
    createId(prefix: string): string
    now(): string
    defaultMaxBytes?: number
  },
  input: BlobWriteInput,
): Promise<BlobWriteResult> {
  const maximum = input.maxBytes ?? options.defaultMaxBytes ?? defaultMaxBytes
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new BlobStoreError('blob.invalid_limit', 'Blob maxBytes must be a non-negative safe integer')
  }
  const stagingDirectory = join(options.rootDirectory, 'staging')
  const temporary = join(stagingDirectory, `${process.pid}-${randomUUID()}.tmp`)
  await mkdir(stagingDirectory, { recursive: true })

  let measured: { sha256: string; sizeBytes: number }
  try {
    measured = await writeStagingFile(input.source, temporary, maximum)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }

  const finalFilename = blobFilename(options.rootDirectory, measured.sha256)
  try {
    await mkdir(dirname(finalFilename), { recursive: true })
    try {
      await rename(temporary, finalFilename)
    } catch (error) {
      if (!isNodeError(error, 'EEXIST') && !isNodeError(error, 'ENOTEMPTY')) throw error
      await unlink(temporary)
    }

    const existing = await options.engine.read(database => readBlobBySha256(database, measured.sha256))
    if (existing) return { blob: existing, created: false }

    const blob: BlobRecord = {
      id: options.createId('blob'),
      sha256: measured.sha256,
      sizeBytes: measured.sizeBytes,
      mediaType: normalizeMediaType(input.mediaType),
      createdAt: options.now(),
    }
    try {
      const result = await options.engine.transact({
        actor: input.actor,
        reason: input.reason ?? 'blob.write',
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
      }, async tx => {
        tx.database.prepare(`
          INSERT INTO stored_blobs (id, sha256, size_bytes, media_type, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(blob.id, blob.sha256, blob.sizeBytes, blob.mediaType ?? null, blob.createdAt)
        tx.recordOperations([{
          store: 'blobs',
          kind: 'create',
          entityId: blob.id,
          entityType: 'platform.blob',
          toVersion: 1,
        }])
        return blob
      })
      return { blob: result.value, created: true, commit: result.commit }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const raced = await options.engine.read(database => readBlobBySha256(database, measured.sha256))
      if (!raced) throw error
      return { blob: raced, created: false }
    }
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

async function writeStagingFile(
  source: Uint8Array | Readable,
  filename: string,
  maxBytes: number,
): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256')
  let sizeBytes = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.byteLength
      if (sizeBytes > maxBytes) {
        callback(new BlobStoreError('blob.too_large', `Blob exceeds write limit ${maxBytes}`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  const readable = source instanceof Readable ? source : Readable.from([source])
  await pipeline(readable, meter, createWriteStream(filename, { flags: 'wx', mode: 0o600 }))
  return { sha256: hash.digest('hex'), sizeBytes }
}

function migrateVersionOne(database: SqliteDataEngine['database']): void {
  database.exec(`
    CREATE TABLE stored_blobs (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      media_type TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_stored_blobs_created_at ON stored_blobs(created_at);
  `)
}

function readBlob(database: SqliteDataEngine['database'], blobId: string): BlobRecord | undefined {
  return toBlobRecord(database.prepare(`
    SELECT id, sha256, size_bytes, media_type, created_at
    FROM stored_blobs WHERE id = ?
  `).get(blobId))
}

function readBlobBySha256(database: SqliteDataEngine['database'], sha256: string): BlobRecord | undefined {
  return toBlobRecord(database.prepare(`
    SELECT id, sha256, size_bytes, media_type, created_at
    FROM stored_blobs WHERE sha256 = ?
  `).get(sha256))
}

function toBlobRecord(value: unknown): BlobRecord | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string'
    || typeof row.sha256 !== 'string'
    || typeof row.size_bytes !== 'number'
    || typeof row.created_at !== 'string'
  ) {
    throw new BlobStoreError('blob.metadata_invalid', 'Stored blob metadata is invalid')
  }
  return {
    id: row.id,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    mediaType: typeof row.media_type === 'string' ? row.media_type : undefined,
    createdAt: row.created_at,
  }
}

function blobFilename(rootDirectory: string, sha256: string): string {
  assertSha256(sha256)
  return join(rootDirectory, 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), sha256)
}

function assertSha256(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new BlobStoreError('blob.invalid_sha256', 'Blob SHA-256 must be 64 lowercase hexadecimal characters')
  }
}

function normalizeMediaType(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized.length > 255 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)) {
    throw new BlobStoreError('blob.invalid_media_type', `Invalid media type: ${value}`)
  }
  return normalized
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: stored_blobs\.sha256/.test(error.message)
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
