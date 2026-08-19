import type { DataCommitOperation, SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso, type JsonObject, type JsonValue } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type AddSettingMountInput,
  type CreatePromptResourceInput,
  type DeletePromptResourceInput,
  type ListPromptResourcesInput,
  type ListSettingMountsInput,
  type MutatePromptResourceInput,
  type PromptResource,
  type PromptResourceNode,
  type PromptResourceNodeDraft,
  type PromptResourceNodePatch,
  type PromptResourcePage,
  type PromptResourceStore,
  type PromptResourceStoreOptions,
  type PromptResourceTransaction,
  type PromptResourceTreeNode,
  type PromptResourceWriteContext,
  type ReplaceSettingMountsInput,
  type RevertPromptResourceChangesetInput,
  type SettingMount,
  type SettingMountSource,
} from './types.js'

const migrationNamespace = 'application.prompt-resource'
const defaultPageLimit = 100
const maximumPageLimit = 500
const allowedNodeKinds = new Set(['module', 'folder', 'entry', 'script', 'virtual', 'order'])
const containerNodeKinds = new Set(['module', 'folder'])

type NodeRow = {
  id: string
  resource_id: string
  parent_id: string | null
  order_index: number
  kind: string
  category: string | null
  label: string
  meta: string | null
  enabled: number | null
  body: string | null
  capabilities_json: string | null
  extra_json: string
  created_at: string
  updated_at: string
}

type ResourceRow = {
  id: string
  resource_kind: string
  root_node_id: string
  label: string
  version: number
  metadata_json: string
  created_at: string
  updated_at: string
  tombstoned: number
  deleted_at: string | null
  deleted_by_json: string | null
  delete_reason: string | null
}

type RevisionRow = {
  resource_id: string
  resource_version: number
  node_id: string
  operation: 'create' | 'update' | 'move' | 'delete'
  before_json: string | null
  after_json: string | null
  changeset_id: string
  created_at: string
  created_by_json: string
}

type HeaderState = {
  label: string
  metadata: JsonObject
  tombstoned: boolean
  deletedAt?: string
  deletedBy?: JsonValue
  deleteReason?: string
}

type HeaderRevisionRow = {
  resource_id: string
  resource_version: number
  before_json: string | null
  after_json: string | null
  changeset_id: string
  created_at: string
  created_by_json: string
}

type StoredNode = PromptResourceNode

export function createPromptResourceStore(options: PromptResourceStoreOptions): PromptResourceStore {
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso
  const { engine } = options
  engine.migrate({
    namespace: migrationNamespace,
    migrations: [{ version: 1, migrate: migrateVersionOne }],
  })
  const database = engine.database

  function transaction(tx: SqliteDataTransaction): PromptResourceTransaction {
    return {
      createResource: input => applyCreateResource(database, tx, input, nextId, now),
      mutateResource: input => applyMutateResource(database, tx, input, now),
      deleteResource: input => applyDeleteResource(database, tx, input, now),
      addSettingMount: input => applyAddSettingMount(database, tx, input, nextId, now),
      replaceSettingMounts: input => applyReplaceSettingMounts(database, tx, input, nextId, now),
    }
  }

  async function runTransaction<T>(
    context: { actor: PromptResourceWriteContext['actor']; reason?: string; correlationId?: string; callId?: string; parentCallId?: string },
    callback: (tx: SqliteDataTransaction) => T,
  ): Promise<{ value: T; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
    return engine.transact(context, tx => Promise.resolve(callback(tx)))
  }

  return {
    getResource: (id, readOptions) => engine.read(database => readResource(database, id, readOptions?.includeTombstone ?? false)),
    listResources: input => engine.read(database => listResources(database, input)),
    listSettingMounts: input => engine.read(database => listMounts(database, input)),
    createResource: async input => {
      const result = await runTransaction(input, tx => transaction(tx).createResource(input))
      return { resource: result.value, commit: result.commit }
    },
    mutateResource: async input => {
      const result = await runTransaction(input, tx => transaction(tx).mutateResource(input))
      return { resource: result.value, commit: result.commit }
    },
    deleteResource: async input => {
      const result = await runTransaction(input, tx => transaction(tx).deleteResource(input))
      return { resource: result.value, commit: result.commit }
    },
    addSettingMount: async input => {
      const result = await runTransaction(input, tx => transaction(tx).addSettingMount(input))
      return { mounts: [result.value], commit: result.commit }
    },
    replaceSettingMounts: async input => {
      const result = await runTransaction(input, tx => transaction(tx).replaceSettingMounts(input))
      return { mounts: result.value, commit: result.commit }
    },
    revertChangeset: async input => {
      const result = await runTransaction(input, tx => applyRevert(database, tx, input, now))
      return { resource: result.value, commit: result.commit }
    },
    transaction,
  }
}

