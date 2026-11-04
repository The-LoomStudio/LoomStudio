import type {
  ApplicationRuntime,
  LoreInput,
  OpeningChatInput
} from '@loom-studio/application-runtime'
import { assertCardBundleArtifact, isPromptActivation, parseCardExtensionAdoptions } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readNumber,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readOptionalStringArray,
  readOptionalStringRecord,
  readString,
  readStringArray,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const cardsProcedures = {
  'createCard': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createCard']>[0] => {
    return {
      name: readString(params, 'name'),
      userName: readOptionalString(params, 'userName'),
      description: readOptionalString(params, 'description'),
      preset: readOptionalPreset(params, 'preset'),
      opening: readOptionalOpening(params, 'opening'),
      lore: readOptionalLore(params, 'lore'),
      media: readOptionalCardMedia(params, 'media'),
      macros: readOptionalStringRecord(params, 'macros'),
      macroOptions: readOptionalObject(params, 'macroOptions') as import('@loom-studio/shared').MacroOptions | undefined,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createCard(input, ctx.request)),
  'getCard': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getCard']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getCard(input)),
  'attachCardExtensionPackage': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['attachCardExtensionPackage']>[0] => {
    const expectedVersion = readOptionalNumber(params, 'expectedVersion')
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion! < 1) throw new Error('expectedVersion must be a positive integer')
    const archive = readOptionalObject(params, 'archive')
    if (!archive) throw new Error('archive is required')
    return {
      cardId: readString(params, 'cardId'), expectedVersion: expectedVersion!,
      archive: archive as unknown as import('@loom-studio/application-runtime').AttachCardExtensionPackageInput['archive'],
    }
  })).mutation(({ ctx, input }) => ctx.runtime.attachCardExtensionPackage(input, ctx.request)),
  'detachCardExtensionPackage': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['detachCardExtensionPackage']>[0] => {
    const expectedVersion = readOptionalNumber(params, 'expectedVersion')
    if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('expectedVersion must be a positive integer')
    return {
      cardId: readString(params, 'cardId'), expectedVersion, packageId: readString(params, 'packageId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.detachCardExtensionPackage(input, ctx.request)),
  'listCards': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listCards']>[0] => {
    return {
      cursor: readOptionalString(params, 'cursor'),
      limit: readOptionalNumber(params, 'limit'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listCards(input)),
  'forkCard': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['forkCard']>[0] => {
    return {
      cardId: readString(params, 'cardId'), expectedVersion: readNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.forkCard(input, ctx.request)),
  'updateCard': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateCard']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      name: readOptionalString(params, 'name'),
      userName: readOptionalString(params, 'userName'),
      description: readOptionalString(params, 'description'),
      preset: readOptionalPreset(params, 'preset'),
      opening: readOptionalOpening(params, 'opening'),
      lore: readOptionalLore(params, 'lore'),
      media: readOptionalCardMedia(params, 'media'),
      stateTemplates: readOptionalStateTemplates(params, 'stateTemplates'),
      stateDefinitionIds: readOptionalStringArray(params, 'stateDefinitionIds'),
      stateEntityTypes: readOptionalStateEntityTypes(params, 'stateEntityTypes'),
      timelineStateEntities: readOptionalStateEntities(params, 'timelineStateEntities'),
      timelineComponentMounts: readOptionalComponentMounts(params, 'timelineComponentMounts'),
      stateContributionIds: readOptionalStringArray(params, 'stateContributionIds'),
      ...(isRecord(params) && params.extensionAdoptions !== undefined
        ? { extensionAdoptions: parseCardExtensionAdoptions(params.extensionAdoptions) } : {}),
      timelineStateBindings: readOptionalTimelineStateBindings(params, 'timelineStateBindings'),
      macros: readOptionalStringRecord(params, 'macros'),
      macroOptions: readOptionalObject(params, 'macroOptions') as import('@loom-studio/shared').MacroOptions | undefined,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateCard(input, ctx.request)),
  'deleteCard': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteCard']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
      includePlayData: readOptionalBoolean(params, 'includePlayData'),
      includePromptResources: readOptionalBoolean(params, 'includePromptResources'),
    }
  })).mutation(async ({ ctx, input }) => {
    const previews = ctx.services?.emitEvent
      ? await Promise.all([input.cardId].map(cardId => ctx.runtime.previewCardDeletion({ cardId }))) : []
    const result = await ctx.runtime.deleteCard(input, ctx.request)
    for (const preview of previews) ctx.services?.emitEvent?.('entity.lifecycle.changed', {
      operation: 'tombstoned', root: { kind: 'card', id: preview.cardId },
      affected: {
        timelines: input.includePlayData ? preview.timelines.length : 0,
        extensionConfigs: preview.extensionData.cardScoped.configs + (input.includePlayData ? preview.extensionData.timelineScoped.configs : 0),
        extensionRecords: preview.extensionData.cardScoped.records + (input.includePlayData ? preview.extensionData.timelineScoped.records : 0)
      },
      changesetId: result.mutation.changesetId,
    }, { clientId: ctx.request.clientId!, correlationId: ctx.request.correlationId!, callId: ctx.request.callId!, parentCallId: ctx.request.parentCallId })
    return result
  }),
  'deleteCards': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deleteCards']>[0] => {
    return {
      cardIds: readStringArray(params, 'cardIds'),
      includePlayData: readOptionalBoolean(params, 'includePlayData'),
      includePromptResources: readOptionalBoolean(params, 'includePromptResources'),
    }
  })).mutation(async ({ ctx, input }) => {
    const previews = ctx.services?.emitEvent
      ? await Promise.all(input.cardIds.map(cardId => ctx.runtime.previewCardDeletion({ cardId }))) : []
    const result = await ctx.runtime.deleteCards(input, ctx.request)
    for (const preview of previews) ctx.services?.emitEvent?.('entity.lifecycle.changed', {
      operation: 'tombstoned', root: { kind: 'card', id: preview.cardId },
      affected: {
        timelines: input.includePlayData ? preview.timelines.length : 0,
        extensionConfigs: preview.extensionData.cardScoped.configs + (input.includePlayData ? preview.extensionData.timelineScoped.configs : 0),
        extensionRecords: preview.extensionData.cardScoped.records + (input.includePlayData ? preview.extensionData.timelineScoped.records : 0)
      },
      changesetId: result.mutation.changesetId,
    }, { clientId: ctx.request.clientId!, correlationId: ctx.request.correlationId!, callId: ctx.request.callId!, parentCallId: ctx.request.parentCallId })
    return result
  }),
  'previewCardDeletion': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['previewCardDeletion']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.previewCardDeletion(input)),
  'importCardBundle': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['importCardBundle']>[0] => {
    return readCardBundleImportInput(params)
  })).mutation(({ ctx, input }) => ctx.runtime.importCardBundle(input, ctx.request)),
  'exportCardBundle': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['exportCardBundle']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.exportCardBundle(input)),
  'updateCardPromptResources': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updateCardPromptResources']>[0] => {
    return {
      cardId: readString(params, 'cardId'),
      expectedVersion: readNumber(params, 'expectedVersion'),
      promptResourceIds: readStringArray(params, 'promptResourceIds'),
      ...(isRecord(params) && params.externalPromptResourceIds !== undefined ? {
        externalPromptResourceIds: readStringArray(params, 'externalPromptResourceIds'),
      } : {}),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updateCardPromptResources(input, ctx.request)),
}

