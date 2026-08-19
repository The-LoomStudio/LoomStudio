import type { BlobStore } from '@loom-studio/blob-store'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AssetStore,
  MediaAssetRecord,
  SourceArtifactRecord,
} from './types.js'

const migrationNamespace = 'platform.asset-store'

export class AssetStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AssetStoreError'
  }
}

export function createAssetStore(options: {
  engine: SqliteDataEngine
  blobs: BlobStore
  createId(prefix: string): string
  now(): string
}): AssetStore {
  options.engine.migrate({
    namespace: migrationNamespace,
    migrations: [{ version: 1, migrate: migrateVersionOne }],
  })

  return {
    blobs: options.blobs,
    preserveSourceArtifact: async input => {
      const format = normalizeToken(input.format, 'artifact format')
      const originalFileName = normalizeOptionalText(input.originalFileName, 1024)
      const importerVersion = normalizeOptionalText(input.importerVersion, 255)
      const blobResult = await options.blobs.write({
        source: input.source,
        mediaType: input.mediaType,
        maxBytes: input.maxBytes,
        actor: input.actor,
        reason: `${input.reason ?? 'artifact.preserve'}.blob`,
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
      })
      const artifact: SourceArtifactRecord = {
        id: options.createId('artifact'),
        blobId: blobResult.blob.id,
        format,
        originalFileName,
        mediaType: blobResult.blob.mediaType,
        importedAt: options.now(),
        importerVersion,
      }
      const result = await options.engine.transact({
        actor: input.actor,
        reason: input.reason ?? 'artifact.preserve',
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
      }, async tx => {
        tx.database.prepare(`
          INSERT INTO source_artifacts (
            id, blob_id, format, original_file_name, media_type, imported_at, importer_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          artifact.id,
          artifact.blobId,
          artifact.format,
          artifact.originalFileName ?? null,
          artifact.mediaType ?? null,
          artifact.importedAt,
          artifact.importerVersion ?? null,
        )
        tx.recordOperations([{
          store: 'artifacts',
          kind: 'create',
          entityId: artifact.id,
          entityType: 'platform.source-artifact',
          toVersion: 1,
        }])
        return artifact
      })
      return { artifact: result.value, commit: result.commit }
    },
    getSourceArtifact: artifactId => options.engine.read(database => readSourceArtifact(database, artifactId)),
    createMediaAsset: async input => {
      if ((input.source === undefined) === (input.blobId === undefined)) {
        throw new AssetStoreError('asset.invalid_source', 'Media Asset requires exactly one of source or blobId')
      }
      const kind = normalizeToken(input.kind, 'asset kind')
      const label = normalizeOptionalText(input.label, 1024)
      const width = normalizeDimension(input.width, 'width')
      const height = normalizeDimension(input.height, 'height')
      const ownerPackageId = normalizeOptionalText(input.ownerPackageId, 255)

      const existingBlob = input.blobId
        ? await options.blobs.get(input.blobId)
        : undefined
      const blob = existingBlob ?? (await options.blobs.write({
        source: input.source!,
        mediaType: input.mediaType,
        maxBytes: input.maxBytes,
        actor: input.actor,
        reason: `${input.reason ?? 'asset.create'}.blob`,
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
      })).blob
      if (!blob) throw new AssetStoreError('asset.blob_not_found', `Blob not found: ${input.blobId}`)
      if (input.mediaType && blob.mediaType && input.mediaType.trim().toLowerCase() !== blob.mediaType) {
        throw new AssetStoreError('asset.media_type_mismatch', 'Media Asset media type does not match Blob metadata')
      }
      const asset: MediaAssetRecord = {
        id: options.createId('asset'),
        blobId: blob.id,
        kind,
        label,
        mediaType: blob.mediaType ?? normalizeOptionalText(input.mediaType?.trim().toLowerCase(), 255),
        sizeBytes: blob.sizeBytes,
        width,
        height,
        ownerPackageId,
        createdBy: structuredClone(input.actor),
        createdAt: options.now(),
      }
      const result = await options.engine.transact({
        actor: input.actor,
        reason: input.reason ?? 'asset.create',
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
      }, async tx => {
        tx.database.prepare(`
          INSERT INTO media_assets (
            id, blob_id, kind, label, media_type, size_bytes, width, height,
            owner_package_id, created_by_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          asset.id,
          asset.blobId,
          asset.kind,
          asset.label ?? null,
          asset.mediaType ?? null,
          asset.sizeBytes,
          asset.width ?? null,
          asset.height ?? null,
          asset.ownerPackageId ?? null,
          JSON.stringify(asset.createdBy),
          asset.createdAt,
        )
        tx.recordOperations([{
          store: 'assets',
          kind: 'create',
          entityId: asset.id,
          entityType: 'platform.media-asset',
          toVersion: 1,
        }])
        return asset
      })
      return { asset: result.value, commit: result.commit }
    },
    getMediaAsset: assetId => options.engine.read(database => readMediaAsset(database, assetId)),
    openMediaAsset: async assetId => {
      const asset = await options.engine.read(database => readMediaAsset(database, assetId))
      if (!asset) throw new AssetStoreError('asset.not_found', `Media Asset not found: ${assetId}`)
      return options.blobs.open(asset.blobId)
    },
    readMediaAsset: async (assetId, readOptions) => {
      const asset = await options.engine.read(database => readMediaAsset(database, assetId))
      if (!asset) throw new AssetStoreError('asset.not_found', `Media Asset not found: ${assetId}`)
      return options.blobs.read(asset.blobId, readOptions)
    },
  }
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE source_artifacts (
      id TEXT PRIMARY KEY,
      blob_id TEXT NOT NULL REFERENCES stored_blobs(id),
      format TEXT NOT NULL,
      original_file_name TEXT,
      media_type TEXT,
      imported_at TEXT NOT NULL,
      importer_version TEXT
    );

    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      blob_id TEXT NOT NULL REFERENCES stored_blobs(id),
      kind TEXT NOT NULL,
      label TEXT,
      media_type TEXT,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      width INTEGER CHECK (width IS NULL OR width > 0),
      height INTEGER CHECK (height IS NULL OR height > 0),
      owner_package_id TEXT,
      created_by_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_source_artifacts_blob ON source_artifacts(blob_id);
    CREATE INDEX idx_media_assets_blob ON media_assets(blob_id);
    CREATE INDEX idx_media_assets_owner ON media_assets(owner_package_id, created_at);
  `)
}

function readSourceArtifact(database: DatabaseSync, artifactId: string): SourceArtifactRecord | undefined {
  const row = database.prepare(`
    SELECT id, blob_id, format, original_file_name, media_type, imported_at, importer_version
    FROM source_artifacts WHERE id = ?
  `).get(artifactId) as Record<string, unknown> | undefined
  if (!row) return undefined
  return {
    id: readString(row, 'id'),
    blobId: readString(row, 'blob_id'),
    format: readString(row, 'format'),
    originalFileName: readOptionalString(row, 'original_file_name'),
    mediaType: readOptionalString(row, 'media_type'),
    importedAt: readString(row, 'imported_at'),
    importerVersion: readOptionalString(row, 'importer_version'),
  }
}

function readMediaAsset(database: DatabaseSync, assetId: string): MediaAssetRecord | undefined {
  const row = database.prepare(`
    SELECT id, blob_id, kind, label, media_type, size_bytes, width, height,
      owner_package_id, created_by_json, created_at
    FROM media_assets WHERE id = ?
  `).get(assetId) as Record<string, unknown> | undefined
  if (!row) return undefined
  const createdBy = JSON.parse(readString(row, 'created_by_json')) as unknown
  if (!isActor(createdBy)) throw new AssetStoreError('asset.metadata_invalid', `Invalid actor for Media Asset ${assetId}`)
  return {
    id: readString(row, 'id'),
    blobId: readString(row, 'blob_id'),
    kind: readString(row, 'kind'),
    label: readOptionalString(row, 'label'),
    mediaType: readOptionalString(row, 'media_type'),
    sizeBytes: readNumber(row, 'size_bytes'),
    width: readOptionalNumber(row, 'width'),
    height: readOptionalNumber(row, 'height'),
    ownerPackageId: readOptionalString(row, 'owner_package_id'),
    createdBy,
    createdAt: readString(row, 'created_at'),
  }
}

function normalizeToken(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 255 || !/^[A-Za-z0-9][A-Za-z0-9._/+:-]*$/.test(normalized)) {
    throw new AssetStoreError('asset.invalid_metadata', `Invalid ${label}: ${value}`)
  }
  return normalized
}

function normalizeOptionalText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  if (normalized.length > maxLength || normalized.includes('\0')) {
    throw new AssetStoreError('asset.invalid_metadata', 'Asset metadata text is invalid')
  }
  return normalized
}

function normalizeDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AssetStoreError('asset.invalid_dimension', `Media Asset ${label} must be a positive safe integer`)
  }
  return value
}

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new AssetStoreError('asset.metadata_invalid', `Invalid ${key}`)
  return value
}

function readOptionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  return readString(row, key)
}

function readNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  if (typeof value !== 'number') throw new AssetStoreError('asset.metadata_invalid', `Invalid ${key}`)
  return value
}

function readOptionalNumber(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  return readNumber(row, key)
}

function isActor(value: unknown): value is MediaAssetRecord['createdBy'] {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).id === 'string'
    && typeof (value as Record<string, unknown>).kind === 'string'
}