function applyCreateResource(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<CreatePromptResourceInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): PromptResource {
  validateId(input.id, 'resourceId', true)
  validateResourceKind(input.resourceKind)
  if (input.label !== undefined && typeof input.label !== 'string') throw new PromptResourceStoreError('prompt_resource.label_invalid', 'Prompt resource label must be a string')
  if (input.metadata !== undefined) validateJsonObject(input.metadata, 'metadata')
  const resourceId = input.id ?? nextId('prompt-resource')
  if (readResourceRow(database, resourceId)) throw new PromptResourceStoreError('prompt_resource.conflict', `Prompt resource already exists: ${resourceId}`)
  const timestamp = now()
  const flat = flattenTree(input.rootNode, resourceId, timestamp)
  validateTree(resourceId, flat, input.rootNode.id)
  const root = flat.get(input.rootNode.id)
  if (!root || root.kind !== 'module') throw new PromptResourceStoreError('prompt_resource.root_invalid', 'Prompt resource root must be a module')
  const resource: PromptResource = {
    id: resourceId,
    resourceKind: input.resourceKind,
    rootNodeId: root.id,
    label: input.label?.trim() || root.label,
    version: 1,
    metadata: input.metadata ?? {},
    rootNode: toTree(root, flat),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  database.prepare(`
    INSERT INTO prompt_resources (
      id, resource_kind, root_node_id, label, version, metadata_json,
      created_at, updated_at, tombstoned, deleted_at, deleted_by_json, delete_reason
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0, NULL, NULL, NULL)
  `).run(resource.id, resource.resourceKind, resource.rootNodeId, resource.label, stringifyJson(resource.metadata, 'metadata'), timestamp, timestamp)
  for (const node of flat.values()) insertNode(database, node)
  insertHeaderRevision(database, tx, resource.id, resource.version, undefined, headerStateFromValues(resource.label, resource.metadata))
  for (const node of flat.values()) insertRevision(database, tx, resource, node.id, 'create', undefined, node)
  tx.recordOperations([operation('create', resource.id, 'prompt-resource', undefined, resource.version)])
  return resource
}

function applyMutateResource(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<MutatePromptResourceInput, keyof PromptResourceWriteContext>,
  now: () => string,
): PromptResource {
  const row = requireResourceRow(database, input.resourceId)
  if (row.tombstoned) throw new PromptResourceStoreError('prompt_resource.deleted', `Prompt resource is deleted: ${input.resourceId}`)
  assertExpectedVersion(row, input.expectedVersion)
  if (input.mutations.length === 0) throw new PromptResourceStoreError('prompt_resource.mutations_empty', 'Prompt resource mutation requires at least one operation')

  const before = readNodeMap(database, row.id)
  const after = cloneNodeMap(before)
  const touched = new Set<string>()
  const header = { label: row.label, metadata: parseObject(row.metadata_json, 'metadata') }
  const originalHeader = { label: row.label, metadata: parseObject(row.metadata_json, 'metadata') }

  for (const mutation of input.mutations) {
    if (mutation.kind === 'resource.update') {
      if (mutation.patch.label !== undefined) {
        if (typeof mutation.patch.label !== 'string') throw new PromptResourceStoreError('prompt_resource.label_invalid', 'Prompt resource label must be a string')
        const label = mutation.patch.label.trim()
        if (!label) throw new PromptResourceStoreError('prompt_resource.label_invalid', 'Prompt resource label must not be empty')
        header.label = label
      }
      if (mutation.patch.metadata !== undefined) {
        validateJsonObject(mutation.patch.metadata, 'metadata')
        header.metadata = mutation.patch.metadata
      }
      continue
    }
    const targetId = mutation.kind === 'node.create' ? mutation.node.id : mutation.nodeId
    if (touched.has(targetId)) throw new PromptResourceStoreError('prompt_resource.mutation_duplicate', `Node is addressed more than once: ${targetId}`)
    touched.add(targetId)
    if (mutation.kind === 'node.create') {
      if ('children' in mutation.node) throw new PromptResourceStoreError('prompt_resource.node_shape_invalid', 'Node create cannot include nested children')
      validateNodeDraft(mutation.node)
      if (after.has(mutation.node.id)) throw new PromptResourceStoreError('prompt_resource.node_conflict', `Prompt resource node already exists: ${mutation.node.id}`)
      const parent = requireNode(after, mutation.parentId)
      assertContainer(parent)
      const timestamp = now()
      after.set(mutation.node.id, nodeFromDraft(mutation.node, row.id, mutation.parentId, mutation.node.orderIndex ?? nextSiblingOrder(after, mutation.parentId), timestamp))
    } else if (mutation.kind === 'node.update') {
      const node = requireNode(after, mutation.nodeId)
      const patch = mutation.patch
      if (patch.label !== undefined && (typeof patch.label !== 'string' || !patch.label.trim())) throw new PromptResourceStoreError('prompt_resource.label_invalid', 'Prompt resource node label must be a non-empty string')
      validateCategory(patch.category)
      if (patch.extra !== undefined && patch.extra !== null) validateJsonObject(patch.extra, 'extra')
      if (patch.capabilities !== undefined && patch.capabilities !== null) stringifyJson(patch.capabilities, 'capabilities')
      const candidate = applyNodePatch(node, patch)
      if (!sameNodeValue(node, candidate)) after.set(node.id, { ...candidate, updatedAt: now() })
    } else if (mutation.kind === 'node.move') {
      const node = requireNode(after, mutation.nodeId)
      if (!node.parentId) throw new PromptResourceStoreError('prompt_resource.root_move_invalid', 'Prompt resource root cannot move')
      const parent = requireNode(after, mutation.parentId)
      assertContainer(parent)
      if (isDescendant(after, mutation.nodeId, mutation.parentId)) throw new PromptResourceStoreError('prompt_resource.cycle', `Prompt resource move would create a cycle: ${mutation.nodeId}`)
      validateOrderIndex(mutation.orderIndex)
      const candidate = { ...node, parentId: mutation.parentId, orderIndex: mutation.orderIndex, updatedAt: node.updatedAt }
      if (!sameNodeValue(node, candidate)) after.set(node.id, { ...candidate, updatedAt: now() })
    } else {
      const node = requireNode(after, mutation.nodeId)
      if (!node.parentId) throw new PromptResourceStoreError('prompt_resource.root_delete_invalid', 'Prompt resource root cannot be deleted')
      const removed = collectSubtree(after, node.id)
      for (const id of removed) after.delete(id)
    }
  }

  validateTree(row.id, after, row.root_node_id)
  const headerChanged = header.label !== originalHeader.label || !sameJson(header.metadata, originalHeader.metadata)
  const changedIds = new Set<string>()
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!sameJson(before.get(id), after.get(id))) changedIds.add(id)
  }
  if (changedIds.size === 0 && !headerChanged) throw new PromptResourceStoreError('prompt_resource.noop', 'Prompt resource mutation does not change anything')
  const timestamp = now()
  const version = row.version + 1
  database.prepare('UPDATE prompt_resources SET label = ?, metadata_json = ?, version = ?, updated_at = ? WHERE id = ?')
    .run(header.label, stringifyJson(header.metadata, 'metadata'), version, timestamp, row.id)

  for (const id of [...changedIds].filter(id => before.has(id) && !after.has(id)).sort((left, right) => nodeDepth(before, right) - nodeDepth(before, left))) {
    const previous = before.get(id)
    const current = after.get(id)
    if (previous && !current) deleteNode(database, id)
  }
  for (const id of [...changedIds].filter(id => after.has(id)).sort((left, right) => nodeDepth(after, left) - nodeDepth(after, right))) {
    const previous = before.get(id)
    const current = after.get(id)
    if (!current) continue
    if (!previous) insertNode(database, current)
    else updateNode(database, current)
  }
  const resource = readResource(database, row.id, true)
  if (!resource) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${row.id}`)
  insertHeaderRevision(database, tx, row.id, version, headerStateFromRow(row), headerStateFromValues(header.label, header.metadata),)
  for (const id of changedIds) {
    const previous = before.get(id)
    const current = after.get(id)
    insertRevision(database, tx, resource, id, revisionOperation(previous, current), previous, current)
  }
  tx.recordOperations([operation('update', row.id, 'prompt-resource', row.version, version)])
  return resource
}

function applyDeleteResource(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<DeletePromptResourceInput, keyof PromptResourceWriteContext>,
  now: () => string,
): PromptResource {
  const row = requireResourceRow(database, input.resourceId)
  if (row.tombstoned) throw new PromptResourceStoreError('prompt_resource.deleted', `Prompt resource is already deleted: ${input.resourceId}`)
  if (input.expectedVersion !== undefined) assertExpectedVersion(row, input.expectedVersion)
  const timestamp = now()
  const version = row.version + 1
  if (row.resource_kind === 'setting') {
    recordDeletedMountOperations(database, tx, 'setting_resource_id = ?', input.resourceId)
    database.prepare('DELETE FROM global_setting_mounts WHERE setting_resource_id = ?').run(input.resourceId)
  } else if (row.resource_kind === 'preset') {
    recordDeletedMountOperations(database, tx, 'source_kind = ? AND source_id = ?', 'preset', input.resourceId)
    database.prepare('DELETE FROM global_setting_mounts WHERE source_kind = ? AND source_id = ?').run('preset', input.resourceId)
  }
  database.prepare(`
    UPDATE prompt_resources
    SET version = ?, updated_at = ?, tombstoned = 1, deleted_at = ?, deleted_by_json = ?, delete_reason = ?
    WHERE id = ?
  `).run(version, timestamp, timestamp, stringifyJson(tx.actor, 'deletedBy'), tx.reason ?? null, input.resourceId)
  const resource = readResource(database, input.resourceId, true)
  if (!resource) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${input.resourceId}`)
  insertHeaderRevision(database, tx, input.resourceId, version, headerStateFromRow(row), {
    label: row.label,
    metadata: parseObject(row.metadata_json, 'metadata'),
    tombstoned: true,
    deletedAt: timestamp,
    deletedBy: tx.actor,
    ...(tx.reason ? { deleteReason: tx.reason } : {}),
  })
  tx.recordOperations([operation('delete', input.resourceId, 'prompt-resource', row.version, version)])
  return resource
}

