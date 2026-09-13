import YAML from 'yaml'
import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Card, StateSnapshot, StateTarget } from '../../../entities/index.js'
import type { FileTreeNode } from '../../../shared/ui/file-tree/file-tree-model.js'

export type StatePropertyType = 'number' | 'string' | 'boolean' | 'null' | 'other'

function getPropertyType(value: unknown): StatePropertyType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'boolean') return 'boolean'
  if (value === null) return 'null'
  return 'other'
}

export function objectToYaml(value: unknown): string {
  try {
    return YAML.stringify(value ?? {}, { indent: 2 })
  } catch {
    return ''
  }
}

export function yamlToObject(text: string, label = 'State YAML'): Record<string, ClientJsonValue> {
  let parsed: unknown
  try {
    parsed = YAML.parse(text)
  } catch (cause) {
    throw new Error(`${label} 语法错误: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是一个对象/映射结构`)
  }
  return parsed as Record<string, ClientJsonValue>
}

export function createSnapshotReplaceFromYaml(snapshot: StateSnapshot, yamlText: string) {
  return {
    target: snapshot.target,
    expectedRevisionId: snapshot.revisionId,
    operations: [{ op: 'set' as const, path: '', value: yamlToObject(yamlText, 'State Snapshot') }],
  }
}

export function createSnapshotReplaceInput(snapshot: StateSnapshot, text: string) {
  return {
    target: snapshot.target,
    expectedRevisionId: snapshot.revisionId,
    operations: [{ op: 'set' as const, path: '', value: parseJsonObject(text, 'State Snapshot') }],
  }
}

export function parseCardStateConfig(text: string): {
  stateTemplates?: NonNullable<Card['stateTemplates']>
  stateDefinitionIds: string[]
  stateEntityTypes: NonNullable<Card['stateEntityTypes']>
  timelineStateEntities: NonNullable<Card['timelineStateEntities']>
  timelineComponentMounts: NonNullable<Card['timelineComponentMounts']>
  stateContributionIds: NonNullable<Card['stateContributionIds']>
  timelineStateBindings: NonNullable<Card['timelineStateBindings']>
} {
  const value = yamlToObject(text, 'Card State config')
  if (value.stateDefinitionIds !== undefined && (!Array.isArray(value.stateDefinitionIds) || !value.stateDefinitionIds.every(item => typeof item === 'string'))) {
    throw new Error('Card State config stateDefinitionIds must be a string array')
  }
  if (value.stateTemplates !== undefined && !Array.isArray(value.stateTemplates)) {
    throw new Error('Card State config stateTemplates must be an array')
  }
  const stateTemplates = Array.isArray(value.stateTemplates)
    ? value.stateTemplates.map((tpl, index) => {
        if (!isRecord(tpl) || typeof tpl.id !== 'string') {
          throw new Error(`stateTemplates[${index}] must have a valid string id`)
        }
        if (typeof tpl.templateVersion !== 'number' || !Number.isInteger(tpl.templateVersion) || tpl.templateVersion < 1) {
          throw new Error(`stateTemplates[${index}] must have a valid templateVersion`)
        }
        if (typeof tpl.schema !== 'object' || tpl.schema === null || Array.isArray(tpl.schema)) {
          throw new Error(`stateTemplates[${index}] must have an object schema`)
        }
        if (typeof tpl.initial !== 'object' || tpl.initial === null || Array.isArray(tpl.initial)) {
          throw new Error(`stateTemplates[${index}] must have an object initial value`)
        }
        if (tpl.label !== undefined && typeof tpl.label !== 'string') {
          throw new Error(`stateTemplates[${index}] label must be a string`)
        }
        const label = tpl.label as string | undefined
        const componentKey = typeof tpl.componentKey === 'string' ? tpl.componentKey : undefined
        const targetEntityTypeIds = Array.isArray(tpl.targetEntityTypeIds)
          && tpl.targetEntityTypeIds.every((typeId: unknown) => typeof typeId === 'string')
          ? tpl.targetEntityTypeIds as string[]
          : undefined
        return {
          id: tpl.id,
          templateVersion: tpl.templateVersion,
          schema: tpl.schema,
          initial: tpl.initial,
          ...(componentKey !== undefined ? { componentKey } : {}),
          ...(targetEntityTypeIds !== undefined ? { targetEntityTypeIds } : {}),
          ...(label !== undefined ? { label } : {}),
        }
      })
    : undefined
  const stateDefinitionIds = (value.stateDefinitionIds as string[] | undefined)
    ?? (stateTemplates ? stateTemplates.map(t => t.id) : [])
  const stateEntityTypes = readArray(value.stateEntityTypes, 'stateEntityTypes').map((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.collectionPath !== 'string') {
      throw new Error(`stateEntityTypes[${index}] must have id and collectionPath`)
    }
    return {
      id: item.id,
      collectionPath: item.collectionPath,
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
    }
  })
  const timelineStateEntities = readArray(value.timelineStateEntities, 'timelineStateEntities').map((item, index) => {
    if (!isRecord(item) || typeof item.typeId !== 'string' || typeof item.entityId !== 'string') {
      throw new Error(`timelineStateEntities[${index}] must have typeId and entityId`)
    }
    return { typeId: item.typeId, entityId: item.entityId }
  })
  const timelineComponentMounts = readArray(value.timelineComponentMounts, 'timelineComponentMounts').map((item, index) => {
    if (!isRecord(item)
      || typeof item.templateId !== 'string'
      || typeof item.templateVersion !== 'number'
      || typeof item.componentKey !== 'string'
      || !isRecord(item.target)) {
      throw new Error(`timelineComponentMounts[${index}] is invalid`)
    }
    const target = item.target.kind === 'entity' && isRecord(item.target.entity)
      && typeof item.target.entity.typeId === 'string' && typeof item.target.entity.entityId === 'string'
      ? { kind: 'entity' as const, entity: { typeId: item.target.entity.typeId, entityId: item.target.entity.entityId } }
      : item.target.kind === 'entity-type' && typeof item.target.typeId === 'string'
        ? { kind: 'entity-type' as const, typeId: item.target.typeId }
        : undefined
    if (!target) throw new Error(`timelineComponentMounts[${index}].target is invalid`)
    if (item.initial !== undefined && !isRecord(item.initial)) {
      throw new Error(`timelineComponentMounts[${index}].initial must be an object`)
    }
    return {
      templateId: item.templateId,
      templateVersion: item.templateVersion,
      componentKey: item.componentKey,
      target,
      ...(isRecord(item.initial) ? { initial: item.initial } : {}),
    }
  })
  const stateContributionIds = readArray(value.stateContributionIds, 'stateContributionIds').map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) throw new Error(`stateContributionIds[${index}] must be a string`)
    return item
  })
  if (!Array.isArray(value.timelineStateBindings)) {
    throw new Error('Card State config timelineStateBindings must be an array')
  }
  const normalizedBindings = value.timelineStateBindings.map((item, index) => {
    if (!isRecord(item) || typeof item.path !== 'string' || item.path.length === 0) {
      throw new Error(`timelineStateBindings[${index}] must have a valid path`)
    }
    if (typeof item.templateId !== 'string' || item.templateId.length === 0) {
      throw new Error(`timelineStateBindings[${index}] must specify templateId`)
    }
    if (typeof item.templateVersion !== 'number' || !Number.isInteger(item.templateVersion) || item.templateVersion < 1) {
      throw new Error(`timelineStateBindings[${index}] must have a valid templateVersion`)
    }
    if (item.initial !== undefined && (typeof item.initial !== 'object' || item.initial === null || Array.isArray(item.initial))) {
      throw new Error(`timelineStateBindings[${index}] initial value must be an object`)
    }
    return {
      path: item.path,
      templateId: item.templateId,
      templateVersion: item.templateVersion,
      ...(item.initial !== undefined ? { initial: item.initial } : {}),
    }
  })
  return {
    ...(stateTemplates ? { stateTemplates } : {}),
    stateDefinitionIds,
    stateEntityTypes,
    timelineStateEntities,
    timelineComponentMounts,
    stateContributionIds,
    timelineStateBindings: normalizedBindings,
  }
}

