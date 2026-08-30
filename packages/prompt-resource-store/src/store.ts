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
    ],
  })
  const database = engine.database

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

export function listResources(database: DatabaseSync, input: ListPromptResourcesInput = {}): PromptResourcePage {
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
