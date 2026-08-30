import type {
  ApplicationRuntime,
  CompositionItem,
  ProjectionOrderProfile,
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
        skeletonPatch: isRecord(params) ? readProjectionSkeletonPatch(params.skeletonPatch, 'skeletonPatch') : undefined,
        slotRanks: isRecord(params) ? readSlotRanks(params.slotRanks, 'slotRanks') : undefined,
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
      skeletonPatch: readProjectionSkeletonPatch(value.skeletonPatch, `${key}[${index}].skeletonPatch`),
      slotRanks: readSlotRanks(value.slotRanks, `${key}[${index}].slotRanks`),
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
    slotRanks: readSlotRanks(value.slotRanks, `${key}.slotRanks`),
    skeletonPatch: readProjectionSkeletonPatch(value.skeletonPatch, `${key}.skeletonPatch`),
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
  if (value === 'module' || value === 'folder' || value === 'entry' || value === 'script' || value === 'virtual' || value === 'order') return value
  throw new Error(`Expected prompt asset kind: ${key}`)
}

function readPromptAssetCategory(value: JsonValue | undefined, key: string): PromptResourceNode['category'] | undefined {
  if (value === undefined) return undefined
  if (value === 'preset' || value === 'setting' || value === 'logic' || value === 'runtime' || value === 'history') return value
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

function readSlotRanks(value: JsonValue | undefined, key: string): ProjectionOrderProfile['slotRanks'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected slot ranks: ${key}`)
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.zoneId !== 'string' || typeof item.slotKey !== 'string' || typeof item.rankKey !== 'string') {
      throw new Error(`Expected slot rank: ${key}[${index}]`)
    }
    return {
      zoneId: item.zoneId,
      slotKey: item.slotKey,
      rankKey: item.rankKey,
    }
  })
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
  const lifecycle = value.lifecycle
  if (lifecycle !== undefined && (!isRecord(lifecycle) || typeof lifecycle.lifecycle !== 'string')) {
    throw new Error(`Expected prompt lifecycle capability: ${key}.lifecycle`)
  }
  const projection = value.projection
  if (projection !== undefined) {
    if (!isRecord(projection)) throw new Error(`Expected prompt projection capability: ${key}.projection`)
    if (typeof projection.zoneId !== 'string') throw new Error(`Expected prompt projection zoneId: ${key}.projection.zoneId`)
    if (projection.slotKey !== undefined && typeof projection.slotKey !== 'string') throw new Error(`Expected prompt projection slotKey: ${key}.projection.slotKey`)
    if (projection.entryOrderHint !== undefined && typeof projection.entryOrderHint !== 'number') throw new Error(`Expected prompt projection entryOrderHint: ${key}.projection.entryOrderHint`)
    if (projection.slotOrderHint !== undefined && typeof projection.slotOrderHint !== 'number') throw new Error(`Expected prompt projection slotOrderHint: ${key}.projection.slotOrderHint`)
    if (projection.sourceKind !== undefined && projection.sourceKind !== 'actual' && projection.sourceKind !== 'virtual') throw new Error(`Expected prompt projection sourceKind: ${key}.projection.sourceKind`)
  }

  return value as unknown as PromptResourceCompositionCapabilities
}

function readProjectionSkeletonPatch(value: JsonValue | undefined, key: string): ProjectionOrderProfile['skeletonPatch'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Expected projection skeleton patch object: ${key}`)

  return {
    items: readCompositionItems(value.items, `${key}.items`),
    zones: readProjectionZones(value.zones, `${key}.zones`),
    fallbackZoneId: typeof value.fallbackZoneId === 'string' ? value.fallbackZoneId : undefined,
  }
}