function applyAddSettingMount(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<AddSettingMountInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): SettingMount {
  validateOrderIndex(input.orderIndex)
  if (input.origin !== undefined) validateJsonObject(input.origin, 'mount origin')
  requireSetting(database, input.settingResourceId)
  validateMountSource(database, input.source)
  const timestamp = now()
  const mount: SettingMount = {
    id: nextId('setting-mount'),
    settingResourceId: input.settingResourceId,
    source: input.source.kind === 'manual' ? { kind: 'manual', id: 'global' } : { kind: 'preset', id: input.source.id },
    orderIndex: input.orderIndex,
    origin: input.origin ?? {},
    createdAt: timestamp,
  }
  try {
    database.prepare(`
      INSERT INTO global_setting_mounts (
        id, setting_resource_id, source_kind, source_id, order_index, origin_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(mount.id, mount.settingResourceId, mount.source.kind, mount.source.id ?? 'global', mount.orderIndex, stringifyJson(mount.origin, 'mount origin'), mount.createdAt)
  } catch (error) {
    if (isMountUniqueConstraint(error)) {
      throw new PromptResourceStoreError('prompt_resource.mount_conflict', `Setting mount already exists for ${mount.settingResourceId}`)
    }
    throw error
  }
  tx.recordOperations([operation('create', mount.id, 'prompt-resource.mount')])
  return mount
}

function applyReplaceSettingMounts(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<ReplaceSettingMountsInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): SettingMount[] {
  validateMountSource(database, input.source)
  const seen = new Set<string>()
  for (const mount of input.mounts) {
    if (seen.has(mount.settingResourceId)) throw new PromptResourceStoreError('prompt_resource.mount_duplicate', `Setting mount is duplicated: ${mount.settingResourceId}`)
    seen.add(mount.settingResourceId)
    validateOrderIndex(mount.orderIndex)
    if (mount.origin !== undefined) validateJsonObject(mount.origin, 'mount origin')
    requireSetting(database, mount.settingResourceId)
  }
  const sourceId = input.source.id ?? 'global'
  recordDeletedMountOperations(database, tx, 'source_kind = ? AND source_id = ?', input.source.kind, sourceId)
  database.prepare('DELETE FROM global_setting_mounts WHERE source_kind = ? AND source_id = ?').run(input.source.kind, sourceId)
  const mounts = input.mounts.map(mount => applyAddSettingMount(database, tx, { ...mount, source: input.source }, nextId, now))
  return mounts
}

function applyRevert(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: RevertPromptResourceChangesetInput,
  now: () => string,
): PromptResource {
  const row = database.prepare('SELECT operations_json FROM changesets WHERE id = ?').get(input.changesetId) as { operations_json?: string } | undefined
  if (!row) throw new PromptResourceStoreError('prompt_resource.changeset_not_found', `Changeset not found: ${input.changesetId}`)
  const operations = parseJson(row.operations_json, 'changeset operations')
  if (!Array.isArray(operations) || operations.length === 0 || operations.length !== 1 || operations.some(operation => !isPromptResourceOperation(operation))) {
    throw new PromptResourceStoreError('prompt_resource.mixed_changeset', 'Prompt Resource revert only accepts Prompt Resource changesets')
  }
  const resourceOperation = operations[0] as Record<string, unknown>
  if (resourceOperation.kind === 'delete') throw new PromptResourceStoreError('prompt_resource.revert_unsupported', 'Resource deletion revert is unsupported because it may include mount cleanup')
  const resourceId = String((operations[0] as Record<string, unknown>).entityId)
  if (operations.some(operation => String((operation as Record<string, unknown>).entityId) !== resourceId)) {
    throw new PromptResourceStoreError('prompt_resource.mixed_resource_changeset', 'Prompt Resource revert requires one resource per changeset')
  }
  const resource = requireResourceRow(database, resourceId)
  const targetVersion = Number((operations[0] as Record<string, unknown>).toVersion)
  if (!Number.isInteger(targetVersion) || resource.version !== targetVersion || (input.expectedVersion !== undefined && input.expectedVersion !== resource.version)) {
    throw new PromptResourceStoreError('prompt_resource.conflict', `Prompt resource version conflict: ${resourceId}`)
  }
  const headerRevision = database.prepare(`
    SELECT resource_id, resource_version, before_json, after_json,
           changeset_id, created_at, created_by_json
    FROM prompt_resource_header_revisions
    WHERE changeset_id = ? AND resource_id = ?
  `).get(input.changesetId, resourceId) as HeaderRevisionRow | undefined
  if (!headerRevision || !headerRevision.before_json) throw new PromptResourceStoreError('prompt_resource.revert_unsupported', 'Changeset has no complete header revision to revert')
  const targetHeader = parseHeaderState(headerRevision.before_json)
  const revisions = database.prepare(`
    SELECT resource_id, resource_version, node_id, operation, before_json, after_json,
           changeset_id, created_at, created_by_json
    FROM prompt_resource_node_revisions
    WHERE changeset_id = ? AND resource_id = ?
  `).all(input.changesetId, resourceId) as unknown as RevisionRow[]
  const before = readNodeMap(database, resourceId)
  const after = cloneNodeMap(before)
  for (const revision of revisions) {
    const original = revision.before_json ? parseNode(revision.before_json) : undefined
    if (original) after.set(original.id, original)
    else after.delete(revision.node_id)
  }
  validateTree(resourceId, after, resource.root_node_id)
  const version = resource.version + 1
  const timestamp = now()
  const changedIds = new Set<string>()
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!sameJson(before.get(id), after.get(id))) changedIds.add(id)
  }
  for (const id of [...changedIds].filter(id => before.has(id) && !after.has(id)).sort((left, right) => nodeDepth(before, right) - nodeDepth(before, left))) deleteNode(database, id)
  for (const id of [...changedIds].filter(id => after.has(id)).sort((left, right) => nodeDepth(after, left) - nodeDepth(after, right))) {
    const current = after.get(id)
    if (!current) continue
    if (before.has(id)) updateNode(database, { ...current, updatedAt: timestamp })
    else insertNode(database, { ...current, updatedAt: timestamp })
  }
  updateResourceHeader(database, resourceId, version, timestamp, targetHeader)
  const updated = readResource(database, resourceId, true)
  if (!updated) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${resourceId}`)
  insertHeaderRevision(database, tx, resourceId, version, headerStateFromRow(resource), targetHeader)
  for (const id of changedIds) {
    const previous = before.get(id)
    const current = after.get(id)
    insertRevision(database, tx, updated, id, revisionOperation(previous, current), previous, current)
  }
  tx.recordOperations([operation('update', resourceId, 'prompt-resource', resource.version, version)])
  return updated
}

function readResource(database: DatabaseSync, id: string, includeTombstone: boolean): PromptResource | null {
  validateId(id, 'resourceId')
  const row = readResourceRow(database, id)
  if (!row || (row.tombstoned && !includeTombstone)) return null
  const nodes = readNodeMap(database, id)
  const root = nodes.get(row.root_node_id)
  if (!root) throw new PromptResourceStoreError('prompt_resource.root_missing', `Prompt resource root is missing: ${id}`)
  return {
    id: row.id,
    resourceKind: readResourceKind(row.resource_kind),
    rootNodeId: row.root_node_id,
    label: row.label,
    version: row.version,
    metadata: parseObject(row.metadata_json, 'metadata'),
    rootNode: toTree(root, nodes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.tombstoned ? { tombstoned: true, deletedAt: row.deleted_at ?? undefined, deletedBy: row.deleted_by_json ? parseJson(row.deleted_by_json, 'deletedBy') as never : undefined, deleteReason: row.delete_reason ?? undefined } : {}),
  }
}

function listResources(database: DatabaseSync, input: ListPromptResourcesInput = {}): PromptResourcePage {
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) throw new PromptResourceStoreError('prompt_resource.limit_invalid', `Prompt resource list limit must be between 1 and ${maximumPageLimit}`)
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isInteger(offset) || offset < 0) throw new PromptResourceStoreError('prompt_resource.cursor_invalid', 'Prompt resource cursor must be a non-negative integer')
  const clauses = [input.includeTombstone ? '1 = 1' : 'tombstoned = 0']
  const values: Array<string | number> = []
  if (input.resourceKind) { validateResourceKind(input.resourceKind); clauses.push('resource_kind = ?'); values.push(input.resourceKind) }
  const rows = database.prepare(`SELECT id FROM prompt_resources WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, limit + 1, offset) as Array<{ id: string }>
  const resources = rows.slice(0, limit).map(row => readResource(database, row.id, true)).filter((resource): resource is PromptResource => resource !== null)
  return { resources, nextCursor: rows.length > limit ? String(offset + limit) : undefined }
}

function listMounts(database: DatabaseSync, input: ListSettingMountsInput = {}): SettingMount[] {
  if (input.source) validateMountSource(database, input.source, false)
  const clauses: string[] = []
  const values: string[] = []
  if (input.source) { clauses.push('source_kind = ?', 'source_id = ?'); values.push(input.source.kind, input.source.id ?? 'global') }
  if (input.settingResourceId) { validateId(input.settingResourceId, 'settingResourceId'); clauses.push('setting_resource_id = ?'); values.push(input.settingResourceId) }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return (database.prepare(`SELECT id, setting_resource_id, source_kind, source_id, order_index, origin_json, created_at FROM global_setting_mounts ${where} ORDER BY order_index ASC, id ASC`).all(...values) as Array<Record<string, unknown>>).map(mountFromRow)
}

function readResourceRow(database: DatabaseSync, id: string): ResourceRow | undefined {
  return database.prepare(`SELECT id, resource_kind, root_node_id, label, version, metadata_json, created_at, updated_at, tombstoned, deleted_at, deleted_by_json, delete_reason FROM prompt_resources WHERE id = ?`).get(id) as ResourceRow | undefined
}

function headerStateFromRow(row: ResourceRow): HeaderState {
  return {
    label: row.label,
    metadata: parseObject(row.metadata_json, 'metadata'),
    tombstoned: Boolean(row.tombstoned),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.deleted_by_json ? { deletedBy: parseJson(row.deleted_by_json, 'deletedBy') } : {}),
    ...(row.delete_reason ? { deleteReason: row.delete_reason } : {}),
  }
}

function headerStateFromValues(label: string, metadata: JsonObject): HeaderState {
  return { label, metadata, tombstoned: false }
}

function parseHeaderState(value: string): HeaderState {
  const parsed = parseJson(value, 'header revision')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Header revision must be a JSON object')
  const header = parsed as Partial<HeaderState>
  if (typeof header.label !== 'string' || !header.metadata || typeof header.metadata !== 'object' || Array.isArray(header.metadata) || typeof header.tombstoned !== 'boolean') {
    throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Header revision has an invalid shape')
  }
  return header as HeaderState
}

function updateResourceHeader(database: DatabaseSync, resourceId: string, version: number, timestamp: string, header: HeaderState): void {
  database.prepare(`
    UPDATE prompt_resources
    SET label = ?, metadata_json = ?, version = ?, updated_at = ?, tombstoned = ?,
        deleted_at = ?, deleted_by_json = ?, delete_reason = ?
    WHERE id = ?
  `).run(header.label, stringifyJson(header.metadata, 'metadata'), version, timestamp, Number(header.tombstoned), header.deletedAt ?? null, header.deletedBy === undefined ? null : stringifyJson(header.deletedBy, 'deletedBy'), header.deleteReason ?? null, resourceId)
}

function requireResourceRow(database: DatabaseSync, id: string): ResourceRow {
  validateId(id, 'resourceId')
  const row = readResourceRow(database, id)
  if (!row) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${id}`)
  return row
}

