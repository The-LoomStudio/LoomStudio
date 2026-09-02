import type {
  ApplicationRuntime,

  PromptAssetPatch,
  PromptProviderRole,
  PromptResourceCompositionCapabilities,
  PromptResourceKind,
  PromptResourceNode,
  PromptSourceKind,
  RuntimeRequestContext,
  SettingMountSource,
} from '@loom-studio/application-runtime'
import { isPromptActivation, isPromptResourceArtifact } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleWorkspacesRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.getPromptResource':
      return await runtime.getPromptResource({
        resourceId: readString(params, 'resourceId'),
      }) as unknown as JsonValue

    case 'application.listPromptResources':
      return await runtime.listPromptResources({
        resourceKind: readOptionalPromptResourceKind(params, 'resourceKind'),
      }) as unknown as JsonValue

    case 'application.createPromptResource':
      return await runtime.createPromptResource({
        resourceKind: readPromptResourceKind(params, 'resourceKind'),
        name: readString(params, 'name'),
      }, context) as unknown as JsonValue

    case 'application.duplicatePromptResource':
      return await runtime.duplicatePromptResource({
        resourceId: readString(params, 'resourceId'),
        name: readOptionalString(params, 'name'),
      }, context) as unknown as JsonValue

    case 'application.deletePromptResource':
      return await runtime.deletePromptResource({
        resourceId: readString(params, 'resourceId'),
      }, context) as unknown as JsonValue

    case 'application.revertPromptResourceChangeset':
      return await runtime.revertPromptResourceChangeset({
        changesetId: readString(params, 'changesetId'),
        expectedVersion: readOptionalNumber(params, 'expectedVersion'),
      }, context) as unknown as JsonValue

    case 'application.revertChangeset':
      return await runtime.revertChangeset({
        changesetId: readString(params, 'changesetId'),
      }, context) as unknown as JsonValue

    case 'application.importPromptResource': {
      const artifact = isRecord(params) ? params.artifact : undefined
      if (!isPromptResourceArtifact(artifact)) throw new Error('Expected valid Prompt Resource artifact param: artifact')
      return await runtime.importPromptResource({ artifact }, context) as unknown as JsonValue
    }

    case 'application.exportPromptResource':
      return await runtime.exportPromptResource({
        resourceId: readString(params, 'resourceId'),
      }) as unknown as JsonValue

    case 'application.listSettingMounts':
      return await runtime.listSettingMounts({
        source: readOptionalSettingMountSource(params, 'source'),
      }) as unknown as JsonValue

    case 'application.replaceSettingMounts':
      return await runtime.replaceSettingMounts({
        source: readSettingMountSource(isRecord(params) ? params.source : undefined, 'source'),
        settingResourceIds: readRequiredStringArray(params, 'settingResourceIds'),
      }, context) as unknown as JsonValue

    case 'application.createPromptResourceAsset':
      return await runtime.createPromptResourceAsset({
        resourceId: readString(params, 'resourceId'),
        targetAssetId: readString(params, 'targetAssetId'),
        position: readAssetPosition(params, 'position'),
        asset: readPromptResourceNode(params, 'asset'),
      }, context) as unknown as JsonValue

    case 'application.updatePromptResourceAsset':
      return await runtime.updatePromptResourceAsset({
        resourceId: readString(params, 'resourceId'),
        assetId: readString(params, 'assetId'),
        body: readOptionalString(params, 'body'),
        capabilities: readOptionalPromptCapabilities(params, 'capabilities'),
        label: readOptionalString(params, 'label'),
        meta: readOptionalString(params, 'meta'),
        enabled: readOptionalBoolean(params, 'enabled'),
        orderList: isRecord(params) ? readStringArray(params.orderList, 'orderList') : undefined,

      }, context) as unknown as JsonValue

    case 'application.updatePromptResourceAssets':
      return await runtime.updatePromptResourceAssets({
        resourceId: readString(params, 'resourceId'),
        updates: readPromptAssetPatches(params, 'updates'),
      }, context) as unknown as JsonValue

    case 'application.movePromptResourceAsset':
      return await runtime.movePromptResourceAsset({
        resourceId: readString(params, 'resourceId'),
        assetId: readString(params, 'assetId'),
        targetAssetId: readString(params, 'targetAssetId'),
        position: readAssetPosition(params, 'position'),
      }, context) as unknown as JsonValue

    case 'application.deletePromptResourceAsset':
      return await runtime.deletePromptResourceAsset({
        resourceId: readString(params, 'resourceId'),
        assetId: readString(params, 'assetId'),
      }, context) as unknown as JsonValue

    default:
      return undefined
  }
}

function readRequiredStringArray(params: JsonValue | undefined, key: string): string[] {
  if (!isRecord(params) || !Array.isArray(params[key]) || !params[key].every(item => typeof item === 'string')) {
    throw new Error(`Expected string array param: ${key}`)
  }
  return params[key]
}

function readOptionalSettingMountSource(params: JsonValue | undefined, key: string): SettingMountSource | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  return readSettingMountSource(params[key], key)
}

function readSettingMountSource(value: JsonValue | undefined, key: string): SettingMountSource {
  if (!isRecord(value) || (value.kind !== 'manual' && value.kind !== 'preset')) {
    throw new Error(`Expected Setting mount source param: ${key}`)
  }
  if (value.kind === 'manual') {
    if (value.id !== undefined && value.id !== 'global') throw new Error(`Expected Setting mount source param: ${key}`)
    return value.id === undefined ? { kind: 'manual' } : { kind: 'manual', id: 'global' }
  }
  if (typeof value.id !== 'string') throw new Error(`Expected Setting mount source param: ${key}`)
  return { kind: 'preset', id: value.id }
}

function readOptionalPromptResourceKind(params: JsonValue | undefined, key: string): PromptResourceKind | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  return readPromptResourceKind(params, key)
}

function readPromptResourceKind(params: JsonValue | undefined, key: string): PromptResourceKind {
  const value = readString(params, key)
  if (value === 'preset' || value === 'setting' || value === 'logic' || value === 'runtime' || value === 'history' || value === 'prompt') {
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
      orderList: readStringArray(value.orderList, `${key}[${index}].orderList`),
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
    configRows: readConfigRows(value.configRows, `${key}.configRows`),
    orderList: readStringArray(value.orderList, `${key}.orderList`),
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

function readConfigRows(value: JsonValue | undefined, key: string): Array<{ label: string; value: string }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected config rows: ${key}`)
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.label !== 'string' || typeof item.value !== 'string') {
      throw new Error(`Expected config row: ${key}[${index}]`)
    }
    return { label: item.label, value: item.value }
  })
}

function readStringArray(value: JsonValue | undefined, key: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) throw new Error(`Expected string array: ${key}`)
  return value
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
  
  if (value.roleHint !== undefined && !isPromptProviderRole(value.roleHint)) {
    throw new Error(`Expected roleHint PromptProviderRole: ${key}.roleHint`)
  }

  return value as unknown as PromptResourceCompositionCapabilities
}

function isPromptSourceKind(value: JsonValue): value is PromptSourceKind {
  return value === 'preset'
    || value === 'settingLayer'
    || value === 'narrativeChat'
    || value === 'narrativeHistory'
    || value === 'sessionHistory'
    || value === 'runtime'
}

function isPromptProviderRole(value: JsonValue | undefined): value is PromptProviderRole {
  return value === 'system' || value === 'developer' || value === 'assistant' || value === 'user'
}
