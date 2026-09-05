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
        name: readOptionalString(params, 'name'),
        userName: readOptionalString(params, 'userName'),
        description: readOptionalString(params, 'description'),
        preset: readOptionalPreset(params, 'preset'),
        opening: readOptionalOpening(params, 'opening'),
        settingLayer: readOptionalSettingLayer(params, 'settingLayer'),
        media: readOptionalCardMedia(params, 'media'),
        stateDefinitionIds: readOptionalStringArray(params, 'stateDefinitionIds'),
        timelineStateBindings: readOptionalTimelineStateBindings(params, 'timelineStateBindings'),
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
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readOptionalPreset(params: JsonValue | undefined, key: string): { system?: string } | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected preset param: ${key}`)

  return {
    system: typeof value.system === 'string' ? value.system : undefined,
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
    if (!isRecord(binding) || typeof binding.path !== 'string' || typeof binding.templateId !== 'string' || typeof binding.templateVersion !== 'number') {
      throw new Error(`Expected Timeline State Binding: ${key}[${index}]`)
    }
    if (binding.initial !== undefined && !isRecord(binding.initial)) throw new Error(`Expected object: ${key}[${index}].initial`)
    return {
      path: binding.path,
      templateId: binding.templateId,
      templateVersion: binding.templateVersion,
      ...(isRecord(binding.initial) ? { initial: binding.initial } : {}),
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
