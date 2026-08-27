import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { Changeset, SqliteDocumentStore } from '@loom-studio/document-store'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { ApplicationRuntimeContext } from './application-context.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments } from './document-store.js'
import { validateStateValue } from './state-definition.js'
import type {
  ApplyStateMutationInput,
  ApplyStateMutationResult,
  RuntimeRequestContext,
  StateMutationOperation,
  StateSnapshotView,
  StateTarget,
  StateDefinitionContent,
} from './types.js'

const globalOwnerId = 'workspace'

export class ApplicationStateError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApplicationStateError'
  }
}

export async function initializeGlobalState(ctx: ApplicationRuntimeContext): Promise<void> {
  if (await ctx.states.getScope({ kind: 'global', ownerId: globalOwnerId })) return
  await ctx.states.createScopeWithInitialRevision({
    actor: { kind: 'kernel', id: 'application-runtime' },
    reason: 'application.initializeGlobalState',
    scope: { kind: 'global', ownerId: globalOwnerId },
    revision: {
      snapshot: {},
      operations: [],
      idempotencyKey: 'application.initializeGlobalState',
    },
  })
}

export async function getApplicationStateSnapshot(
  ctx: ApplicationRuntimeContext,
  target: StateTarget,
): Promise<StateSnapshotView> {
  const snapshot = await readTargetSnapshot(ctx, target)
  return {
    scopeId: snapshot.scope.id,
    target,
    revisionId: snapshot.revision.id,
    value: structuredClone(snapshot.revision.snapshot),
    createdAt: snapshot.revision.createdAt,
  }
}

export async function applyApplicationStateMutation(
  ctx: ApplicationRuntimeContext,
  input: ApplyStateMutationInput,
  requestContext?: RuntimeRequestContext,
): Promise<ApplyStateMutationResult> {
  validateMutationInput(input)
  const current = await readTargetSnapshot(ctx, input.target)
  if (input.idempotencyKey) {
    const replay = await ctx.states.getRevisionByIdempotencyKey(current.scope.id, input.idempotencyKey)
    if (replay) {
      if (
        replay.parentRevisionId !== input.expectedRevisionId
        || JSON.stringify(replay.operations) !== JSON.stringify(input.operations)
      ) {
        throw new ApplicationStateError('state.idempotency_conflict', `State idempotency key was reused with different content: ${input.idempotencyKey}`)
      }
      return {
        snapshot: {
          scopeId: current.scope.id,
          target: input.target,
          revisionId: replay.id,
          value: structuredClone(replay.snapshot),
          createdAt: replay.createdAt,
        },
        mutation: { changesetId: replay.changesetId },
      }
    }
  }
  if (current.revision.id !== input.expectedRevisionId) {
    throw new ApplicationStateError('state.head_conflict', `State head conflict: ${current.scope.id}`)
  }
  const nextValue = applyStateOperations(current.revision.snapshot, input.operations)
  await validateSnapshotAgainstDefinitions(ctx, input.target, current.revision.snapshot, nextValue)
  const result = await ctx.dataEngine.transact({
    actor: requestContext?.clientId
      ? { kind: 'client', id: requestContext.clientId }
      : { kind: 'kernel', id: 'application-runtime' },
    reason: 'application.applyStateMutation',
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }, async dataTx => {
    const stateTx = ctx.states.transaction(dataTx)
    const created = stateTx.createRevision({
      scopeId: current.scope.id,
      parentRevisionId: current.revision.id,
      snapshot: nextValue,
      operations: input.operations.map(operation => operation as unknown as JsonObject),
      idempotencyKey: input.idempotencyKey,
    })
    if (!created.replayed) {
      if (input.target.scope === 'global') {
        stateTx.setGlobalHead({
          scopeId: current.scope.id,
          expectedRevisionId: current.revision.id,
          revisionId: created.revision.id,
        })
      } else {
        if (!ctx.narratives) throw new ApplicationStateError('state.timeline_not_initialized', 'Narrative Store is not configured')
        ctx.narratives.transaction(dataTx).setBranchStateHead({
          timelineId: input.target.timelineId,
          branchId: input.target.branchId,
          expectedStateHeadRevisionId: current.revision.id,
          stateRevisionId: created.revision.id,
        })
      }
    }
    return created.revision
  })
  return {
    snapshot: {
      scopeId: current.scope.id,
      target: input.target,
      revisionId: result.value.id,
      value: structuredClone(result.value.snapshot),
      createdAt: result.value.createdAt,
    },
    mutation: { changesetId: result.commit.changesetId },
  }
}

