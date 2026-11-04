import type { SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type ListPromptResourcesInput,
  type PromptResource,
  type PromptResourceHeader,
  type PromptResourcePage,
  type PromptResourceStore,
  type PromptResourceStoreOptions,
  type PromptResourceTransaction,
  type PromptResourceWriteContext,
} from './types.js'
import {
  defaultPageLimit,
  maximumPageLimit,
  validateResourceKind,
} from './tree.js'
import {
  assertPromptResourceSchema,
  schemaNamespace,
  initializePromptResourceSchema,
} from './schema.js'
import {
  applyAddPresetToolMount,
  applyAddLoreMount,
  applyReplacePresetToolMounts,
  applyReplaceLoreMounts,
  listMounts,
  listPresetToolMounts,
} from './mounts.js'
import {
  applyCreateResource,
  applyDeleteResource,
  applyMutateResource,
  applyRestoreResource,
  applyRevert,
  readResource,
  readResourceMetadataAtVersion,
} from './mutations.js'
import { initializeSearchFunctions, listSearchResources, listSearchNodes, searchNodes } from './search.js'

export function createPromptResourceStore(options: PromptResourceStoreOptions): PromptResourceStore {
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso
  const { engine } = options
  engine.initializeSchema({ namespace: schemaNamespace, version: 9, initialize: initializePromptResourceSchema })
  const database = engine.database
  assertPromptResourceSchema(database)
  initializeSearchFunctions(database)

  function transaction(tx: SqliteDataTransaction): PromptResourceTransaction {
    return {
      listResources: input => listResources(database, input),
      listLoreMounts: input => listMounts(database, input),
      listPresetToolMounts: input => listPresetToolMounts(database, input),
      createResource: input => applyCreateResource(database, tx, input, nextId, now),
      mutateResource: input => applyMutateResource(database, tx, input, now),
      deleteResource: input => applyDeleteResource(database, tx, input, now),
      restoreResource: input => applyRestoreResource(database, tx, input, now),
      addLoreMount: input => applyAddLoreMount(database, tx, input, nextId, now),
      replaceLoreMounts: input => applyReplaceLoreMounts(database, tx, input, nextId, now),
      addPresetToolMount: input => applyAddPresetToolMount(database, tx, input, nextId, now),
      replacePresetToolMounts: input => applyReplacePresetToolMounts(database, tx, input, nextId, now),
    }
  }

  async function runTransaction<T>(
    context: { actor: PromptResourceWriteContext['actor']; reason?: string; correlationId?: string; callId?: string; parentCallId?: string },
    callback: (tx: SqliteDataTransaction) => T,
  ): Promise<{ value: T; commit: Awaited<ReturnType<SqliteDataEngine['transact']>>['commit'] }> {
    return engine.transact(context, tx => Promise.resolve(callback(tx)))
  }

  return {
    hasResource: id => engine.read(database => Boolean(database.prepare(
      'SELECT 1 FROM prompt_resources WHERE id = ? AND tombstoned = 0',
    ).get(id))),
    getResource: (id, readOptions) => engine.read(database => readResource(database, id, readOptions?.includeTombstone ?? false)),
    getResourceMetadataAtVersion: (id, version) => engine.read(database => readResourceMetadataAtVersion(database, id, version)),
    listResources: input => engine.read(database => listResources(database, input)),
    listResourceHeaders: input => engine.read(database => listResourceHeaders(database, input)),
    listSearchResources: () => engine.read(database => listSearchResources(database)),
    searchNodes: input => engine.read(database => searchNodes(database, input)),
    listSearchNodes: input => engine.read(database => listSearchNodes(database, input)),
    listLoreMounts: input => engine.read(database => listMounts(database, input)),
    listPresetToolMounts: input => engine.read(database => listPresetToolMounts(database, input)),
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
    restoreResource: async input => {
      const result = await runTransaction(input, tx => transaction(tx).restoreResource(input))
      return { resource: result.value, commit: result.commit }
    },
    addLoreMount: async input => {
      const result = await runTransaction(input, tx => transaction(tx).addLoreMount(input))
      return { mounts: [result.value], commit: result.commit }
    },
    replaceLoreMounts: async input => {
      const result = await runTransaction(input, tx => transaction(tx).replaceLoreMounts(input))
      return { mounts: result.value, commit: result.commit }
    },
    addPresetToolMount: async input => {
      const result = await runTransaction(input, tx => transaction(tx).addPresetToolMount(input))
      return { mounts: [result.value], commit: result.commit }
    },
    replacePresetToolMounts: async input => {
      const result = await runTransaction(input, tx => transaction(tx).replacePresetToolMounts(input))
      return { mounts: result.value, commit: result.commit }
    },
    revertChangeset: async input => {
      const result = await runTransaction(input, tx => applyRevert(database, tx, input, now))
      return { resource: result.value, commit: result.commit }
    },
    transaction,
  }
}

