import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type AddPresetToolMountInput,
  type AddLoreMountInput,
  type ListPresetToolMountsInput,
  type ListLoreMountsInput,
  type PresetToolMount,
  type PromptResourceWriteContext,
  type ReplacePresetToolMountsInput,
  type ReplaceLoreMountsInput,
  type LoreMount,
  type LoreMountSource,
} from './types.js'
import {
  parseObject,
  stringifyJson,
  validateId,
  validateJsonObject,
  validateOrderIndex,
} from './tree.js'
import {
  operation,
  resourceScope,
  requireResourceRow,
  recordDeletedMountOperations,
  recordDeletedPresetToolMountOperations,
} from './mutations.js'

function mountFromRow(row: Record<string, unknown>): LoreMount {
  const sourceKind = row.source_kind
  const sourceId = row.source_id
  if ((sourceKind !== 'manual' && sourceKind !== 'preset') || typeof sourceId !== 'string') throw new PromptResourceStoreError('prompt_resource.mount_invalid', 'Invalid lore mount row')
  const reference = row.reference_json === null ? undefined : parseObject(String(row.reference_json), 'Lore mount reference') as LoreMount['reference']
  return {
    id: String(row.id),
    loreResourceId: row.lore_resource_id === null
      ? reference?.kind === 'external' ? reference.resourceId : reference?.contributionId ?? ''
      : String(row.lore_resource_id),
    ...(reference ? { reference, resolvedLoreResourceId: row.lore_resource_id === null ? null : String(row.lore_resource_id) } : {}),
    source: sourceKind === 'manual' ? { kind: 'manual', id: 'global' } : { kind: 'preset', id: sourceId },
    orderIndex: Number(row.order_index),
    origin: parseObject(String(row.origin_json), 'origin'),
    createdAt: String(row.created_at),
  }
}

function validateMountReference(reference: LoreMount['reference']): void {
  if (reference?.kind === 'package') {
    validateId(reference.contributionId, 'Lore contributionId')
  } else if (reference?.kind === 'external') {
    validateId(reference.resourceId, 'external Lore resourceId')
    if (reference.origin) {
      validateId(reference.origin.packageId, 'external Lore packageId')
      validateId(reference.origin.contributionId, 'external Lore contributionId')
      if (reference.origin.target !== 'global' && reference.origin.target !== 'card') {
        throw new PromptResourceStoreError('prompt_resource.mount_reference_invalid', 'Invalid external Lore target')
      }
    }
  } else if (reference !== undefined) {
    throw new PromptResourceStoreError('prompt_resource.mount_reference_invalid', 'Invalid Lore mount reference')
  }
}

function presetToolMountFromRow(row: Record<string, unknown>): PresetToolMount {
  const activation = row.activation_json === null ? undefined : parseObject(String(row.activation_json), 'tool mount activation')
  const providerOrder = row.provider_order === null ? undefined : Number(row.provider_order)
  const targetAnchorId = row.target_anchor_id === null ? undefined : String(row.target_anchor_id)
  const localDepth = row.local_depth === null ? undefined : Number(row.local_depth)
  const hasContent = targetAnchorId !== undefined || localDepth !== undefined
  return {
    id: String(row.id),
    presetResourceId: String(row.preset_resource_id),
    toolId: String(row.tool_id),
    orderIndex: Number(row.order_index),
    defaultEnabled: Boolean(row.default_enabled),
    ...(activation ? { activation } : {}),
    ...(providerOrder === undefined ? {} : { provider: { order: providerOrder } }),
    ...(hasContent ? { content: {
      ...(targetAnchorId === undefined ? {} : { targetAnchorId }),
      ...(localDepth === undefined ? {} : { localDepth }),
    } } : {}),
    origin: parseObject(String(row.origin_json), 'tool mount origin'),
    createdAt: String(row.created_at),
  }
}

function validateMountSource(database: DatabaseSync, source: LoreMountSource, requireTarget = true): void {
  if (source.kind === 'manual') {
    if (source.id !== undefined && source.id !== 'global') throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', 'Manual Lore mount source id must be global')
    return
  }
  validateId(source.id, 'presetId')
  const preset = requireResourceRow(database, source.id)
  if (preset.resource_kind !== 'preset' || preset.tombstoned) throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', `Mount source is not an active Preset: ${source.id}`)
  if (!requireTarget) return
}

function requireLore(database: DatabaseSync, id: string): void {
  const row = requireResourceRow(database, id)
  if (row.resource_kind !== 'lore' || row.tombstoned) throw new PromptResourceStoreError('prompt_resource.lore_invalid', `Mount target is not an active Lore: ${id}`)
}

function requirePreset(database: DatabaseSync, id: string): void {
  const row = requireResourceRow(database, id)
  if (row.resource_kind !== 'preset' || row.tombstoned) throw new PromptResourceStoreError('prompt_resource.preset_invalid', `Tool mount source is not an active Preset: ${id}`)
}