export function applyGlobalStateDefaultInTransaction(
  ctx: ApplicationRuntimeContext,
  dataTx: SqliteDataTransaction,
  input: {
    scopeId: string
    parentRevisionId: string
    snapshot: JsonObject
    path: string
    value: JsonValue
  },
): void {
  const nextSnapshot = structuredClone(input.snapshot)
  setDotPath(nextSnapshot, input.path, structuredClone(input.value))
  const stateTx = ctx.states.transaction(dataTx)
  const created = stateTx.createRevision({
    scopeId: input.scopeId,
    parentRevisionId: input.parentRevisionId,
    snapshot: nextSnapshot,
    operations: [{ op: 'set', path: `/${input.path.split('.').join('/')}`, value: input.value }],
  })
  stateTx.setGlobalHead({
    scopeId: input.scopeId,
    expectedRevisionId: input.parentRevisionId,
    revisionId: created.revision.id,
  })
}

export async function revertApplicationStateChangeset(
  ctx: ApplicationRuntimeContext,
  changesetId: string,
  requestContext?: RuntimeRequestContext,
  documents?: { participant: SqliteDocumentStore; changeset: Changeset },
): Promise<{ changesetId: string }> {
  const row = ctx.dataEngine.database.prepare(`
    SELECT revision.id, revision.scope_id, revision.parent_revision_id, scope.kind, scope.owner_id, scope.head_revision_id
    FROM state_revisions revision
    JOIN state_scopes scope ON scope.id = revision.scope_id
    WHERE revision.changeset_id = ?
  `).get(changesetId) as {
    id: string
    scope_id: string
    parent_revision_id: string | null
    kind: 'global' | 'timeline'
    owner_id: string
    head_revision_id: string | null
  } | undefined
  if (!row) throw new ApplicationStateError('state.revert_not_found', `State Changeset not found: ${changesetId}`)
  if (!row.parent_revision_id) throw new ApplicationStateError('state.revert_initial_forbidden', 'Initial State Revision cannot be reverted')
  const parent = await ctx.states.getRevision(row.parent_revision_id)
  if (!parent) throw new ApplicationStateError('state.timeline_revision_invalid', `Parent State Revision not found: ${row.parent_revision_id}`)
  let branchId: string | undefined
  if (row.kind === 'global') {
    if (row.head_revision_id !== row.id) throw new ApplicationStateError('state.revert_conflict', 'Only the current Global State head can be reverted')
  } else {
    if (!ctx.narratives) throw new ApplicationStateError('state.timeline_not_initialized', 'Narrative Store is not configured')
    const branches = (await ctx.narratives.listBranches(row.owner_id)).filter(branch => branch.stateHeadRevisionId === row.id)
    if (branches.length !== 1) {
      throw new ApplicationStateError(
        branches.length === 0 ? 'state.revert_conflict' : 'state.revert_ambiguous',
        branches.length === 0
          ? 'Only a current Timeline Branch State head can be reverted'
          : 'State Changeset is the current head of more than one Timeline Branch',
      )
    }
    branchId = branches[0]!.id
  }
  const result = await ctx.dataEngine.transact({
    actor: requestContext?.clientId ? { kind: 'client', id: requestContext.clientId } : { kind: 'kernel', id: 'application-runtime' },
    reason: 'application.revertStateChangeset',
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }, async dataTx => {
    if (documents && documents.changeset.operations.length > 0) {
      await revertDocumentsInTransaction(documents.participant, dataTx, documents.changeset)
    }
    const stateTx = ctx.states.transaction(dataTx)
    const compensation = stateTx.createRevision({
      scopeId: row.scope_id,
      parentRevisionId: row.id,
      snapshot: parent.snapshot,
      operations: [{ op: 'compensate', revertedChangesetId: changesetId }],
    }).revision
    if (row.kind === 'global') {
      stateTx.setGlobalHead({ scopeId: row.scope_id, expectedRevisionId: row.id, revisionId: compensation.id })
    } else {
      ctx.narratives!.transaction(dataTx).setBranchStateHead({
        timelineId: row.owner_id,
        branchId: branchId!,
        expectedStateHeadRevisionId: row.id,
        stateRevisionId: compensation.id,
      })
    }
    return compensation
  })
  return { changesetId: result.commit.changesetId }
}

async function revertDocumentsInTransaction(
  documents: SqliteDocumentStore,
  dataTx: SqliteDataTransaction,
  changeset: Changeset,
): Promise<void> {
  await documents.participateTransaction(dataTx, async tx => {
    for (const operation of changeset.operations) {
      const current = await tx.get(operation.documentId, { includeTombstone: true })
      if (!current || current.version !== operation.toVersion) {
        throw new ApplicationStateError('document.conflict', `Document version conflict: ${operation.documentId}`)
      }
      if (operation.fromVersion === undefined) {
        await tx.delete({ id: current.id, expectedVersion: current.version })
        continue
      }
      const previous = await tx.get(operation.documentId, { includeTombstone: true, version: operation.fromVersion })
      if (!previous) {
        throw new ApplicationStateError('document.revision_not_found', `Document revision not found: ${operation.documentId}@${operation.fromVersion}`)
      }
      await tx.write({
        id: previous.id,
        type: previous.type,
        content: structuredClone(previous.content),
        meta: structuredClone(previous.meta),
        expectedVersion: current.version,
      })
    }
  })
}

