import type { SqliteDataEngine, SqliteDataTransaction } from '@loom-studio/data-engine'
import { createId, nowIso } from '@loom-studio/shared'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type ListPromptResourcesInput,
  type PromptResource,
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
  migrateVersionOne,
  migrateVersionTwo,
  migrateVersionThree,
  migrateVersionFour,
  migrateVersionFive,
  assertPromptResourceSchema,
  migrationNamespace,
} from './schema.js'
import {
  applyAddPresetToolMount,
  applyAddSettingMount,
  applyReplacePresetToolMounts,
  applyReplaceSettingMounts,
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

export function createPromptResourceStore(options: PromptResourceStoreOptions): PromptResourceStore {
  const nextId = options.createId ?? createId
  const now = options.now ?? nowIso
  const { engine } = options
  engine.migrate({
    namespace: migrationNamespace,
    migrations: [
      { version: 1, migrate: migrateVersionOne },
      { version: 2, migrate: migrateVersionTwo },
      { version: 3, migrate: migrateVersionThree },
      { version: 4, migrate: migrateVersionFour },
      { version: 5, migrate: migrateVersionFive },
    ],
  })
  const database = engine.database
  assertPromptResourceSchema(database)

  function transaction(tx: SqliteDataTransaction): PromptResourceTransaction {
    return {
      createResource: input => applyCreateResource(database, tx, input, nextId, now),
      mutateResource: input => applyMutateResource(database, tx, input, now),
      deleteResource: input => applyDeleteResource(database, tx, input, now),
      restoreResource: input => applyRestoreResource(database, tx, input, now),
      addSettingMount: input => applyAddSettingMount(database, tx, input, nextId, now),
      replaceSettingMounts: input => applyReplaceSettingMounts(database, tx, input, nextId, now),
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
    getResource: (id, readOptions) => engine.read(database => readResource(database, id, readOptions?.includeTombstone ?? false)),
    getResourceMetadataAtVersion: (id, version) => engine.read(database => readResourceMetadataAtVersion(database, id, version)),
    listResources: input => engine.read(database => listResources(database, input)),
    listSettingMounts: input => engine.read(database => listMounts(database, input)),
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
    addSettingMount: async input => {
      const result = await runTransaction(input, tx => transaction(tx).addSettingMount(input))
      return { mounts: [result.value], commit: result.commit }
    },
    replaceSettingMounts: async input => {
      const result = await runTransaction(input, tx => transaction(tx).replaceSettingMounts(input))
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
  const rows = database.prepare(`SELECT id, updated_at FROM prompt_resources WHERE ${clauses.join(' AND ')} ORDER BY ${order === 'id' ? 'id DESC' : 'updated_at DESC, id DESC'} LIMIT ?`).all(...values, limit + 1) as Array<{ id: string; updated_at: string }>
  const resources = rows.slice(0, limit).map(row => readResource(database, row.id, true)).filter((resource): resource is PromptResource => resource !== null)
  const last = rows[limit - 1]
  return {
    resources,
    nextCursor: rows.length > limit && last
      ? JSON.stringify([order, last.id, order === 'updatedAt' ? last.updated_at : null, input.resourceKind ?? null, Boolean(input.includeTombstone)])
      : undefined,
  }
}