function readNodeMap(database: DatabaseSync, resourceId: string): Map<string, StoredNode> {
  const rows = database.prepare(`SELECT id, resource_id, parent_id, order_index, kind, category, label, meta, enabled, body, capabilities_json, extra_json, created_at, updated_at FROM prompt_resource_nodes WHERE resource_id = ?`).all(resourceId) as unknown as NodeRow[]
  return new Map(rows.map(row => [row.id, nodeFromRow(row)]))
}

function insertNode(database: DatabaseSync, node: StoredNode): void {
  database.prepare(`
    INSERT INTO prompt_resource_nodes (
      id, resource_id, parent_id, order_index, kind, category, label, meta, enabled, body,
      capabilities_json, extra_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(node.id, node.resourceId, node.parentId ?? null, node.orderIndex, node.kind, node.category ?? null, node.label, node.meta ?? null, node.enabled === undefined ? null : Number(node.enabled), node.body ?? null, node.capabilities === undefined ? null : stringifyJson(node.capabilities, 'capabilities'), stringifyJson(node.extra ?? {}, 'extra'), node.createdAt, node.updatedAt)
}

function updateNode(database: DatabaseSync, node: StoredNode): void {
  database.prepare(`UPDATE prompt_resource_nodes SET parent_id = ?, order_index = ?, kind = ?, category = ?, label = ?, meta = ?, enabled = ?, body = ?, capabilities_json = ?, extra_json = ?, updated_at = ? WHERE id = ?`).run(node.parentId ?? null, node.orderIndex, node.kind, node.category ?? null, node.label, node.meta ?? null, node.enabled === undefined ? null : Number(node.enabled), node.body ?? null, node.capabilities === undefined ? null : stringifyJson(node.capabilities, 'capabilities'), stringifyJson(node.extra ?? {}, 'extra'), node.updatedAt, node.id)
}

function deleteNode(database: DatabaseSync, id: string): void {
  database.prepare('DELETE FROM prompt_resource_nodes WHERE id = ?').run(id)
}

function insertRevision(database: DatabaseSync, tx: SqliteDataTransaction, resource: PromptResource, nodeId: string, operationKind: 'create' | 'update' | 'move' | 'delete', before: StoredNode | undefined, after: StoredNode | undefined): void {
  database.prepare(`
    INSERT INTO prompt_resource_node_revisions (
      resource_id, resource_version, node_id, operation, before_json, after_json,
      changeset_id, created_at, created_by_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(resource.id, resource.version, nodeId, operationKind, before ? stringifyJson(before, 'node revision before') : null, after ? stringifyJson(after, 'node revision after') : null, tx.changesetId, tx.createdAt, stringifyJson(tx.actor, 'revision actor'))
}

function insertHeaderRevision(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  resourceId: string,
  resourceVersion: number,
  before: HeaderState | undefined,
  after: HeaderState | undefined,
): void {
  database.prepare(`
    INSERT INTO prompt_resource_header_revisions (
      resource_id, resource_version, before_json, after_json,
      changeset_id, created_at, created_by_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(resourceId, resourceVersion, before ? stringifyJson(before, 'header revision before') : null, after ? stringifyJson(after, 'header revision after') : null, tx.changesetId, tx.createdAt, stringifyJson(tx.actor, 'header revision actor'))
}

function operation(kind: DataCommitOperation['kind'], entityId: string, entityType: string, fromVersion?: number, toVersion?: number): DataCommitOperation {
  return {
    store: 'prompt-resources',
    kind,
    entityId,
    entityType,
    ...(fromVersion === undefined ? {} : { fromVersion }),
    ...(toVersion === undefined ? {} : { toVersion }),
  }
}

function recordDeletedMountOperations(database: DatabaseSync, tx: SqliteDataTransaction, where: string, ...values: string[]): void {
  const rows = database.prepare(`SELECT id FROM global_setting_mounts WHERE ${where} ORDER BY id ASC`).all(...values) as Array<{ id: string }>
  if (rows.length > 0) tx.recordOperations(rows.map(row => operation('delete', row.id, 'prompt-resource.mount')))
}

function flattenTree(root: PromptResourceTreeNode, resourceId: string, timestamp: string): Map<string, StoredNode> {
  const nodes = new Map<string, StoredNode>()
  function visit(node: PromptResourceTreeNode, parentId: string | undefined, orderIndex: number): void {
    validateNodeShape({ id: node.id, kind: node.kind, label: node.label, orderIndex })
    validateCategory(node.category)
    if (node.extra !== undefined) validateJsonObject(node.extra, 'extra')
    if (node.capabilities !== undefined) stringifyJson(node.capabilities, 'capabilities')
    if (nodes.has(node.id)) throw new PromptResourceStoreError('prompt_resource.node_duplicate', `Duplicate prompt resource node id: ${node.id}`)
    const stored: StoredNode = { ...node, resourceId, ...(parentId ? { parentId } : {}), orderIndex, createdAt: timestamp, updatedAt: timestamp }
    delete (stored as { children?: unknown }).children
    nodes.set(node.id, stored)
    for (const [index, child] of (node.children ?? []).entries()) visit(child, node.id, index)
  }
  visit(root, undefined, 0)
  return nodes
}

function toTree(root: StoredNode, nodes: Map<string, StoredNode>): PromptResourceTreeNode {
  const children = [...nodes.values()].filter(node => node.parentId === root.id).sort(compareOrder).map(node => toTree(node, nodes))
  const tree: PromptResourceTreeNode = {
    id: root.id,
    kind: root.kind,
    label: root.label,
    ...(root.category === undefined ? {} : { category: root.category }),
    ...(root.meta === undefined ? {} : { meta: root.meta }),
    ...(root.enabled === undefined ? {} : { enabled: root.enabled }),
    ...(root.body === undefined ? {} : { body: root.body }),
    ...(root.capabilities === undefined ? {} : { capabilities: root.capabilities }),
    ...(Object.keys(root.extra ?? {}).length === 0 ? {} : { extra: root.extra }),
    ...(children.length === 0 ? {} : { children }),
  }
  return tree
}

function nodeFromRow(row: NodeRow): StoredNode {
  return {
    id: row.id,
    resourceId: row.resource_id,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    orderIndex: row.order_index,
    kind: readNodeKind(row.kind),
    ...(row.category ? { category: readResourceKind(row.category) } : {}),
    label: row.label,
    ...(row.meta !== null ? { meta: row.meta } : {}),
    ...(row.enabled !== null ? { enabled: Boolean(row.enabled) } : {}),
    ...(row.body !== null ? { body: row.body } : {}),
    ...(row.capabilities_json !== null ? { capabilities: parseJson(row.capabilities_json, 'capabilities') } : {}),
    extra: parseObject(row.extra_json, 'extra'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function nodeFromDraft(draft: PromptResourceNodeDraft, resourceId: string, parentId: string, orderIndex: number, timestamp: string): StoredNode {
  return { ...draft, resourceId, parentId, orderIndex, createdAt: timestamp, updatedAt: timestamp }
}

function applyNodePatch(node: StoredNode, patch: PromptResourceNodePatch): StoredNode {
  const candidate: StoredNode = { ...node, updatedAt: node.updatedAt }
  if (patch.label !== undefined) candidate.label = patch.label.trim()
  if (patch.category !== undefined) {
    if (patch.category === null) delete candidate.category
    else candidate.category = patch.category
  }
  if (patch.meta !== undefined) {
    if (patch.meta === null) delete candidate.meta
    else candidate.meta = patch.meta
  }
  if (patch.enabled !== undefined) {
    if (patch.enabled === null) delete candidate.enabled
    else candidate.enabled = patch.enabled
  }
  if (patch.body !== undefined) {
    if (patch.body === null) delete candidate.body
    else candidate.body = patch.body
  }
  if (patch.capabilities !== undefined) {
    if (patch.capabilities === null) delete candidate.capabilities
    else candidate.capabilities = patch.capabilities
  }
  if (patch.extra !== undefined) {
    if (patch.extra === null) {
      if (Object.keys(candidate.extra ?? {}).length > 0) delete candidate.extra
    }
    else candidate.extra = patch.extra
  }
  return candidate
}

function mountFromRow(row: Record<string, unknown>): SettingMount {
  const sourceKind = row.source_kind
  const sourceId = row.source_id
  if ((sourceKind !== 'manual' && sourceKind !== 'preset') || typeof sourceId !== 'string') throw new PromptResourceStoreError('prompt_resource.mount_invalid', 'Invalid setting mount row')
  return {
    id: String(row.id),
    settingResourceId: String(row.setting_resource_id),
    source: sourceKind === 'manual' ? { kind: 'manual', id: 'global' } : { kind: 'preset', id: sourceId },
    orderIndex: Number(row.order_index),
    origin: parseObject(String(row.origin_json), 'origin'),
    createdAt: String(row.created_at),
  }
}

function validateTree(resourceId: string, nodes: Map<string, StoredNode>, rootId: string): void {
  const roots = [...nodes.values()].filter(node => !node.parentId)
  if (roots.length !== 1 || roots[0]?.id !== rootId) throw new PromptResourceStoreError('prompt_resource.root_invalid', `Prompt resource must have exactly one root: ${resourceId}`)
  for (const node of nodes.values()) {
    validateNodeShape(node)
    validateCategory(node.category)
    if (node.resourceId !== resourceId) throw new PromptResourceStoreError('prompt_resource.ownership', `Node belongs to another resource: ${node.id}`)
    if (node.parentId) {
      const parent = nodes.get(node.parentId)
      if (!parent) throw new PromptResourceStoreError('prompt_resource.parent_not_found', `Prompt resource parent not found: ${node.parentId}`)
      assertContainer(parent)
      if (isDescendant(nodes, node.id, node.parentId)) throw new PromptResourceStoreError('prompt_resource.cycle', `Prompt resource tree contains a cycle: ${node.id}`)
    }
  }
}

function validateNodeShape(node: Pick<PromptResourceNode, 'id' | 'kind' | 'label' | 'orderIndex'>): void {
  validateId(node.id, 'nodeId')
  if (!allowedNodeKinds.has(node.kind)) throw new PromptResourceStoreError('prompt_resource.kind_invalid', `Prompt resource node kind is invalid: ${node.kind}`)
  if (typeof node.label !== 'string' || !node.label.trim()) throw new PromptResourceStoreError('prompt_resource.label_invalid', `Prompt resource node label must be a non-empty string: ${node.id}`)
  validateOrderIndex(node.orderIndex)
}

function validateNodeDraft(node: PromptResourceNodeDraft): void {
  validateNodeShape({ id: node.id, kind: node.kind, label: node.label, orderIndex: node.orderIndex ?? 0 })
  validateCategory(node.category)
  if (node.extra !== undefined) validateJsonObject(node.extra, 'extra')
  if (node.capabilities !== undefined) stringifyJson(node.capabilities, 'capabilities')
}

function assertContainer(node: StoredNode): void {
  if (!containerNodeKinds.has(node.kind)) throw new PromptResourceStoreError('prompt_resource.parent_invalid', `Node cannot contain children: ${node.id}`)
}

function validateMountSource(database: DatabaseSync, source: SettingMountSource, requireTarget = true): void {
  if (source.kind === 'manual') {
    if (source.id !== undefined && source.id !== 'global') throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', 'Manual Setting mount source id must be global')
    return
  }
  validateId(source.id, 'presetId')
  const preset = requireResourceRow(database, source.id)
  if (preset.resource_kind !== 'preset' || preset.tombstoned) throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', `Mount source is not an active Preset: ${source.id}`)
  if (!requireTarget) return
}

function requireSetting(database: DatabaseSync, id: string): void {
  const row = requireResourceRow(database, id)
  if (row.resource_kind !== 'setting' || row.tombstoned) throw new PromptResourceStoreError('prompt_resource.setting_invalid', `Mount target is not an active Setting: ${id}`)
}

function assertExpectedVersion(row: ResourceRow, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new PromptResourceStoreError('prompt_resource.expected_version_invalid', 'Expected resource version must be a positive integer')
  if (row.version !== expectedVersion) throw new PromptResourceStoreError('prompt_resource.conflict', `Prompt resource version conflict: ${row.id}`)
}

function validateResourceKind(kind: string): asserts kind is PromptResource['resourceKind'] {
  if (!['preset', 'setting', 'logic', 'runtime', 'history', 'prompt'].includes(kind)) throw new PromptResourceStoreError('prompt_resource.resource_kind_invalid', `Prompt resource kind is invalid: ${kind}`)
}

function validateCategory(category: string | null | undefined): void {
  if (category !== undefined && category !== null) validateResourceKind(category)
}

function validateJsonObject(value: JsonObject | undefined, label: string): void {
  if (value === undefined || value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} must be a JSON object`)
  }
}

function readResourceKind(kind: string): PromptResource['resourceKind'] {
  validateResourceKind(kind)
  return kind
}

function readNodeKind(kind: string): PromptResourceNode['kind'] {
  if (!allowedNodeKinds.has(kind)) throw new PromptResourceStoreError('prompt_resource.kind_invalid', `Prompt resource node kind is invalid: ${kind}`)
  return kind as PromptResourceNode['kind']
}

function validateId(id: unknown, label: string, optional = false): void {
  if (id === undefined && optional) return
  if (typeof id !== 'string' || !id || id.trim() !== id) throw new PromptResourceStoreError('prompt_resource.id_invalid', `${label} must be a non-empty trimmed string`)
}

function validateOrderIndex(orderIndex: number): void {
  if (!Number.isInteger(orderIndex) || orderIndex < 0) throw new PromptResourceStoreError('prompt_resource.order_invalid', 'Prompt resource orderIndex must be a non-negative integer')
}

function nextSiblingOrder(nodes: Map<string, StoredNode>, parentId: string): number {
  return Math.max(-1, ...[...nodes.values()].filter(node => node.parentId === parentId).map(node => node.orderIndex)) + 1
}

function requireNode(nodes: Map<string, StoredNode>, id: string): StoredNode {
  validateId(id, 'nodeId')
  const node = nodes.get(id)
  if (!node) throw new PromptResourceStoreError('prompt_resource.node_not_found', `Prompt resource node not found: ${id}`)
  return node
}

function collectSubtree(nodes: Map<string, StoredNode>, rootId: string): string[] {
  const result: string[] = []
  const visit = (id: string): void => {
    result.push(id)
    for (const child of nodes.values()) if (child.parentId === id) visit(child.id)
  }
  visit(rootId)
  return result
}

function nodeDepth(nodes: Map<string, StoredNode>, id: string): number {
  let depth = 0
  let current = nodes.get(id)
  while (current?.parentId) {
    depth += 1
    current = nodes.get(current.parentId)
  }
  return depth
}

function isDescendant(nodes: Map<string, StoredNode>, ancestorId: string, possibleDescendantId: string): boolean {
  if (ancestorId === possibleDescendantId) return true
  let current = nodes.get(possibleDescendantId)
  while (current?.parentId) {
    if (current.parentId === ancestorId) return true
    current = nodes.get(current.parentId)
  }
  return false
}

function cloneNodeMap(nodes: Map<string, StoredNode>): Map<string, StoredNode> {
  return new Map([...nodes.entries()].map(([id, node]) => [id, structuredClone(node) as StoredNode]))
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
  } catch {
    return false
  }
}