export function applyStateOperations(
  snapshot: JsonObject,
  operations: StateMutationOperation[],
): JsonObject {
  let next = structuredClone(snapshot)
  for (const operation of operations) {
    if (operation.op === 'set') {
      if (operation.path === '') {
        if (!isJsonObject(operation.value)) {
          throw new ApplicationStateError('state.root_object_required', 'State root must remain a JSON object')
        }
        next = structuredClone(operation.value)
        continue
      }
      const target = resolveParent(next, operation.path)
      setChild(target.parent, target.key, structuredClone(operation.value))
      continue
    }
    if (operation.op === 'remove') {
      if (operation.path === '') {
        throw new ApplicationStateError('state.root_remove_forbidden', 'State root cannot be removed')
      }
      const target = resolveParent(next, operation.path)
      removeChild(target.parent, target.key)
      continue
    }
    if (!Number.isFinite(operation.by)) {
      throw new ApplicationStateError('state.increment_invalid', 'State increment must be finite')
    }
    const current = readPointer(next, operation.path)
    if (typeof current !== 'number' || !Number.isFinite(current)) {
      throw new ApplicationStateError('state.increment_target_invalid', `State increment target must be a finite number: ${operation.path}`)
    }
    const value = current + operation.by
    if (!Number.isFinite(value)) {
      throw new ApplicationStateError('state.increment_invalid', `State increment result must be finite: ${operation.path}`)
    }
    const target = resolveParent(next, operation.path)
    setChild(target.parent, target.key, value)
  }
  return next
}

function validateMutationInput(input: ApplyStateMutationInput): void {
  if (!input.expectedRevisionId.trim()) {
    throw new ApplicationStateError('state.input_invalid', 'expectedRevisionId must be a non-empty string')
  }
  if (input.operations.length === 0) {
    throw new ApplicationStateError('state.operations_empty', 'State mutation requires at least one operation')
  }
  if (input.idempotencyKey !== undefined && !input.idempotencyKey.trim()) {
    throw new ApplicationStateError('state.input_invalid', 'idempotencyKey must be a non-empty string')
  }
  for (const operation of input.operations) {
    if (typeof operation !== 'object' || operation === null || typeof operation.path !== 'string') {
      throw new ApplicationStateError('state.operation_invalid', 'State operation requires a string path')
    }
    if (operation.op === 'set') {
      if (!Object.hasOwn(operation, 'value')) throw new ApplicationStateError('state.operation_invalid', 'State set operation requires value')
      continue
    }
    if (operation.op === 'remove') continue
    if (operation.op === 'increment' && typeof operation.by === 'number' && Number.isFinite(operation.by)) continue
    throw new ApplicationStateError('state.operation_invalid', `Unsupported or invalid State operation: ${String((operation as { op?: unknown }).op)}`)
  }
}

async function readTargetSnapshot(ctx: ApplicationRuntimeContext, target: StateTarget) {
  if (target.scope === 'global') {
    const snapshot = await ctx.states.getGlobalSnapshot(globalOwnerId)
    if (!snapshot) throw new ApplicationStateError('state.global_not_initialized', 'Global state is not initialized')
    return snapshot
  }
  if (!ctx.narratives) throw new ApplicationStateError('state.timeline_not_initialized', 'Narrative Store is not configured')
  const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: target.timelineId })
  if (!scope) {
    throw new ApplicationStateError('state.timeline_not_initialized', `Timeline state is not initialized: ${target.timelineId}/${target.branchId}`)
  }
  const branches = await ctx.narratives.listBranches(target.timelineId)
  const branch = branches.find(candidate => candidate.id === target.branchId)
  if (!branch?.stateHeadRevisionId) {
    throw new ApplicationStateError('state.timeline_not_initialized', `Timeline state is not initialized: ${target.timelineId}/${target.branchId}`)
  }
  const revision = await ctx.states.getRevision(branch.stateHeadRevisionId)
  if (!revision || revision.scopeId !== scope.id) {
    throw new ApplicationStateError('state.timeline_revision_invalid', `Timeline state revision is invalid: ${target.timelineId}/${target.branchId}`)
  }
  return { scope, revision }
}