function validatePresetToolMountFields(input: Pick<AddPresetToolMountInput, 'defaultEnabled' | 'activation' | 'provider' | 'content' | 'origin'>): void {
  if (typeof input.defaultEnabled !== 'boolean') throw new PromptResourceStoreError('prompt_resource.tool_mount_enabled_invalid', 'Tool mount defaultEnabled must be a boolean')
  if (input.activation !== undefined) validateJsonObject(input.activation, 'tool mount activation')
  if (input.origin !== undefined) validateJsonObject(input.origin, 'tool mount origin')
  if (input.provider?.order !== undefined && !Number.isFinite(input.provider.order)) {
    throw new PromptResourceStoreError('prompt_resource.tool_mount_provider_order_invalid', 'Tool mount provider order must be finite')
  }
  if (input.content) {
    if (input.content.targetAnchorId !== undefined && (typeof input.content.targetAnchorId !== 'string' || !input.content.targetAnchorId.trim())) {
      throw new PromptResourceStoreError('prompt_resource.tool_mount_content_invalid', `Tool mount content targetAnchorId must be a non-empty string`)
    }
    if (input.content.localDepth !== undefined && !Number.isFinite(input.content.localDepth)) {
      throw new PromptResourceStoreError('prompt_resource.tool_mount_content_order_invalid', 'Tool mount content localDepth must be finite')
    }
  }
}

function isMountUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: global_lore_mounts.')
}

function isPresetToolMountUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: preset_tool_mounts.')
}