function listResources(database: DatabaseSync, input: ListPromptResourcesInput = {}): PromptResourcePage {
  const page = listResourceHeaders(database, input)
  return { ...page, resources: page.resources.map(row => readResource(database, row.id, true)).filter((resource): resource is PromptResource => resource !== null) }
}

function listResourceHeaders(database: DatabaseSync, input: ListPromptResourcesInput = {}): { resources: PromptResourceHeader[]; nextCursor?: string } {
  const limit = input.limit ?? defaultPageLimit
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumPageLimit) throw new PromptResourceStoreError('prompt_resource.limit_invalid', `Prompt resource list limit must be between 1 and ${maximumPageLimit}`)
  const order = input.order ?? 'updatedAt'
  if (order !== 'updatedAt' && order !== 'id') throw new PromptResourceStoreError('prompt_resource.input_invalid', 'Invalid Prompt resource list order')
  const clauses = [input.includeTombstone ? '1 = 1' : 'tombstoned = 0']
  const values: Array<string | number> = []
  if (input.resourceKind) { validateResourceKind(input.resourceKind); clauses.push('resource_kind = ?'); values.push(input.resourceKind) }
  if (input.cursor !== undefined) {
    let cursor: unknown
    try { cursor = JSON.parse(input.cursor) } catch {
      throw new PromptResourceStoreError('prompt_resource.cursor_invalid', 'Invalid Prompt resource cursor')
    }
    if (!Array.isArray(cursor) || cursor.length !== 5 || cursor[0] !== order
      || typeof cursor[1] !== 'string' || !cursor[1]
      || (order === 'updatedAt' ? typeof cursor[2] !== 'string' || !cursor[2] : cursor[2] !== null)
      || cursor[3] !== (input.resourceKind ?? null) || cursor[4] !== Boolean(input.includeTombstone)) {
      throw new PromptResourceStoreError('prompt_resource.cursor_invalid', 'Prompt resource cursor is invalid or belongs to different filters')
    }
    if (order === 'id') {
      clauses.push('id < ?')
      values.push(cursor[1])
    } else {
      clauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
      values.push(cursor[2] as string, cursor[2] as string, cursor[1])
    }
  }
  const rows = database.prepare(`SELECT id, resource_kind, root_node_id, label, version, created_at, updated_at, tombstoned FROM prompt_resources WHERE ${clauses.join(' AND ')} ORDER BY ${order === 'id' ? 'id DESC' : 'updated_at DESC, id DESC'} LIMIT ?`).all(...values, limit + 1) as Array<{ id: string; resource_kind: string; root_node_id: string; label: string; version: number; created_at: string; updated_at: string; tombstoned: number }>
  const resources = rows.slice(0, limit).map(row => ({
    id: row.id, resourceKind: row.resource_kind, rootNodeId: row.root_node_id, label: row.label,
    version: row.version, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.tombstoned ? { tombstoned: true } : {}),
  }))
  const last = rows[limit - 1]
  return {
    resources,
    nextCursor: rows.length > limit && last
      ? JSON.stringify([order, last.id, order === 'updatedAt' ? last.updated_at : null, input.resourceKind ?? null, Boolean(input.includeTombstone)])
      : undefined,
  }
}
