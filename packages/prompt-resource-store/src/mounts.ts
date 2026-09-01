import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { DatabaseSync } from 'node:sqlite'
import {
  PromptResourceStoreError,
  type AddPresetToolMountInput,
  type AddSettingMountInput,
  type ListPresetToolMountsInput,
  type ListSettingMountsInput,
  type PresetToolMount,
  type PromptResourceWriteContext,
  type ReplacePresetToolMountsInput,
  type ReplaceSettingMountsInput,
  type SettingMount,
  type SettingMountSource,
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
  requireResourceRow,
  recordDeletedMountOperations,
  recordDeletedPresetToolMountOperations,
} from './mutations.js'

export function mountFromRow(row: Record<string, unknown>): SettingMount {
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

export function presetToolMountFromRow(row: Record<string, unknown>): PresetToolMount {
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

export function validateMountSource(database: DatabaseSync, source: SettingMountSource, requireTarget = true): void {
  if (source.kind === 'manual') {
    if (source.id !== undefined && source.id !== 'global') throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', 'Manual Setting mount source id must be global')
    return
  }
  validateId(source.id, 'presetId')
  const preset = requireResourceRow(database, source.id)
  if (preset.resource_kind !== 'preset' || preset.tombstoned) throw new PromptResourceStoreError('prompt_resource.mount_source_invalid', `Mount source is not an active Preset: ${source.id}`)
  if (!requireTarget) return
}

export function requireSetting(database: DatabaseSync, id: string): void {
  const row = requireResourceRow(database, id)
  if (row.resource_kind !== 'setting' || row.tombstoned) throw new PromptResourceStoreError('prompt_resource.setting_invalid', `Mount target is not an active Setting: ${id}`)
}

export function requirePreset(database: DatabaseSync, id: string): void {
  const row = requireResourceRow(database, id)
  if (row.resource_kind !== 'preset' || row.tombstoned) throw new PromptResourceStoreError('prompt_resource.preset_invalid', `Tool mount source is not an active Preset: ${id}`)
}

export function validatePresetToolMountFields(input: Pick<AddPresetToolMountInput, 'defaultEnabled' | 'activation' | 'provider' | 'content' | 'origin'>): void {
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

export function isMountUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: global_setting_mounts.')
}

export function isPresetToolMountUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed: preset_tool_mounts.')
}

export function applyAddSettingMount(
  database: DatabaseSync,
  tx: SqliteDataTransaction,
  input: Omit<AddSettingMountInput, keyof PromptResourceWriteContext>,
  nextId: (prefix: string) => string,
  now: () => string,
): SettingMount {
  validateMountSource(database, input.source)
  validateId(input.settingResourceId, 'settingResourceId')
  requireSetting(database, input.settingResourceId)
  validateOrderIndex(input.orderIndex)
  if (input.origin !== undefined) validateJsonObject(input.origin, 'mount origin')
  const mount: SettingMount = {
    id: nextId('setting-mount'),
    settingResourceId: input.settingResourceId,
    source: input.source.kind === 'manual' ? { kind: 'manual', id: 'global' } : { kind: 'preset', id: input.source.id },
    orderIndex: input.orderIndex,
    origin: input.origin ?? {},
    createdAt: now(),
  }
  try {
    database.prepare(`
      INSERT INTO global_setting_mounts (
        id, setting_resource_id, source_kind, source_id, order_index, origin_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      mount.id,
      mount.settingResourceId,
      mount.source.kind,
      mount.source.id ?? 'global',
      mount.orderIndex,
      stringifyJson(mount.origin, 'mount origin'),
      mount.createdAt,
    )
  } catch (error) {
    if (isMountUniqueConstraint(error)) {
      throw new PromptResourceStoreError('prompt_resource.mount_conflict', `Setting mount already exists: ${mount.settingResourceId}`)
    }
    throw error
  }
  tx.recordOperations([operation('create', mount.id, 'prompt-resource.mount')])
  return mount
}

export function applyReplaceSettingMounts(
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
    validateId(mount.settingResourceId, 'settingResourceId')
    validateOrderIndex(mount.orderIndex)
    if (mount.origin !== undefined) validateJsonObject(mount.origin, 'mount origin')
    requireSetting(database, mount.settingResourceId)
  }
  const sourceId = input.source.kind === 'manual' ? 'global' : input.source.id
  recordDeletedMountOperations(database, tx, 'source_kind = ? AND source_id = ?', input.source.kind, sourceId)
  database.prepare('DELETE FROM global_setting_mounts WHERE source_kind = ? AND source_id = ?').run(input.source.kind, sourceId)
  const mounts = input.mounts.map(mount => applyAddSettingMount(database, tx, {
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
  tx.recordOperations([operation('create', mount.id, 'prompt-resource.tool-mount')])
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

export function listMounts(database: DatabaseSync, input: ListSettingMountsInput = {}): SettingMount[] {
  if (input.source) validateMountSource(database, input.source, false)
  const clauses: string[] = []
  const values: string[] = []
  if (input.source) { clauses.push('source_kind = ?', 'source_id = ?'); values.push(input.source.kind, input.source.id ?? 'global') }
  if (input.settingResourceId) { validateId(input.settingResourceId, 'settingResourceId'); clauses.push('setting_resource_id = ?'); values.push(input.settingResourceId) }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return (database.prepare(`SELECT id, setting_resource_id, source_kind, source_id, order_index, origin_json, created_at FROM global_setting_mounts ${where} ORDER BY order_index ASC, id ASC`).all(...values) as Array<Record<string, unknown>>).map(mountFromRow)
}

export function listPresetToolMounts(database: DatabaseSync, input: ListPresetToolMountsInput = {}): PresetToolMount[] {
  const clauses: string[] = []
  const values: string[] = []
  if (input.presetResourceId) { validateId(input.presetResourceId, 'presetResourceId'); clauses.push('preset_resource_id = ?'); values.push(input.presetResourceId) }
  if (input.toolId) { validateId(input.toolId, 'toolId'); clauses.push('tool_id = ?'); values.push(input.toolId) }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return (database.prepare(`SELECT * FROM preset_tool_mounts ${where} ORDER BY order_index ASC, id ASC`).all(...values) as Array<Record<string, unknown>>).map(presetToolMountFromRow)
}