export function applyAddLoreMount(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<AddLoreMountInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): LoreMount {
  validateMountSource(database, input.source)
  validateMountReference(input.reference)
  if (input.loreResourceId === null) {
    if (!input.reference) throw new PromptResourceStoreError('prompt_resource.mount_reference_invalid', 'Unresolved Lore mount requires a reference')
  } else {
    validateId(input.loreResourceId, 'loreResourceId')
    requireLore(database, input.loreResourceId)
  }
  validateOrderIndex(input.orderIndex)
  if (input.origin !== undefined) validateJsonObject(input.origin, 'mount origin')
  const mount: LoreMount = {
    id: nextId('lore-mount'),
    loreResourceId: input.loreResourceId ?? (input.reference?.kind === 'external' ? input.reference.resourceId : input.reference?.contributionId ?? ''),
    ...(input.reference ? { resolvedLoreResourceId: input.loreResourceId } : {}),
    ...(input.reference ? { reference: input.reference } : {}),
    source: input.source.kind === 'manual' ? { kind: 'manual', id: 'global' } : { kind: 'preset', id: input.source.id },
    orderIndex: input.orderIndex,
    origin: input.origin ?? {},
    createdAt: now(),
  }
  try {
    database.prepare(`
      INSERT INTO global_lore_mounts (
        id, lore_resource_id, reference_json, source_kind, source_id, order_index, origin_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mount.id,
      input.loreResourceId,
      mount.reference ? stringifyJson(mount.reference, 'Lore mount reference') : null,
      mount.source.kind,
      mount.source.id ?? 'global',
      mount.orderIndex,
      stringifyJson(mount.origin, 'mount origin'),
      mount.createdAt,
    )
  } catch (error) {
    if (isMountUniqueConstraint(error)) {
      throw new PromptResourceStoreError('prompt_resource.mount_conflict', `Lore mount already exists: ${mount.loreResourceId}`)
    }
    throw error
  }
  tx.recordOperations([{
    ...operation('create', mount.id, 'prompt-resource.mount'),
    ...(mount.source.kind === 'preset' ? { scope: resourceScope(database, mount.source.id) } : {}),
  }])
  return mount
}

export function applyReplaceLoreMounts(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<ReplaceLoreMountsInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): LoreMount[] {
  validateMountSource(database, input.source)
  assertMountBaseline(input.expectedMountIds, listMounts(database, { source: input.source }))
  const seen = new Set<string>()
  for (const mount of input.mounts) {
    const identity = mount.loreResourceId ?? JSON.stringify(mount.reference)
    if (seen.has(identity)) throw new PromptResourceStoreError('prompt_resource.mount_duplicate', `Lore mount is duplicated: ${identity}`)
    seen.add(identity)
    validateMountReference(mount.reference)
    if (mount.loreResourceId !== null) {
      validateId(mount.loreResourceId, 'loreResourceId')
      requireLore(database, mount.loreResourceId)
    } else if (!mount.reference) {
      throw new PromptResourceStoreError('prompt_resource.mount_reference_invalid', 'Unresolved Lore mount requires a reference')
    }
    validateOrderIndex(mount.orderIndex)
    if (mount.origin !== undefined) validateJsonObject(mount.origin, 'mount origin')
  }
  const sourceId = input.source.kind === 'manual' ? 'global' : input.source.id
  recordDeletedMountOperations(database, tx, 'source_kind = ? AND source_id = ?', input.source.kind, sourceId)
  database.prepare('DELETE FROM global_lore_mounts WHERE source_kind = ? AND source_id = ?').run(input.source.kind, sourceId)
  const mounts = input.mounts.map(mount => applyAddLoreMount(database, tx, {
    ...mount,
    source: input.source,
  }, nextId, now))
  return mounts
}

export function applyAddPresetToolMount(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<AddPresetToolMountInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): PresetToolMount {
  requirePreset(database, input.presetResourceId)
  validateId(input.toolId, 'toolId')
  validateOrderIndex(input.orderIndex)
  validatePresetToolMountFields(input)
  const mount: PresetToolMount = {
    id: nextId('preset-tool-mount'),
    presetResourceId: input.presetResourceId,
    toolId: input.toolId,
    orderIndex: input.orderIndex,
    defaultEnabled: input.defaultEnabled,
    ...(input.activation ? { activation: structuredClone(input.activation) } : {}),
    ...(input.provider ? { provider: { ...input.provider } } : {}),
    ...(input.content ? { content: { ...input.content } } : {}),
    origin: input.origin ?? {},
    createdAt: now(),
  }
  try {
    database.prepare(`
      INSERT INTO preset_tool_mounts (
        id, preset_resource_id, tool_id, order_index, default_enabled,
        activation_json, provider_order, target_anchor_id, local_depth,
        origin_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mount.id,
      mount.presetResourceId,
      mount.toolId,
      mount.orderIndex,
      Number(mount.defaultEnabled),
      mount.activation ? stringifyJson(mount.activation, 'tool mount activation') : null,
      mount.provider?.order ?? null,
      mount.content?.targetAnchorId ?? null,
      mount.content?.localDepth ?? null,
      stringifyJson(mount.origin, 'tool mount origin'),
      mount.createdAt,
    )
  } catch (error) {
    if (isPresetToolMountUniqueConstraint(error)) {
      throw new PromptResourceStoreError('prompt_resource.tool_mount_conflict', `Tool mount already exists for ${mount.toolId}`)
    }
    throw error
  }
  tx.recordOperations([{
    ...operation('create', mount.id, 'prompt-resource.tool-mount'), scope: resourceScope(database, mount.presetResourceId),
  }])
  return mount
}

export function applyReplacePresetToolMounts(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<ReplacePresetToolMountsInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): PresetToolMount[] {
  requirePreset(database, input.presetResourceId)
  assertMountBaseline(input.expectedMountIds, listPresetToolMounts(database, { presetResourceId: input.presetResourceId }))
  const seen = new Set<string>()
  for (const mount of input.mounts) {
    if (seen.has(mount.toolId)) throw new PromptResourceStoreError('prompt_resource.tool_mount_duplicate', `Tool mount is duplicated: ${mount.toolId}`)
    seen.add(mount.toolId)
    validateId(mount.toolId, 'toolId')
    validateOrderIndex(mount.orderIndex)
    validatePresetToolMountFields(mount)
  }
  recordDeletedPresetToolMountOperations(database, tx, input.presetResourceId)
  database.prepare('DELETE FROM preset_tool_mounts WHERE preset_resource_id = ?').run(input.presetResourceId)
  return input.mounts.map(mount => applyAddPresetToolMount(database, tx, {
    ...mount,
    presetResourceId: input.presetResourceId,
  }, nextId, now))
}

export function listMounts(database: DatabaseSync, input: ListLoreMountsInput = {}): LoreMount[] {
  if (input.source) {
    if (input.source.kind === 'preset') validateId(input.source.id, 'presetId')
    else if (input.source.id !== undefined && input.source.id !== 'global') {
      throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', 'Manual Lore mount source id must be global')
    }
  }
  const clauses: string[] = []
  const values: string[] = []
  if (input.source) { clauses.push('source_kind = ?', 'source_id = ?'); values.push(input.source.kind, input.source.id ?? 'global') }
  if (input.loreResourceId) { validateId(input.loreResourceId, 'loreResourceId'); clauses.push('lore_resource_id = ?'); values.push(input.loreResourceId) }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return (database.prepare(`SELECT id, lore_resource_id, reference_json, source_kind, source_id, order_index, origin_json, created_at FROM global_lore_mounts ${where} ORDER BY order_index ASC, id ASC`).all(...values) as Array<Record<string, unknown>>).map(mountFromRow)
}

export function listPresetToolMounts(database: DatabaseSync, input: ListPresetToolMountsInput = {}): PresetToolMount[] {
  const clauses: string[] = []
  const values: string[] = []
  if (input.presetResourceId) { validateId(input.presetResourceId, 'presetResourceId'); clauses.push('preset_resource_id = ?'); values.push(input.presetResourceId) }
  if (input.toolId) { validateId(input.toolId, 'toolId'); clauses.push('tool_id = ?'); values.push(input.toolId) }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return (database.prepare(`SELECT * FROM preset_tool_mounts ${where} ORDER BY order_index ASC, id ASC`).all(...values) as Array<Record<string, unknown>>).map(presetToolMountFromRow)
}

function assertMountBaseline(expectedIds: string[], mounts: Array<{ id: string }>): void {
  const expected = new Set(expectedIds)
  if (expected.size !== expectedIds.length || expected.size !== mounts.length || mounts.some(mount => !expected.has(mount.id))) {
    throw new PromptResourceStoreError('prompt_resource.mount_conflict', 'Mount collection changed; reload before saving')
  }
}