function canonicalJson(value: unknown, seen = new Set<unknown>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) throw new Error('cyclic JSON')
  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.map(item => canonicalJson(item, seen))
    seen.delete(value)
    return result
  }
  const object = value as Record<string, unknown>
  const result = Object.fromEntries(Object.keys(object).sort().map(key => [key, canonicalJson(object[key], seen)]))
  seen.delete(value)
  return result
}

function sameNodeValue(left: StoredNode, right: StoredNode): boolean {
  return sameJson(left, right)
}

function revisionOperation(before: StoredNode | undefined, after: StoredNode | undefined): 'create' | 'update' | 'move' | 'delete' {
  if (!before && after) return 'create'
  if (before && !after) return 'delete'
  if (!before || !after) throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Revision must have a before or after node')
  return before.parentId !== after.parentId || before.orderIndex !== after.orderIndex ? 'move' : 'update'
}

function compareOrder(left: StoredNode, right: StoredNode): number {
  return left.orderIndex - right.orderIndex || left.id.localeCompare(right.id)
}

function parseJson(value: string | undefined, label: string): JsonValue {
  if (!value) throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} is missing`)
  try { return JSON.parse(value) as JsonValue } catch { throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} is invalid JSON`) }
}

function parseObject(value: string | undefined, label: string): JsonObject {
  const parsed = parseJson(value, label)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} must be a JSON object`)
  return parsed as JsonObject
}

function parseNode(value: string): StoredNode {
  const parsed = parseJson(value, 'node revision')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Node revision must be a JSON object')
  return parsed as StoredNode
}

function stringifyJson(value: unknown, label: string): string {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('undefined')
    return serialized
  } catch {
    throw new PromptResourceStoreError('prompt_resource.json_invalid', `${label} cannot be serialized as JSON`)
  }
}

function isMountUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: global_setting_mounts.')
}

function isPromptResourceOperation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const operation = value as Record<string, unknown>
  return operation.store === 'prompt-resources' && operation.entityType === 'prompt-resource' && typeof operation.entityId === 'string'
}

function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE prompt_resources (
      id TEXT PRIMARY KEY,
      resource_kind TEXT NOT NULL CHECK (resource_kind IN ('preset', 'setting', 'logic', 'runtime', 'history', 'prompt')),
      root_node_id TEXT NOT NULL,
      label TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_json TEXT,
      delete_reason TEXT
    );

    CREATE TABLE prompt_resource_nodes (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      parent_id TEXT,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('module', 'folder', 'entry', 'script', 'virtual', 'order')),
      category TEXT,
      label TEXT NOT NULL,
      meta TEXT,
      enabled INTEGER,
      body TEXT,
      capabilities_json TEXT,
      extra_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(resource_id, id),
      FOREIGN KEY(resource_id, parent_id) REFERENCES prompt_resource_nodes(resource_id, id)
    );

    CREATE TABLE global_setting_mounts (
      id TEXT PRIMARY KEY,
      setting_resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'preset')),
      source_id TEXT NOT NULL,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      origin_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(setting_resource_id, source_kind, source_id)
    );

    CREATE TABLE prompt_resource_node_revisions (
      resource_id TEXT NOT NULL,
      resource_version INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'move', 'delete')),
      before_json TEXT,
      after_json TEXT,
      changeset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      PRIMARY KEY(resource_id, resource_version, node_id)
    );

    CREATE TABLE prompt_resource_header_revisions (
      resource_id TEXT NOT NULL,
      resource_version INTEGER NOT NULL,
      before_json TEXT,
      after_json TEXT,
      changeset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      PRIMARY KEY(resource_id, resource_version)
    );

    CREATE UNIQUE INDEX idx_prompt_resource_one_root
      ON prompt_resource_nodes(resource_id) WHERE parent_id IS NULL;
    CREATE INDEX idx_prompt_resources_kind_label ON prompt_resources(resource_kind, label);
    CREATE INDEX idx_prompt_resource_nodes_parent_order ON prompt_resource_nodes(resource_id, parent_id, order_index, id);
    CREATE INDEX idx_prompt_resource_nodes_kind ON prompt_resource_nodes(resource_id, kind);
    CREATE INDEX idx_global_setting_mounts_source ON global_setting_mounts(source_kind, source_id, order_index, id);
    CREATE INDEX idx_global_setting_mounts_setting ON global_setting_mounts(setting_resource_id);
    CREATE INDEX idx_prompt_resource_revisions_changeset ON prompt_resource_node_revisions(changeset_id);
    CREATE INDEX idx_prompt_resource_header_revisions_changeset ON prompt_resource_header_revisions(changeset_id);
  `)
}
