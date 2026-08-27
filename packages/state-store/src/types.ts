import type {
  DataActorRef,
  DataCommitFact,
  SqliteDataTransaction,
} from '@loom-studio/data-engine'
import type { JsonObject } from '@loom-studio/shared'

export type StateScopeKind = 'global' | 'timeline'

export type StateScope = {
  id: string
  kind: StateScopeKind
  ownerId: string
  headRevisionId?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export type StateRevision = {
  id: string
  scopeId: string
  parentRevisionId?: string
  changesetId: string
  snapshot: JsonObject
  operations: JsonObject[]
  idempotencyKey?: string
  createdAt: string
}

export type StateSnapshot = {
  scope: StateScope
  revision: StateRevision
}

export type StateWriteContext = {
  actor: DataActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type CreateStateScopeInput = {
  id?: string
  kind: StateScopeKind
  ownerId: string
}

export type CreateStateRevisionInput = {
  id?: string
  scopeId: string
  parentRevisionId?: string
  snapshot: JsonObject
  operations: JsonObject[]
  idempotencyKey?: string
}

export type SetGlobalStateHeadInput = {
  scopeId: string
  expectedRevisionId: string | null
  revisionId: string
}

export type TombstoneStateScopeInput = {
  scopeId: string
}

export type CreateStateRevisionResult = {
  revision: StateRevision
  replayed: boolean
}

export type StateTransaction = {
  createScope(input: CreateStateScopeInput): StateScope
  createRevision(input: CreateStateRevisionInput): CreateStateRevisionResult
  setGlobalHead(input: SetGlobalStateHeadInput): StateScope
  tombstoneScope(input: TombstoneStateScopeInput): StateScope
}

export type StateStore = {
  getScope(input: {
    kind: StateScopeKind
    ownerId: string
    includeDeleted?: boolean
  }): Promise<StateScope | null>
  getScopeById(id: string, options?: { includeDeleted?: boolean }): Promise<StateScope | null>
  getRevision(id: string): Promise<StateRevision | null>
  getRevisionByIdempotencyKey(scopeId: string, idempotencyKey: string): Promise<StateRevision | null>
  getGlobalSnapshot(ownerId?: string): Promise<StateSnapshot | null>
  transaction(tx: SqliteDataTransaction): StateTransaction
  createScopeWithInitialRevision(input: StateWriteContext & {
    scope: CreateStateScopeInput
    revision: Omit<CreateStateRevisionInput, 'scopeId' | 'parentRevisionId'>
  }): Promise<{ snapshot: StateSnapshot; commit: DataCommitFact }>
}