async function validateSnapshotAgainstDefinitions(
  ctx: ApplicationRuntimeContext,
  target: StateTarget,
  previous: JsonObject,
  snapshot: JsonObject,
): Promise<void> {
  const definitions = await listDocuments<StateDefinitionContent>(ctx.documents, applicationDocumentTypes.stateDefinition)
  if (target.scope === 'global') {
    for (const definition of definitions) {
      if (definition.content.kind !== 'global') continue
      const value = readDotPath(snapshot, definition.content.path.replace(/^global\./, ''))
      const previousValue = readDotPath(previous, definition.content.path.replace(/^global\./, ''))
      if (definition.content.readOnly && JSON.stringify(value) !== JSON.stringify(previousValue)) {
        throw new ApplicationStateError('state.read_only', `Read-only State value cannot be changed: ${definition.content.path}`)
      }
      if (value.found) validateStateValue(value.value, definition.content.schema, definition.content.path)
    }
    return
  }
  const timeline = await ctx.narratives?.getTimeline(target.timelineId)
  const cardId = timeline?.createdFrom?.cardId
  if (!cardId) return
  const card = await ctx.documents.get(cardId)
  if (!card || card.type !== applicationDocumentTypes.cardSource || typeof card.content !== 'object' || card.content === null || Array.isArray(card.content)) return
  const bindings = (card.content.timelineStateBindings ?? []) as Array<{ path: string; templateId: string }>
  for (const binding of bindings) {
    const definition = definitions.find(candidate => candidate.id === binding.templateId)
    if (!definition || definition.content.kind !== 'timeline-template') continue
    const value = readDotPath(snapshot, binding.path)
    if (!value.found) throw new ApplicationStateError('state.schema_required', `Bound Timeline State is missing: timeline.${binding.path}`)
    validateStateValue(value.value, definition.content.schema, `timeline.${binding.path}`)
  }
}

function readDotPath(root: JsonObject, path: string): { found: true; value: JsonValue } | { found: false } {
  let current: JsonValue = root
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !(segment in current)) return { found: false }
    current = current[segment]!
  }
  return { found: true, value: current }
}

function setDotPath(root: JsonObject, path: string, value: JsonValue): void {
  const segments = path.split('.')
  let current = root
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    if (existing === undefined) {
      const child: JsonObject = {}
      current[segment] = child
      current = child
      continue
    }
    if (!isJsonObject(existing)) {
      throw new ApplicationStateError('state.path_parent_invalid', `State Definition path conflicts with an existing value: ${path}`)
    }
    current = existing
  }
  current[segments.at(-1)!] = value
}

function parsePointer(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) {
    throw new ApplicationStateError('state.path_invalid', `State path must be an RFC 6901 JSON Pointer: ${path}`)
  }
  return path.slice(1).split('/').map(segment => {
    if (/~(?:[^01]|$)/.test(segment)) {
      throw new ApplicationStateError('state.path_invalid', `State path contains an invalid escape: ${path}`)
    }
    return segment.replace(/~1/g, '/').replace(/~0/g, '~')
  })
}

function resolveParent(root: JsonObject, path: string): { parent: JsonObject | JsonValue[]; key: string } {
  const segments = parsePointer(path)
  if (segments.length === 0) throw new ApplicationStateError('state.path_invalid', 'State path must select a child')
  let current: JsonValue = root
  for (const segment of segments.slice(0, -1)) {
    current = readChild(current, segment, path)
  }
  if (!isJsonObject(current) && !Array.isArray(current)) {
    throw new ApplicationStateError('state.path_parent_invalid', `State path parent is not a container: ${path}`)
  }
  return { parent: current, key: segments.at(-1)! }
}

function readPointer(root: JsonObject, path: string): JsonValue {
  let current: JsonValue = root
  for (const segment of parsePointer(path)) current = readChild(current, segment, path)
  return current
}

function readChild(parent: JsonValue, key: string, path: string): JsonValue {
  if (Array.isArray(parent)) {
    const index = readArrayIndex(key, parent.length, path)
    return parent[index]!
  }
  if (!isJsonObject(parent) || !(key in parent)) {
    throw new ApplicationStateError('state.path_not_found', `State path does not exist: ${path}`)
  }
  return parent[key]!
}

function setChild(parent: JsonObject | JsonValue[], key: string, value: JsonValue): void {
  if (Array.isArray(parent)) {
    const index = readArrayIndex(key, parent.length, key)
    parent[index] = value
    return
  }
  parent[key] = value
}

function removeChild(parent: JsonObject | JsonValue[], key: string): void {
  if (Array.isArray(parent)) {
    const index = readArrayIndex(key, parent.length, key)
    parent.splice(index, 1)
    return
  }
  if (!(key in parent)) throw new ApplicationStateError('state.path_not_found', `State path does not exist: ${key}`)
  delete parent[key]
}

function readArrayIndex(value: string, length: number, path: string): number {
  if (value === '-' || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new ApplicationStateError('state.array_index_invalid', `State array index is invalid: ${path}`)
  }
  const index = Number(value)
  if (index >= length) {
    throw new ApplicationStateError('state.path_not_found', `State array index does not exist: ${path}`)
  }
  return index
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
