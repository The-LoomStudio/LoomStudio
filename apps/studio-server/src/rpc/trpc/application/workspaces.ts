import { authoringApplySchema } from '@loom-studio/shared'
import { z } from 'zod'
import type {
  ApplicationRuntime,

  PromptAssetPatch,
  PromptResourceCompositionCapabilities,
  PromptResourceKind,
  PromptResourceNode
} from '@loom-studio/application-runtime'
import { isPromptActivation, isPromptResourceArtifact } from '@loom-studio/application-runtime'
import {
  listLoreMountsInputSchema,
  loreMountSourceSchema,
  replaceLoreMountsInputSchema,
  type JsonValue,
} from '@loom-studio/shared'
import { decodePromptResourceZip, encodePromptResourceZip } from '../../../codecs/prompt-resource-zip.js'
import {
  isRecord,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readString,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const workspacesProcedures = {
  captureResourceAuthoring: procedure.input(z.object({ resourceId: z.string().min(1) })).query(({ ctx, input }) => ctx.runtime.captureResourceAuthoring(input)),
  diffResourceAuthoring: procedure.input(authoringApplySchema).query(({ ctx, input }) => ctx.runtime.diffResourceAuthoring(input)),
  applyResourceAuthoring: procedure.input(authoringApplySchema).mutation(({ ctx, input }) => ctx.runtime.applyResourceAuthoring(input, ctx.request)),
  'listExtensionInstallations': procedure.query(({ ctx }) => ctx.runtime.listExtensionInstallations()),
  'getPromptResource': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getPromptResource']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getPromptResource(input)),
  'listPromptResources': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listPromptResources']>[0] => {
    return {
      resourceKind: readOptionalPromptResourceKind(params, 'resourceKind'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listPromptResources(input)),
  'getPromptResourceBindings': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getPromptResourceBindings']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getPromptResourceBindings(input)),
  'createPromptResource': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createPromptResource']>[0] => {
    return {
      resourceKind: readPromptResourceKind(params, 'resourceKind'),
      name: readString(params, 'name'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createPromptResource(input, ctx.request)),
  'duplicatePromptResource': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['duplicatePromptResource']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      name: readOptionalString(params, 'name'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.duplicatePromptResource(input, ctx.request)),
  'deletePromptResource': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deletePromptResource']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deletePromptResource(input, ctx.request)),
  'revertPromptResourceChangeset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['revertPromptResourceChangeset']>[0] => {
    return {
      changesetId: readString(params, 'changesetId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.revertPromptResourceChangeset(input, ctx.request)),
  'revertChangeset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['revertChangeset']>[0] => {
    return {
      changesetId: readString(params, 'changesetId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.revertChangeset(input, ctx.request)),
  'importPromptResource': procedure.input(jsonInput((params: JsonValue | undefined): { artifact: JsonValue; name?: string } => {
    if (!isRecord(params) || params.artifact === undefined) throw new Error('Expected Prompt Resource artifact')
    return { artifact: params.artifact, name: readOptionalString(params, 'name') }
  })).mutation(async ({ ctx, input }) => {
    const defaultName = input.name?.trim() || undefined
    if (isPromptResourceArtifact(input.artifact)) return ctx.runtime.importPromptResource({ artifact: input.artifact }, ctx.request)
    if (!ctx.convertPromptResource) throw new Error('No active extension converter for this Prompt Resource format')
    const artifact = await ctx.convertPromptResource(input.artifact, defaultName, ctx.request)
    return ctx.runtime.importPromptResource({ artifact }, ctx.request)
  }),
  'exportPromptResource': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['exportPromptResource']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.exportPromptResource(input)),
  'importPromptResourceZip': procedure.input(jsonInput((params: JsonValue | undefined) => ({ base64: readString(params, 'base64') }))).mutation(({ ctx, input }) => {
    const artifact = decodePromptResourceZip(Buffer.from(input.base64, 'base64'))
    return ctx.runtime.importPromptResource({ artifact }, ctx.request)
  }),
  'exportPromptResourceZip': procedure.input(jsonInput((params: JsonValue | undefined) => ({ resourceId: readString(params, 'resourceId') }))).query(async ({ ctx, input }) => {
    const { artifact } = await ctx.runtime.exportPromptResource({ resourceId: input.resourceId })
    return { fileName: `${artifact.resourceKind}-${input.resourceId}.loom-prompt.zip`, base64: Buffer.from(encodePromptResourceZip(artifact)).toString('base64') }
  }),
  'updatePromptResourceMacros': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updatePromptResourceMacros']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      expectedVersion: readRequiredNumber(params, 'expectedVersion'),
      macros: readRequiredStringRecord(params, 'macros'),
      macroOptions: readOptionalObject(params, 'macroOptions') as import('@loom-studio/shared').MacroOptions | undefined,
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updatePromptResourceMacros(input, ctx.request)),
  'listLoreMounts': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listLoreMounts']>[0] => {
    return readListLoreMountsInput(params)
  })).query(({ ctx, input }) => ctx.runtime.listLoreMounts(input)),
  'replaceLoreMounts': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['replaceLoreMounts']>[0] => {
    return readReplaceLoreMountsInput(params)
  })).mutation(({ ctx, input }) => ctx.runtime.replaceLoreMounts(input, ctx.request)),
  'createPromptResourceAsset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['createPromptResourceAsset']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      targetAssetId: readString(params, 'targetAssetId'),
      position: readAssetPosition(params, 'position'),
      asset: readPromptResourceNode(params, 'asset'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.createPromptResourceAsset(input, ctx.request)),
  'updatePromptResourceAsset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updatePromptResourceAsset']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      assetId: readString(params, 'assetId'),
      body: readOptionalString(params, 'body'),
      capabilities: readOptionalPromptCapabilities(params, 'capabilities'),
      label: readOptionalString(params, 'label'),
      meta: readOptionalString(params, 'meta'),
      enabled: readOptionalBoolean(params, 'enabled'),

    }
  })).mutation(({ ctx, input }) => ctx.runtime.updatePromptResourceAsset(input, ctx.request)),
  'updatePromptResourceAssets': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['updatePromptResourceAssets']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      updates: readPromptAssetPatches(params, 'updates'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.updatePromptResourceAssets(input, ctx.request)),
  'movePromptResourceAsset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['movePromptResourceAsset']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      assetId: readString(params, 'assetId'),
      targetAssetId: readString(params, 'targetAssetId'),
      position: readAssetPosition(params, 'position'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.movePromptResourceAsset(input, ctx.request)),
  'deletePromptResourceAsset': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['deletePromptResourceAsset']>[0] => {
    return {
      resourceId: readString(params, 'resourceId'),
      assetId: readString(params, 'assetId'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.deletePromptResourceAsset(input, ctx.request)),
}

function readRequiredNumber(params: JsonValue | undefined, key: string): number {
  const value = isRecord(params) ? params[key] : undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Expected integer param: ${key}`)
  return value
}

function readRequiredStringRecord(params: JsonValue | undefined, key: string): Record<string, string> {
  const value = isRecord(params) ? params[key] : undefined
  if (!isRecord(value) || !Object.values(value).every(item => typeof item === 'string')) throw new Error(`Expected string record param: ${key}`)
  return value as Record<string, string>
}

function readListLoreMountsInput(params: JsonValue | undefined) {
  const result = listLoreMountsInputSchema.safeParse(params ?? {})
  if (!result.success) throw new Error('Expected Lore mount source param: source')
  return result.data
}

function readReplaceLoreMountsInput(params: JsonValue | undefined) {
  const source = loreMountSourceSchema.safeParse(isRecord(params) ? params.source : undefined)
  if (!source.success) throw new Error('Expected Lore mount source param: source')
  return replaceLoreMountsInputSchema.parse(params)
}

function readOptionalPromptResourceKind(params: JsonValue | undefined, key: string): PromptResourceKind | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  return readPromptResourceKind(params, key)
}

function readPromptResourceKind(params: JsonValue | undefined, key: string): PromptResourceKind {
  const value = readString(params, key)
  if (value === 'preset' || value === 'lore' || value === 'logic' || value === 'runtime' || value === 'history' || value === 'prompt') {
    return value
  }
  throw new Error(`Expected Prompt Resource kind param: ${key}`)
}

function readPromptResourceNode(params: JsonValue | undefined, key: string): PromptResourceNode {
  if (!isRecord(params) || params[key] === undefined) throw new Error(`Expected prompt asset node param: ${key}`)
  return readPromptResourceNodeValue(params[key], key)
}

function readPromptAssetPatches(params: JsonValue | undefined, key: string): PromptAssetPatch[] {
  if (!isRecord(params) || !Array.isArray(params[key])) throw new Error(`Expected prompt asset patches param: ${key}`)
  return params[key].map((value, index) => {
    if (!isRecord(value)) throw new Error(`Expected prompt asset patch: ${key}[${index}]`)

    return {
      assetId: readString(value, 'assetId'),
      body: readOptionalString(value, 'body'),
      capabilities: readOptionalPromptCapabilities(value, 'capabilities'),
      enabled: readOptionalBoolean(value, 'enabled'),
      label: readOptionalString(value, 'label'),
      meta: readOptionalString(value, 'meta'),
    }
  })
}

function readPromptResourceNodeValue(value: JsonValue | undefined, key: string): PromptResourceNode {
  if (!isRecord(value)) throw new Error(`Expected prompt asset node: ${key}`)
  if (typeof value.id !== 'string' || value.id.trim().length === 0) throw new Error(`Expected prompt asset id: ${key}.id`)
  if (typeof value.label !== 'string') throw new Error(`Expected prompt asset label: ${key}.label`)

  return {
    id: value.id,
    label: value.label,
    kind: readPromptAssetKind(value.kind, `${key}.kind`),
    category: readPromptAssetCategory(value.category, `${key}.category`),
    body: typeof value.body === 'string' ? value.body : undefined,
    meta: typeof value.meta === 'string' ? value.meta : undefined,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    capabilities: readPromptCapabilitiesValue(value.capabilities, `${key}.capabilities`),
    children: Array.isArray(value.children)
      ? value.children.map((child, index) => readPromptResourceNodeValue(child, `${key}.children[${index}]`))
      : undefined,
  }
}

function readAssetPosition(params: JsonValue | undefined, key: string): 'before' | 'inside' | 'after' {
  const value = readString(params, key)
  if (value === 'before' || value === 'inside' || value === 'after') return value
  throw new Error(`Expected prompt asset position: ${key}`)
}

function readPromptAssetKind(value: JsonValue | undefined, key: string): PromptResourceNode['kind'] {
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`Expected prompt asset kind: ${key}`)
}

function readPromptAssetCategory(value: JsonValue | undefined, key: string): PromptResourceNode['category'] | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`Expected prompt asset category: ${key}`)
}

function readOptionalPromptCapabilities(params: JsonValue | undefined, key: string): PromptResourceCompositionCapabilities | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  return readPromptCapabilitiesValue(params[key], key)
}

function readPromptCapabilitiesValue(value: JsonValue | undefined, key: string): PromptResourceCompositionCapabilities | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Expected prompt capabilities param: ${key}`)

  const activation = value.activation
  if (activation !== undefined && !isPromptActivation(activation)) {
    throw new Error(`Expected prompt activation capability: ${key}.activation`)
  }

  if (value.targetAnchorId !== undefined && typeof value.targetAnchorId !== 'string') {
    throw new Error(`Expected targetAnchorId string: ${key}.targetAnchorId`)
  }

  if (value.localDepth !== undefined && typeof value.localDepth !== 'number') {
    throw new Error(`Expected localDepth number: ${key}.localDepth`)
  }

  if (value.roleHint !== undefined && !isPromptAuthorRole(value.roleHint)) {
    throw new Error(`Expected Prompt author role: ${key}.roleHint`)
  }

  return value as unknown as PromptResourceCompositionCapabilities
}

function isPromptAuthorRole(value: JsonValue | undefined): value is NonNullable<PromptResourceCompositionCapabilities['roleHint']> {
  return value === 'system' || value === 'assistant' || value === 'user'
}
