import type {
  ApplicationRuntime,
  CompositionItem,
  OpeningChatInput,
  PromptAssetPatch,
  PromptResourceNode,
  ProjectionOrderProfile,
  RuntimeRequestContext,
  SettingActivation,
  SettingLayerInput,
  PromptResourceCompositionCapabilities,
  PromptResourceKind,
  PromptProviderRole,
  PromptSourceKind,
} from '@loom-studio/application-runtime'
import { isPromptActivation, isCardBundleArtifact, isPromptResourceArtifact } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { createNamespaceRpcCapabilities, type RpcCapability } from './rpc-capability.js'
import {
  isRecord,
  readOptionalNumber,
  readOptionalObject,
  readOptionalString,
  readOptionalStringRecord,
  readString,
} from './rpc-params.js'

const applicationRpcMethods = [
  'application.createCard',
  'application.getCard',
  'application.listCards',
  'application.updateCard',
  'application.deleteCard',
  'application.createProviderProfile',
  'application.getProviderProfile',
  'application.listProviderProfiles',
  'application.updateProviderProfile',
  'application.replaceProviderCredential',
  'application.deleteProviderProfile',
  'application.listProviderModels',
  'application.pingProviderModel',
  'application.createAgentProfile',
  'application.getAgentProfile',
  'application.listAgentProfiles',
  'application.updateAgentProfile',
  'application.deleteAgentProfile',
  'application.createAgentSession',
  'application.getAgentSession',
  'application.getAgentMessagePage',
  'application.deleteAgentSession',
  'application.invokeAgentTurn',
  'application.previewAgentTurn',
  'application.createNarrativeTimelineFromCard',
  'application.getNarrativeTimeline',
  'application.listNarrativeTimelines',
  'application.getNarrativePage',
  'application.forkNarrativeBranch',
  'application.switchNarrativeBranch',
  'application.deleteNarrativeTimeline',
  'application.importCardBundle',
  'application.getImportBundle',
  'application.getPromptResource',
  'application.listPromptResources',
  'application.createPromptResource',
  'application.duplicatePromptResource',
  'application.deletePromptResource',
  'application.revertPromptResourceChangeset',
  'application.importPromptResource',
  'application.exportPromptResource',
  'application.listCardPromptResources',
  'application.updateCardPromptResources',
  'application.updatePresetSettings',
  'application.listGlobalSettingMounts',
  'application.replaceGlobalSettingMounts',
  'application.createPromptResourceAsset',
  'application.updatePromptResourceAsset',
  'application.updatePromptResourceAssets',
  'application.movePromptResourceAsset',
  'application.deletePromptResourceAsset',
  'application.exportCardArtifact',
] as const

export function listApplicationRpcCapabilities(): RpcCapability[] {
  return createNamespaceRpcCapabilities({
    names: applicationRpcMethods,
    namespace: 'application',
    owner: 'application',
    stability: 'experimental',
  })
}

