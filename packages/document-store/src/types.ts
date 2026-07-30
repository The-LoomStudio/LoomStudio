import type { JsonValue } from '@loom-studio/shared'

export class DocumentStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DocumentStoreError'
  }
}

export type ActorRef = {
  kind: 'kernel' | 'client' | 'extension' | 'workspace-adapter' | 'system'
  id: string
}

export type DocumentSourceRef = {
  kind: 'workspace-file' | 'import-package' | 'generated' | 'manual' | string
  uri?: string
  adapterId?: string
  externalId?: string
}

export type TombstoneMeta = {
  deletedAt: string
  deletedBy: ActorRef
  reason?: string
}

export type DocumentMeta = {
  createdAt: string
  updatedAt: string
  createdBy: ActorRef
  updatedBy: ActorRef
  ownerExtensionId?: string
  source?: DocumentSourceRef
  tombstone?: TombstoneMeta
}

export type DocumentRecord<T = JsonValue> = {
  id: string
  type: string
  version: number
  content: T
  meta: DocumentMeta
}

export type ChangesetOperation = {
  kind: 'create' | 'update' | 'delete' | 'restore'
  documentId: string
  type: string
  fromVersion?: number
  toVersion: number
}

export type Changeset = {
  id: string
  createdAt: string
  createdBy: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  operations: ChangesetOperation[]
}

export type DocumentChangeSummary = {
  id: string
  type: string
  version: number
  tombstoned: boolean
}

export type DocumentCommitFact = {
  changeset: Changeset
  documents: DocumentChangeSummary[]
}

export type WriteDocumentInput = {
  id?: string
  type: string
  content: JsonValue
  meta?: Partial<DocumentMeta>
  expectedVersion?: number | 'new'
  reason?: string
  actor?: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type DeleteDocumentInput = {
  id: string
  expectedVersion?: number
  reason?: string
  actor?: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ListDocumentsInput = {
  type?: string
  includeTombstone?: boolean
  ownerExtensionId?: string
  limit?: number
  cursor?: string
}

export type PageResult<T> = {
  items: T[]
  nextCursor?: string
}

export type WriteDocumentResult = {
  changesetId: string
  documents: DocumentRecord[]
  operations: ChangesetOperation[]
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type DocumentCommitResult = WriteDocumentResult & {
  commit: DocumentCommitFact
}

export type DocumentTransactionInput = {
  actor: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type DocumentTransactionResult<T> = {
  value: T
  changeset: Changeset
  commit: DocumentCommitFact
}

export type RevertChangesetInput = DocumentTransactionInput & {
  changesetId: string
}

export type DocumentTransaction = {
  get(id: string, options?: { includeTombstone?: boolean; version?: number }): Promise<DocumentRecord | null>
  list(input?: ListDocumentsInput): Promise<PageResult<DocumentRecord>>
  write(input: WriteDocumentInput): Promise<WriteDocumentResult>
  delete(input: DeleteDocumentInput): Promise<WriteDocumentResult>
}

export type DocumentStore = Omit<DocumentTransaction, 'write' | 'delete'> & {
  write(input: WriteDocumentInput): Promise<DocumentCommitResult>
  delete(input: DeleteDocumentInput): Promise<DocumentCommitResult>
  transact<T>(input: DocumentTransactionInput, fn: (tx: DocumentTransaction) => Promise<T>): Promise<DocumentTransactionResult<T>>
  getChangeset(id: string): Promise<Changeset | null>
  revertChangeset(input: RevertChangesetInput): Promise<DocumentCommitResult>
}

export type SqliteDocumentStore = DocumentStore & {
  close(): void
}

export type SqliteDocumentStoreOptions = {
  filename: string
}
