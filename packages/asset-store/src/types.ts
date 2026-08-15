import type { BlobStore } from '@loom-studio/blob-store'
import type { DataActorRef, DataCommitFact } from '@loom-studio/data-engine'
import type { Readable } from 'node:stream'

export type SourceArtifactRecord = {
  id: string
  blobId: string
  format: string
  originalFileName?: string
  mediaType?: string
  importedAt: string
  importerVersion?: string
}

export type MediaAssetRecord = {
  id: string
  blobId: string
  kind: string
  label?: string
  mediaType?: string
  sizeBytes: number
  width?: number
  height?: number
  ownerPackageId?: string
  createdBy: DataActorRef
  createdAt: string
}

export type AssetWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type PreserveSourceArtifactInput = AssetWriteContext & {
  source: Uint8Array | Readable
  format: string
  originalFileName?: string
  mediaType?: string
  importerVersion?: string
  maxBytes?: number
}

export type CreateMediaAssetInput = AssetWriteContext & {
  source?: Uint8Array | Readable
  blobId?: string
  kind: string
  label?: string
  mediaType?: string
  width?: number
  height?: number
  ownerPackageId?: string
  maxBytes?: number
}

export type SourceArtifactWriteResult = {
  artifact: SourceArtifactRecord
  commit: DataCommitFact
}

export type MediaAssetWriteResult = {
  asset: MediaAssetRecord
  commit: DataCommitFact
}

export type AssetStore = {
  readonly blobs: BlobStore
  preserveSourceArtifact(input: PreserveSourceArtifactInput): Promise<SourceArtifactWriteResult>
  getSourceArtifact(artifactId: string): Promise<SourceArtifactRecord | undefined>
  createMediaAsset(input: CreateMediaAssetInput): Promise<MediaAssetWriteResult>
  getMediaAsset(assetId: string): Promise<MediaAssetRecord | undefined>
  openMediaAsset(assetId: string): Promise<Readable>
  readMediaAsset(assetId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
}