function readOptionalPreset(params: JsonValue | undefined, key: string): { system?: string; macros?: Record<string, string>; macroOptions?: import('@loom-studio/shared').MacroOptions } | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected preset param: ${key}`)

  return {
    system: typeof value.system === 'string' ? value.system : undefined,
    macroOptions: value.macroOptions as import('@loom-studio/shared').MacroOptions | undefined,
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
  function readCandidate(candidate: JsonValue): Omit<OpeningChatInput, 'alternatives'> {
    if (!isRecord(candidate) || typeof candidate.content !== 'string' || 'entries' in candidate || 'role' in candidate) {
      throw new Error(`Expected single opening content: ${key}`)
    }
    if (candidate.id !== undefined && (typeof candidate.id !== 'string' || !candidate.id.trim())) throw new Error('Invalid opening ID')
    if (candidate.title !== undefined && typeof candidate.title !== 'string') throw new Error('Invalid opening title')
    return {
      ...(candidate.id !== undefined ? { id: candidate.id as string } : {}),
      ...(candidate.title !== undefined ? { title: candidate.title as string } : {}),
      content: candidate.content,
    }
  }
  if (value.alternatives !== undefined && !Array.isArray(value.alternatives)) {
    throw new Error('Expected opening alternatives array')
  }
  return {
    ...readCandidate(value),
    ...(value.alternatives !== undefined ? {
      alternatives: value.alternatives.map(readCandidate),
    } : {}),
  }
}

function readOptionalLore(params: JsonValue | undefined, key: string): LoreInput | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected lore param: ${key}`)
  const entries = Array.isArray(value.entries) ? value.entries : []

  return {
    entries: entries.map(entry => {
      if (!isRecord(entry) || typeof entry.content !== 'string') {
        throw new Error(`Expected lore entry content: ${key}`)
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

function readStringRecordValue(value: JsonValue | undefined, key: string): Record<string, string> {
  if (!isRecord(value) || !Object.values(value).every(item => typeof item === 'string')) {
    throw new Error(`Expected string record param: ${key}`)
  }
  return value as Record<string, string>
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
  assertCardBundleArtifact(value)
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