export async function callApplicationRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
  context?: RuntimeRequestContext,
): Promise<JsonValue> {
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
      }, context) as unknown as JsonValue

    case 'application.deleteCard':
      return await runtime.deleteCard({
        cardId: readString(params, 'cardId'),
      }, context) as unknown as JsonValue

    case 'application.createProviderProfile':
      return await runtime.createProviderProfile({
        providerExtensionId: readString(params, 'providerExtensionId'),
        displayName: readString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
        credential: readOptionalStringRecord(params, 'credential'),
      }, context) as unknown as JsonValue

    case 'application.getProviderProfile':
      return await runtime.getProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
      }) as unknown as JsonValue

    case 'application.listProviderProfiles':
      return await runtime.listProviderProfiles({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateProviderProfile':
      return await runtime.updateProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
        displayName: readOptionalString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        enabledModelIds: readOptionalStringArray(params, 'enabledModelIds'),
      }) as unknown as JsonValue

    case 'application.replaceProviderCredential':
      return await runtime.replaceProviderCredential({
        providerProfileId: readString(params, 'providerProfileId'),
        credential: readRequiredStringRecord(params, 'credential'),
      }, context) as unknown as JsonValue

    case 'application.deleteProviderProfile':
      return await runtime.deleteProviderProfile({
        providerProfileId: readString(params, 'providerProfileId'),
      }, context) as unknown as JsonValue

    case 'application.listProviderModels':
      return await runtime.listProviderModels({
        providerProfileId: readString(params, 'providerProfileId'),
      }, context) as unknown as JsonValue

    case 'application.pingProviderModel':
      return await runtime.pingProviderModel({
        providerProfileId: readString(params, 'providerProfileId'),
        modelId: readString(params, 'modelId'),
        text: readOptionalString(params, 'text'),
      }, context) as unknown as JsonValue

    case 'application.createAgentProfile':
      return await runtime.createAgentProfile({
        name: readString(params, 'name'),
        presetId: readString(params, 'presetId'),
        model: readRequiredProviderModelSelection(params, 'model'),
      }) as unknown as JsonValue

    case 'application.getAgentProfile':
      return await runtime.getAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.listAgentProfiles':
      return await runtime.listAgentProfiles({ cursor: readOptionalString(params, 'cursor'), limit: readOptionalNumber(params, 'limit') }) as unknown as JsonValue

    case 'application.updateAgentProfile':
      return await runtime.updateAgentProfile({
        agentProfileId: readString(params, 'agentProfileId'),
        name: readOptionalString(params, 'name'),
        presetId: readOptionalString(params, 'presetId'),
        model: readOptionalProviderModelSelection(params, 'model'),
      }) as unknown as JsonValue

    case 'application.deleteAgentProfile':
      return await runtime.deleteAgentProfile({ agentProfileId: readString(params, 'agentProfileId') }) as unknown as JsonValue

    case 'application.createAgentSession':
      return await runtime.createAgentSession({
        agentProfileId: readString(params, 'agentProfileId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.getAgentSession':
      return await runtime.getAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }) as unknown as JsonValue

    case 'application.getAgentMessagePage':
      return await runtime.getAgentMessagePage({
        agentSessionId: readString(params, 'agentSessionId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.deleteAgentSession':
      return await runtime.deleteAgentSession({
        agentSessionId: readString(params, 'agentSessionId'),
      }, context) as unknown as JsonValue

    case 'application.invokeAgentTurn':
      return await runtime.invokeAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
      }, context) as unknown as JsonValue

    case 'application.previewAgentTurn':
      return await runtime.previewAgentTurn({
        agentSessionId: readString(params, 'agentSessionId'),
        input: readString(params, 'input'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
        narrativeTarget: readOptionalNarrativeTarget(params),
      }, context) as unknown as JsonValue

    case 'application.createNarrativeTimelineFromCard':
      return await runtime.createNarrativeTimelineFromCard({
        cardId: readString(params, 'cardId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.getNarrativeTimeline':
      return await runtime.getNarrativeTimeline({
        timelineId: readString(params, 'timelineId'),
      }) as unknown as JsonValue

    case 'application.listNarrativeTimelines':
      return await runtime.listNarrativeTimelines({
        createdFromCardId: readOptionalString(params, 'createdFromCardId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.getNarrativePage':
      return await runtime.getNarrativePage({
        timelineId: readString(params, 'timelineId'),
        branchId: readOptionalString(params, 'branchId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.forkNarrativeBranch':
      return await runtime.forkNarrativeBranch({
        timelineId: readString(params, 'timelineId'),
        fromBranchId: readString(params, 'fromBranchId'),
        fromNodeId: readString(params, 'fromNodeId'),
        title: readOptionalString(params, 'title'),
      }, context) as unknown as JsonValue

    case 'application.switchNarrativeBranch':
      return await runtime.switchNarrativeBranch({
        timelineId: readString(params, 'timelineId'),
        branchId: readString(params, 'branchId'),
        expectedActiveBranchId: readOptionalString(params, 'expectedActiveBranchId'),
      }, context) as unknown as JsonValue

    case 'application.deleteNarrativeTimeline':
      return await runtime.deleteNarrativeTimeline({
        timelineId: readString(params, 'timelineId'),
      }, context) as unknown as JsonValue

    case 'application.importCardBundle':
      return await runtime.importCardBundle(readCardBundleImportInput(params), context) as unknown as JsonValue

    case 'application.getImportBundle':
      return await runtime.getImportBundle({
        importBundleId: readString(params, 'importBundleId'),
      }) as unknown as JsonValue

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

    case 'application.importPromptResource': {
      const artifact = isRecord(params) ? params.artifact : undefined
      if (!isPromptResourceArtifact(artifact)) throw new Error('Expected valid Prompt Resource artifact param: artifact')
      return await runtime.importPromptResource({ artifact }, context) as unknown as JsonValue
    }

    case 'application.exportPromptResource':
      return await runtime.exportPromptResource({
        resourceId: readString(params, 'resourceId'),
      }) as unknown as JsonValue

    case 'application.listCardPromptResources':
      return await runtime.listCardPromptResources({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    case 'application.updateCardPromptResources':
      return await runtime.updateCardPromptResources({
        cardId: readString(params, 'cardId'),
        promptResourceIds: readRequiredStringArray(params, 'promptResourceIds'),
      }, context) as unknown as JsonValue

    case 'application.updatePresetSettings':
      return await runtime.updatePresetSettings({
        presetId: readString(params, 'presetId'),
        linkedSettingIds: readRequiredStringArray(params, 'linkedSettingIds'),
      }, context) as unknown as JsonValue

    case 'application.listGlobalSettingMounts':
      return await runtime.listGlobalSettingMounts() as unknown as JsonValue

    case 'application.replaceGlobalSettingMounts':
      return await runtime.replaceGlobalSettingMounts({
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

    case 'application.exportCardArtifact':
      return await runtime.exportCardArtifact({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    default:
      throw new Error(`Application RPC method not found: ${method}`)
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

function readOptionalBoolean(params: JsonValue | undefined, key: string): boolean | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  if (typeof params[key] !== 'boolean') throw new Error(`Expected optional boolean param: ${key}`)
  return params[key]
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

function readRequiredStringRecord(params: JsonValue | undefined, key: string): Record<string, string> {
  const value = readOptionalStringRecord(params, key)
  if (!value) throw new Error(`Expected string record param: ${key}`)
  return value
}

function readOptionalProviderModelSelection(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value) || typeof value.providerProfileId !== 'string' || typeof value.modelId !== 'string') {
    throw new Error(`Expected Provider model selection param: ${key}`)
  }
  return { providerProfileId: value.providerProfileId, modelId: value.modelId }
}

function readRequiredProviderModelSelection(params: JsonValue | undefined, key: string) {
  const value = readOptionalProviderModelSelection(params, key)
  if (!value) throw new Error(`Expected Provider model selection param: ${key}`)
  return value
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

function readOptionalPreset(params: JsonValue | undefined, key: string): { system?: string } | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected preset param: ${key}`)

  return {
    system: typeof value.system === 'string' ? value.system : undefined,
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
        activation: readActivation(entry.activation),
        tags: Array.isArray(entry.tags) && entry.tags.every(tag => typeof tag === 'string') ? entry.tags : undefined,
      }
    }),
  }
}

function readActivation(value: JsonValue | undefined): SettingActivation | undefined {
  if (value === undefined) return undefined
  if (isPromptActivation(value)) return value
  throw new Error('Expected setting activation')
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

function readOptionalNarrativeTarget(params: JsonValue | undefined): {
  timelineId: string
  branchId?: string
  commit: boolean
} | undefined {
  const value = readOptionalObject(params, 'narrativeTarget')
  if (value === undefined) return undefined
  if (typeof value.timelineId !== 'string') throw new Error('Expected string param: narrativeTarget.timelineId')
  if (value.branchId !== undefined && typeof value.branchId !== 'string') {
    throw new Error('Expected optional string param: narrativeTarget.branchId')
  }
  if (typeof value.commit !== 'boolean') throw new Error('Expected boolean param: narrativeTarget.commit')
  return {
    timelineId: value.timelineId,
    ...(typeof value.branchId === 'string' ? { branchId: value.branchId } : {}),
    commit: value.commit,
  }
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