function readArray(value: ClientJsonValue | undefined, label: string): ClientJsonValue[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value
}

function isRecord(value: unknown): value is Record<string, ClientJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonObject(text: string, label: string): Record<string, ClientJsonValue> {
  const value = JSON.parse(text) as ClientJsonValue
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`)
  }
  return value
}

export function createBatchSetStatePropertiesInput(
  target: StateTarget,
  expectedRevisionId: string,
  properties: Record<string, ClientJsonValue>,
) {
  return {
    target,
    expectedRevisionId,
    operations: Object.entries(properties).map(([path, value]) => ({
      op: 'set' as const,
      path,
      value,
    })),
  }
}

export type StateTreeNodeCapabilities = {
  path: string
  macroPath: string
  macroToken: string
  type: StatePropertyType
  value: unknown
  isLongText?: boolean
}

export function stateSnapshotToTreeNodes(
  snapshotValue: unknown,
  prefix = '',
  macroPrefix = '',
): FileTreeNode[] {
  if (typeof snapshotValue !== 'object' || snapshotValue === null || Array.isArray(snapshotValue)) {
    return []
  }

  const record = snapshotValue as Record<string, unknown>
  const nodes: FileTreeNode[] = []

  for (const [key, val] of Object.entries(record)) {
    const nextPath = `${prefix}/${escapePointerSegment(key)}`
    const nextMacroPath = macroPrefix ? `${macroPrefix}.${key}` : key
    const nextMacroToken = `{{${nextMacroPath}}}`

    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const children = stateSnapshotToTreeNodes(val, nextPath, nextMacroPath)
      nodes.push({
        id: nextPath,
        label: key,
        kind: 'object',
        container: true,
        meta: `${children.length} 项`,
        capabilities: {
          path: nextPath,
          macroPath: nextMacroPath,
          macroToken: nextMacroToken,
          type: 'other',
          value: val,
        } satisfies StateTreeNodeCapabilities,
        children,
      })
    } else {
      const type = getPropertyType(val)
      const isLongText = typeof val === 'string' && (val.includes('\n') || val.length > 30)
      nodes.push({
        id: nextPath,
        label: key,
        kind: type,
        meta: isLongText ? `${(val as string).length} 字符` : undefined,
        capabilities: {
          path: nextPath,
          macroPath: nextMacroPath,
          macroToken: nextMacroToken,
          type,
          value: val,
          isLongText,
        } satisfies StateTreeNodeCapabilities,
      })
    }
  }

  return nodes
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}
