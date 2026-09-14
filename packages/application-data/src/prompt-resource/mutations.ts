import type { DataCommitOperation, SqliteDataTransaction } from '@loom-studio/data-engine'
import { nowIso, type JsonObject } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type CreatePromptResourceInput,
  type DeletePromptResourceInput,
  type MutatePromptResourceInput,
  type PromptResource,
  type PromptResourceWriteContext,
  type RestorePromptResourceInput,
  type RevertPromptResourceChangesetInput,
} from './types.js'
import {
  applyNodePatch,
  assertContainer,
  cloneNodeMap,
  collectSubtree,
  flattenTree,
  isDescendant,
  isPromptResourceOperation,
  nextSiblingOrder,
  nodeDepth,
  nodeFromDraft,
  nodeFromRow,
  parseJson,
  parseNode,
  parseObject,
  readResourceKind,
  requireNode,
  sameJson,
  sameNodeValue,
  stringifyJson,
  toTree,
  validateCategory,
  validateId,
  validateJsonObject,
  validateNodeDraft,
  validateOrderIndex,
  validateResourceKind,
  validateTree,
  type HeaderRevisionRow,
  type HeaderState,
  type NodeRow,
  type ResourceRow,
  type RevisionRow,
  type StoredNode,
} from './tree.js'

