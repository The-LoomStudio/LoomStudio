import type {
  ApplicationRuntime,
  OpeningChatInput,
  RuntimeRequestContext,
  SettingLayerInput,
} from '@loom-studio/application-runtime'
import { isCardBundleArtifact, isPromptActivation } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleCardsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.createCard':
      return await runtime.createCard({
        name: readString(params, 'name'),
        userName: readOptionalString(params, 'userName'),
        description: readOptionalString(params, 'description'),
        preset: readOptionalPreset(params, 'preset'),
        opening: readOptionalOpening(params, 'opening'),
        setting: readOptionalObject(params, 'setting'),
        settingLayer: readOptionalSettingLayer(params, 'settingLayer'),
        media: readOptionalCardMedia(params, 'media'),
        macros: readOptionalStringRecord(params, 'macros'),
      }, context) as unknown as JsonValue

    case 'application.getCard':
      return await runtime.getCard({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    case 'application.listCards':
      return await runtime.listCards({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateCard':
      return await runtime.updateCard({
        cardId: readString(params, 'cardId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
        name: readOptionalString(params, 'name'),
        userName: readOptionalString(params, 'userName'),
        description: readOptionalString(params, 'description'),
        preset: readOptionalPreset(params, 'preset'),
        opening: readOptionalOpening(params, 'opening'),
        settingLayer: readOptionalSettingLayer(params, 'settingLayer'),
        media: readOptionalCardMedia(params, 'media'),
        stateTemplates: readOptionalStateTemplates(params, 'stateTemplates'),
        stateDefinitionIds: readOptionalStringArray(params, 'stateDefinitionIds'),
        stateEntityTypes: readOptionalStateEntityTypes(params, 'stateEntityTypes'),
        timelineStateEntities: readOptionalStateEntities(params, 'timelineStateEntities'),
        timelineComponentMounts: readOptionalComponentMounts(params, 'timelineComponentMounts'),
        stateContributionIds: readOptionalStringArray(params, 'stateContributionIds'),
        timelineStateBindings: readOptionalTimelineStateBindings(params, 'timelineStateBindings'),
        macros: readOptionalStringRecord(params, 'macros'),
      }, context) as unknown as JsonValue

    case 'application.deleteCard':
      return await runtime.deleteCard({
        cardId: readString(params, 'cardId'),
        includePlayData: readOptionalBoolean(params, 'includePlayData'),
        includePromptResources: readOptionalBoolean(params, 'includePromptResources'),
      }, context) as unknown as JsonValue

    case 'application.previewCardDeletion':
      return await runtime.previewCardDeletion({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    case 'application.importCardBundle':
      return await runtime.importCardBundle(readCardBundleImportInput(params), context) as unknown as JsonValue

    case 'application.exportCardBundle':
      return await runtime.exportCardBundle({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    case 'application.updateCardPromptResources':
      return await runtime.updateCardPromptResources({
        cardId: readString(params, 'cardId'),
        promptResourceIds: readRequiredStringArray(params, 'promptResourceIds'),
        ...(isRecord(params) && params.externalPromptResourceIds !== undefined ? {
          externalPromptResourceIds: readRequiredStringArray(params, 'externalPromptResourceIds'),
        } : {}),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readOptionalPreset(params: JsonValue | undefined, key: string): { system?: string; macros?: Record<string, string> } | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected preset param: ${key}`)

  return {
    system: typeof value.system === 'string' ? value.system : undefined,
    macros: value.macros !== undefined
      ? readStringRecordValue(value.macros, `${key}.macros`)
      : undefined,
  }
}

function readOptionalOpening(params: JsonValue | undefined, key: string): OpeningChatInput | string | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (typeof value === 'string') return value
  if (!isRecord(value)) throw new Error(`Expected opening param: ${key}`)
  const entries = Array.isArray(value.entries) ? value.entries : []

  return {
    entries: entries.map(entry => {
      if (!isRecord(entry) || typeof entry.content !== 'string') {
        throw new Error(`Expected opening entry content: ${key}`)
      }
      if (entry.role !== undefined && entry.role !== 'user' && entry.role !== 'assistant') {
        throw new Error(`Expected opening entry role: ${key}`)
      }

      return {
        role: entry.role,
        content: entry.content,
      }
    }),
  }
}

function readOptionalSettingLayer(params: JsonValue | undefined, key: string): SettingLayerInput | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected settingLayer param: ${key}`)
  const entries = Array.isArray(value.entries) ? value.entries : []

  return {
    entries: entries.map(entry => {
      if (!isRecord(entry) || typeof entry.content !== 'string') {
        throw new Error(`Expected setting entry content: ${key}`)
      }

      return {
        id: typeof entry.id === 'string' ? entry.id : undefined,
        path: typeof entry.path === 'string' ? entry.path : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
        content: entry.content,
        enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
        activation: entry.activation !== undefined && isPromptActivation(entry.activation) ? entry.activation : undefined,
        tags: Array.isArray(entry.tags) && entry.tags.every(tag => typeof tag === 'string') ? entry.tags : undefined,
      }
    }),
  }
}

function readOptionalCardMedia(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected card media param: ${key}`)
  return {
    avatarAssetId: typeof value.avatarAssetId === 'string' ? value.avatarAssetId : undefined,
    coverAssetId: typeof value.coverAssetId === 'string' ? value.coverAssetId : undefined,
  }
}


function readOptionalStringArray(params: JsonValue | undefined, key: string): string[] | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new Error(`Expected optional string array param: ${key}`)
  }
  return value
}

function readOptionalStringRecord(params: JsonValue | undefined, key: string): Record<string, string> | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || !Object.values(value).every(item => typeof item === 'string')) {
    throw new Error(`Expected optional string record param: ${key}`)
  }
  return value as Record<string, string>
}

function readStringRecordValue(value: JsonValue | undefined, key: string): Record<string, string> {
  if (!isRecord(value) || !Object.values(value).every(item => typeof item === 'string')) {
    throw new Error(`Expected string record param: ${key}`)
  }
  return value as Record<string, string>
}

function readRequiredStringArray(params: JsonValue | undefined, key: string): string[] {
  const value = readOptionalStringArray(params, key)
  if (!value) throw new Error(`Expected string array param: ${key}`)
  return value
}

function readOptionalTimelineStateBindings(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value)) throw new Error(`Expected array param: ${key}`)
  return value.map((binding, index) => {
    if (!isRecord(binding) || typeof binding.path !== 'string') {
      throw new Error(`Expected Timeline State Binding: ${key}[${index}]`)
    }
    const templateId = typeof binding.templateId === 'string'
      ? binding.templateId
      : typeof binding.stateDefinitionId === 'string'
        ? binding.stateDefinitionId
        : undefined
    if (!templateId) {
      throw new Error(`Expected Timeline State Binding templateId: ${key}[${index}]`)
    }
    const templateVersion = typeof binding.templateVersion === 'number' ? binding.templateVersion : 1
    if (binding.initial !== undefined && !isRecord(binding.initial)) throw new Error(`Expected object: ${key}[${index}].initial`)
    return {
      path: binding.path,
      templateId,
      templateVersion,
      ...(isRecord(binding.initial) ? { initial: binding.initial } : {}),
    }
  })
}

function readOptionalStateTemplates(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value)) throw new Error(`Expected array param: ${key}`)
  return value.map((tpl, index) => {
    if (!isRecord(tpl) || typeof tpl.id !== 'string') {
      throw new Error(`Expected State Template: ${key}[${index}]`)
    }
    const label = typeof tpl.label === 'string' ? tpl.label : typeof tpl.name === 'string' ? tpl.name : undefined
    const schema = isRecord(tpl.schema) ? tpl.schema : { type: 'object' }
    const initial = isRecord(tpl.initial) ? tpl.initial : {}
    const templateVersion = typeof tpl.templateVersion === 'number' ? tpl.templateVersion : 1
    const componentKey = typeof tpl.componentKey === 'string' ? tpl.componentKey : undefined
    const targetEntityTypeIds = Array.isArray(tpl.targetEntityTypeIds)
      && tpl.targetEntityTypeIds.every(typeId => typeof typeId === 'string')
      ? tpl.targetEntityTypeIds as string[]
      : undefined
    return {
      id: tpl.id,
      templateVersion,
      schema,
      initial,
      ...(componentKey !== undefined ? { componentKey } : {}),
      ...(targetEntityTypeIds !== undefined ? { targetEntityTypeIds } : {}),
      ...(label !== undefined ? { label } : {}),
    }
  })
}

function readOptionalStateEntityTypes(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value)) throw new Error(`Expected array param: ${key}`)
  return value.map((entityType, index) => {
    if (!isRecord(entityType) || typeof entityType.id !== 'string' || typeof entityType.collectionPath !== 'string') {
      throw new Error(`Expected State Entity Type: ${key}[${index}]`)
    }
    return {
      id: entityType.id,
      collectionPath: entityType.collectionPath,
      ...(typeof entityType.label === 'string' ? { label: entityType.label } : {}),
    }
  })
}

function readOptionalStateEntities(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value)) throw new Error(`Expected array param: ${key}`)
  return value.map((entity, index) => {
    if (!isRecord(entity) || typeof entity.typeId !== 'string' || typeof entity.entityId !== 'string') {
      throw new Error(`Expected State Entity: ${key}[${index}]`)
    }
    return { typeId: entity.typeId, entityId: entity.entityId }
  })
}

function readOptionalComponentMounts(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!Array.isArray(value)) throw new Error(`Expected array param: ${key}`)
  return value.map((mount, index) => {
    if (!isRecord(mount)
      || typeof mount.templateId !== 'string'
      || typeof mount.templateVersion !== 'number'
      || typeof mount.componentKey !== 'string'
      || !isRecord(mount.target)) {
      throw new Error(`Expected Timeline Component Mount: ${key}[${index}]`)
    }
    const target = mount.target.kind === 'entity' && isRecord(mount.target.entity)
      && typeof mount.target.entity.typeId === 'string' && typeof mount.target.entity.entityId === 'string'
      ? { kind: 'entity' as const, entity: { typeId: mount.target.entity.typeId, entityId: mount.target.entity.entityId } }
      : mount.target.kind === 'entity-type' && typeof mount.target.typeId === 'string'
        ? { kind: 'entity-type' as const, typeId: mount.target.typeId }
        : undefined
    if (!target) throw new Error(`Expected Timeline Component Mount target: ${key}[${index}]`)
    if (mount.initial !== undefined && !isRecord(mount.initial)) throw new Error(`Expected object: ${key}[${index}].initial`)
    return {
      templateId: mount.templateId,
      templateVersion: mount.templateVersion,
      componentKey: mount.componentKey,
      target,
      ...(isRecord(mount.initial) ? { initial: mount.initial } : {}),
    }
  })
}

function readCardBundleArtifact(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) throw new Error(`Expected card bundle artifact param: ${key}`)
  const value = params[key]
  if (!isCardBundleArtifact(value)) throw new Error(`Expected card bundle artifact param: ${key}`)
  return value
}

function readCardBundleImportInput(params: JsonValue | undefined) {
  if (!isRecord(params)) throw new Error('Expected card bundle import params')
  if (params.source !== undefined) {
    if (!isRecord(params.source) || typeof params.source.text !== 'string') {
      throw new Error('Expected card bundle source text')
    }
    return {
      source: {
        text: params.source.text,
        originalFileName: typeof params.source.originalFileName === 'string'
          ? params.source.originalFileName
          : undefined,
      },
    }
  }
  return { artifact: readCardBundleArtifact(params, 'artifact') }
}
