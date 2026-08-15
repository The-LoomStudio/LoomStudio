import type { DataActorRef, DataCommitFact } from '@loom-studio/data-engine'
import type { Readable } from 'node:stream'

export type BlobRecord = {
  id: string
  sha256: string
  sizeBytes: number
  mediaType?: string
  createdAt: string
}

export type BlobWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type BlobWriteInput = BlobWriteContext & {
  source: Uint8Array | Readable
  mediaType?: string
  maxBytes?: number
}

export type BlobWriteResult = {
  blob: BlobRecord
  created: boolean
  commit?: DataCommitFact
}

export type BlobStore = {
  write(input: BlobWriteInput): Promise<BlobWriteResult>
  get(blobId: string): Promise<BlobRecord | undefined>
  getBySha256(sha256: string): Promise<BlobRecord | undefined>
  open(blobId: string): Promise<Readable>
  read(blobId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
}