export function applyCreateResource(
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

export function applyMutateResource(
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
  insertHeaderRevision(database, tx, row.id, version, headerStateFromRow(row), headerStateFromValues(header.label, header.metadata))
  for (const id of changedIds) {
    const previous = before.get(id)
    const current = after.get(id)
    insertRevision(database, tx, resource, id, revisionOperation(previous, current), previous, current)
  }
  tx.recordOperations([operation('update', row.id, 'prompt-resource', row.version, version)])
  return resource
}

export function applyDeleteResource(
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
    recordDeletedPresetToolMountOperations(database, tx, input.resourceId)
    database.prepare('DELETE FROM preset_tool_mounts WHERE preset_resource_id = ?').run(input.resourceId)
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

export function applyRestoreResource(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<RestorePromptResourceInput, keyof PromptResourceWriteContext>,
  now: () => string,
): PromptResource {
  const row = requireResourceRow(database, input.resourceId)
  if (!row.tombstoned) throw new PromptResourceStoreError('prompt_resource.active', `Prompt resource is already active: ${input.resourceId}`)
  if (input.expectedVersion !== undefined) assertExpectedVersion(row, input.expectedVersion)
  const timestamp = now()
  const version = row.version + 1
  database.prepare(`
    UPDATE prompt_resources
    SET version = ?, updated_at = ?, tombstoned = 0, deleted_at = NULL, deleted_by_json = NULL, delete_reason = NULL
    WHERE id = ?
  `).run(version, timestamp, input.resourceId)
  const resource = readResource(database, input.resourceId, false)
  if (!resource) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${input.resourceId}`)
  insertHeaderRevision(database, tx, input.resourceId, version, headerStateFromRow(row), {
    label: row.label,
    metadata: parseObject(row.metadata_json, 'metadata'),
    tombstoned: false,
  })
  tx.recordOperations([operation('restore', input.resourceId, 'prompt-resource', row.version, version)])
  return resource
}

export function applyRevert(
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

export function readResource(database: DatabaseSync, id: string, includeTombstone: boolean): PromptResource | null {
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
    ...(row.tombstoned ? {
      tombstoned: true,
      deletedAt: row.deleted_at ?? undefined,
      deletedBy: row.deleted_by_json ? (parseJson(row.deleted_by_json, 'deletedBy') as never) : undefined,
      deleteReason: row.delete_reason ?? undefined,
    } : {}),
  }
}

export function readResourceRow(database: DatabaseSync, id: string): ResourceRow | undefined {
  return database.prepare('SELECT * FROM prompt_resources WHERE id = ?').get(id) as ResourceRow | undefined
}

export function headerStateFromRow(row: ResourceRow): HeaderState {
  return {
    label: row.label,
    metadata: parseObject(row.metadata_json, 'metadata'),
    tombstoned: row.tombstoned === 1,
    deletedAt: row.deleted_at ?? undefined,
    deletedBy: row.deleted_by_json ? parseObject(row.deleted_by_json, 'deletedBy') : undefined,
    deleteReason: row.delete_reason ?? undefined,
  }
}

export function headerStateFromValues(label: string, metadata: JsonObject): HeaderState {
  return { label, metadata: structuredClone(metadata), tombstoned: false }
}

export function parseHeaderState(value: string): HeaderState {
  const parsed = parseObject(value, 'header revision')
  return {
    label: typeof parsed.label === 'string' ? parsed.label : '',
    metadata: parseObject(stringifyJson(parsed.metadata, 'metadata'), 'metadata'),
    tombstoned: Boolean(parsed.tombstoned),
    deletedAt: typeof parsed.deletedAt === 'string' ? parsed.deletedAt : undefined,
    deletedBy: parsed.deletedBy,
    deleteReason: typeof parsed.deleteReason === 'string' ? parsed.deleteReason : undefined,
  }
}

export function updateResourceHeader(database: DatabaseSync, resourceId: string, version: number, timestamp: string, header: HeaderState): void {
  database.prepare(`
    UPDATE prompt_resources
    SET label = ?, metadata_json = ?, version = ?, updated_at = ?,
        tombstoned = ?, deleted_at = ?, deleted_by_json = ?, delete_reason = ?
    WHERE id = ?
  `).run(
    header.label,
    stringifyJson(header.metadata, 'metadata'),
    version,
    timestamp,
    header.tombstoned ? 1 : 0,
    header.deletedAt ?? null,
    header.deletedBy ? stringifyJson(header.deletedBy, 'deletedBy') : null,
    header.deleteReason ?? null,
    resourceId,
  )
}

export function requireResourceRow(database: DatabaseSync, id: string): ResourceRow {
  const row = readResourceRow(database, id)
  if (!row) throw new PromptResourceStoreError('prompt_resource.not_found', `Prompt resource not found: ${id}`)
  return row
}

export function readNodeMap(database: DatabaseSync, resourceId: string): Map<string, StoredNode> {
  const rows = database.prepare('SELECT * FROM prompt_resource_nodes WHERE resource_id = ? ORDER BY parent_id ASC, order_index ASC, id ASC').all(resourceId) as unknown as NodeRow[]
  return new Map(rows.map(row => [row.id, nodeFromRow(row)]))
}

export function insertNode(database: DatabaseSync, node: StoredNode): void {
  database.prepare(`
    INSERT INTO prompt_resource_nodes (
      id, resource_id, parent_id, order_index, kind, category, label, meta, enabled,
      body, capabilities_json, extra_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    node.id, node.resourceId, node.parentId ?? null, node.orderIndex, node.kind, node.category ?? null, node.label,
    node.meta ?? null, node.enabled === undefined ? null : (node.enabled ? 1 : 0), node.body ?? null,
    node.capabilities ? stringifyJson(node.capabilities, 'capabilities') : null, stringifyJson(node.extra ?? {}, 'extra'), node.createdAt, node.updatedAt,
  )
}

export function updateNode(database: DatabaseSync, node: StoredNode): void {
  database.prepare(`
    UPDATE prompt_resource_nodes
    SET parent_id = ?, order_index = ?, kind = ?, category = ?, label = ?, meta = ?, enabled = ?,
        body = ?, capabilities_json = ?, extra_json = ?, updated_at = ?
    WHERE id = ? AND resource_id = ?
  `).run(
    node.parentId ?? null, node.orderIndex, node.kind, node.category ?? null, node.label, node.meta ?? null,
    node.enabled === undefined ? null : (node.enabled ? 1 : 0), node.body ?? null,
    node.capabilities ? stringifyJson(node.capabilities, 'capabilities') : null, stringifyJson(node.extra ?? {}, 'extra'), node.updatedAt,
    node.id, node.resourceId,
  )
}

export function deleteNode(database: DatabaseSync, id: string): void {
  database.prepare('DELETE FROM prompt_resource_nodes WHERE id = ?').run(id)
}

export function insertRevision(database: DatabaseSync, tx: SqliteDataTransaction, resource: PromptResource, nodeId: string, operationKind: 'create' | 'update' | 'move' | 'delete', before: StoredNode | undefined, after: StoredNode | undefined): void {
  database.prepare(`
    INSERT INTO prompt_resource_node_revisions (
      resource_id, resource_version, node_id, operation, before_json, after_json, changeset_id, created_at, created_by_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    resource.id, resource.version, nodeId, operationKind, before ? stringifyJson(before, 'before node') : null,
    after ? stringifyJson(after, 'after node') : null, tx.changesetId, resource.updatedAt, stringifyJson(tx.actor, 'actor'),
  )
}

export function insertHeaderRevision(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  resourceId: string,
  resourceVersion: number,
  before: HeaderState | undefined,
  after: HeaderState,
): void {
  database.prepare(`
    INSERT INTO prompt_resource_header_revisions (
      resource_id, resource_version, before_json, after_json, changeset_id, created_at, created_by_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    resourceId, resourceVersion, before ? stringifyJson(before, 'before header') : null,
    stringifyJson(after, 'after header'), tx.changesetId, nowIso(), stringifyJson(tx.actor, 'actor'),
  )
}

export function operation(kind: DataCommitOperation['kind'], entityId: string, entityType: string, fromVersion?: number, toVersion?: number): DataCommitOperation {
  return {
    kind,
    store: 'prompt-resources',
    entityType,
    entityId,
    ...(fromVersion !== undefined ? { fromVersion } : {}),
    ...(toVersion !== undefined ? { toVersion } : {}),
  }
}

export function recordDeletedMountOperations(database: DatabaseSync, tx: SqliteDataTransaction, where: string, ...values: string[]): void {
  const rows = database.prepare(`SELECT id FROM global_setting_mounts WHERE ${where} ORDER BY id ASC`).all(...values) as Array<{ id: string }>
  if (rows.length > 0) tx.recordOperations(rows.map(row => operation('delete', row.id, 'prompt-resource.mount')))
}

export function recordDeletedPresetToolMountOperations(database: DatabaseSync, tx: SqliteDataTransaction, presetResourceId: string): void {
  const rows = database.prepare('SELECT id FROM preset_tool_mounts WHERE preset_resource_id = ? ORDER BY id ASC').all(presetResourceId) as Array<{ id: string }>
  if (rows.length > 0) tx.recordOperations(rows.map(row => operation('delete', row.id, 'prompt-resource.tool-mount')))
}

export function assertExpectedVersion(row: ResourceRow, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new PromptResourceStoreError('prompt_resource.expected_version_invalid', 'Expected resource version must be a positive integer')
  if (row.version !== expectedVersion) throw new PromptResourceStoreError('prompt_resource.conflict', `Prompt resource version conflict: ${row.id}`)
}

export function revisionOperation(before: StoredNode | undefined, after: StoredNode | undefined): 'create' | 'update' | 'move' | 'delete' {
  if (!before && after) return 'create'
  if (before && !after) return 'delete'
  if (!before || !after) throw new PromptResourceStoreError('prompt_resource.revision_invalid', 'Revision must have a before or after node')
  return before.parentId !== after.parentId || before.orderIndex !== after.orderIndex ? 'move' : 'update'
}