function readCompositionItems(value: JsonValue | undefined, key: string): NonNullable<NonNullable<ProjectionOrderProfile['skeletonPatch']>['items']> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected composition items array: ${key}`)
  return value.map((item, index) => readCompositionItem(item, `${key}[${index}]`))
}

function readCompositionItem(value: JsonValue, key: string): CompositionItem {
  if (!isRecord(value)) throw new Error(`Expected composition item object: ${key}`)
  if (typeof value.id !== 'string' || typeof value.displayName !== 'string' || typeof value.orderIndex !== 'number') {
    throw new Error(`Expected composition item identity fields: ${key}`)
  }

  const base = {
    id: value.id,
    displayName: value.displayName,
    orderIndex: value.orderIndex,
  }

  if (value.kind === 'message') {
    if (!isPromptProviderRole(value.role)) throw new Error(`Expected composition message role: ${key}.role`)
    if (!Array.isArray(value.items)) throw new Error(`Expected composition message items array: ${key}.items`)
    return {
      ...base,
      kind: 'message',
      role: value.role,
      items: value.items.map((child, index) => {
        if (isRecord(child) && child.kind === 'message') {
          throw new Error(`Nested composition message blocks are not supported: ${key}.items[${index}]`)
        }
        return readCompositionItem(child, `${key}.items[${index}]`) as Exclude<CompositionItem, { kind: 'message' }>
      }),
    }
  }

  if (value.kind === 'zone') {
    if (value.parentId !== null && typeof value.parentId !== 'string') throw new Error(`Expected composition zone parentId: ${key}.parentId`)
    return {
      ...base,
      kind: 'zone',
      parentId: value.parentId,
      band: readProjectionZoneBand(value.band, `${key}.band`),
      accepts: readCompositionSourceKinds(value.accepts, `${key}.accepts`),
    }
  }

  if (value.kind === 'slot') {
    if (typeof value.bindingId !== 'string') throw new Error(`Expected composition slot bindingId: ${key}.bindingId`)
    if (value.zoneId !== undefined && typeof value.zoneId !== 'string') throw new Error(`Expected composition slot zoneId: ${key}.zoneId`)
    if (value.messageMode !== undefined && value.messageMode !== 'context' && value.messageMode !== 'native') {
      throw new Error(`Expected composition slot messageMode: ${key}.messageMode`)
    }
    if (value.slotKey !== undefined && typeof value.slotKey !== 'string') throw new Error(`Expected composition slot slotKey: ${key}.slotKey`)
    const messageMode: 'context' | 'native' | undefined = value.messageMode === 'context'
      ? 'context'
      : value.messageMode === 'native'
        ? 'native'
        : undefined
    return {
      ...base,
      kind: 'slot',
      bindingId: value.bindingId,
      ...(typeof value.zoneId === 'string' ? { zoneId: value.zoneId } : {}),
      ...(messageMode !== undefined ? { messageMode } : {}),
      ...(typeof value.slotKey === 'string' ? { slotKey: value.slotKey } : {}),
    }
  }

  if (value.kind === 'entry') {
    if (!isRecord(value.source) || (value.source.kind !== 'preset' && value.source.kind !== 'binding')) {
      throw new Error(`Expected composition entry source: ${key}.source`)
    }
    const sourceKey = value.source.kind === 'preset' ? 'nodeId' : 'bindingId'
    if (typeof value.source[sourceKey] !== 'string') throw new Error(`Expected composition entry source id: ${key}.source.${sourceKey}`)
    return {
      ...base,
      kind: 'entry',
      source: value.source.kind === 'preset'
        ? { kind: 'preset', nodeId: value.source.nodeId as string }
        : { kind: 'binding', bindingId: value.source.bindingId as string },
    }
  }

  throw new Error(`Expected composition item kind: ${key}.kind`)
}

function readZoneRenderHint(value: Record<string, JsonValue>, key: string): NonNullable<NonNullable<ProjectionOrderProfile['skeletonPatch']>['zones']>[number]['renderHint'] {
  if (value.providerRoleHint !== undefined && !isPromptProviderRole(value.providerRoleHint)) {
    throw new Error(`Expected projection provider role: ${key}.providerRoleHint`)
  }
  if (value.wrapper !== undefined && value.wrapper !== 'section' && value.wrapper !== 'message') {
    throw new Error(`Expected projection wrapper: ${key}.wrapper`)
  }
  return {
    ...(isPromptProviderRole(value.providerRoleHint) ? { providerRoleHint: value.providerRoleHint } : {}),
    ...(value.wrapper === 'section' || value.wrapper === 'message' ? { wrapper: value.wrapper } : {}),
  }
}

function readCompositionSourceKinds(value: JsonValue | undefined, key: string): PromptSourceKind[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(item => isPromptSourceKind(item))) {
    throw new Error(`Expected composition source kinds: ${key}`)
  }
  return value
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

function readProjectionZones(value: JsonValue | undefined, key: string): NonNullable<ProjectionOrderProfile['skeletonPatch']>['zones'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected projection zones array: ${key}`)

  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Expected projection zone object: ${key}[${index}]`)
    if (typeof item.id !== 'string') throw new Error(`Expected projection zone id: ${key}[${index}].id`)
    if (typeof item.displayName !== 'string') throw new Error(`Expected projection zone displayName: ${key}[${index}].displayName`)
    if (typeof item.orderIndex !== 'number') throw new Error(`Expected projection zone orderIndex: ${key}[${index}].orderIndex`)
    return {
      id: item.id,
      parentId: typeof item.parentId === 'string' ? item.parentId : null,
      displayName: item.displayName,
      band: readProjectionZoneBand(item.band, `${key}[${index}].band`),
      orderIndex: item.orderIndex,
      accepts: readProjectionSourceKinds(item.accepts, `${key}[${index}].accepts`),
      ...(isRecord(item.renderHint) ? {
        renderHint: readZoneRenderHint(item.renderHint, `${key}[${index}].renderHint`),
      } : {}),
    }
  })
}

function readProjectionSourceKinds(value: JsonValue | undefined, label: string): PromptSourceKind[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every(kind => isPromptSourceKind(kind))) {
    throw new Error(`Expected projection source kinds: ${label}`)
  }
  return value
}

function readProjectionZoneBand(value: JsonValue | undefined, label: string): 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail' {
  if (
    value === 'stable-prefix'
    || value === 'narrative'
    || value === 'lower-context'
    || value === 'current-turn'
    || value === 'fresh-tail'
  ) {
    return value
  }
  throw new Error(`Expected projection zone band: ${label}`)
}
