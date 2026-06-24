import type { ApplicationRuntime, OpeningChatInput, ProjectionOrderProfile, SettingActivation, SettingLayerInput } from '@loom-studio/application-runtime'
import { isPromptActivation, isPromptWorkspaceArtifact } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { createNamespaceRpcCapabilities, type RpcCapability } from './rpc-capability.js'
import {
  isRecord,
  readNullableString,
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
  'application.createProviderAccount',
  'application.getProviderAccount',
  'application.listProviderAccounts',
  'application.updateProviderAccount',
  'application.deleteProviderAccount',
  'application.createModelProfile',
  'application.getModelProfile',
  'application.listModelProfiles',
  'application.updateModelProfile',
  'application.deleteModelProfile',
  'application.pingModelProfile',
  'application.createAgentRuntimeProfile',
  'application.getAgentRuntimeProfile',
  'application.listAgentRuntimeProfiles',
  'application.updateAgentRuntimeProfile',
  'application.deleteAgentRuntimeProfile',
  'application.createSession',
  'application.createSessionFromCard',
  'application.importWorkspaceArtifact',
  'application.getPromptWorkspace',
  'application.updatePromptAsset',
  'application.updateProjectionOrderProfile',
  'application.exportWorkspaceArtifact',
  'application.previewPrompt',
  'application.submitTurn',
  'application.getSession',
  'application.getTimeline',
  'application.getAgentTranscript',
  'application.getRun',
  'application.forkBranch',
] as const

export function listApplicationRpcCapabilities(): RpcCapability[] {
  return createNamespaceRpcCapabilities({
    names: applicationRpcMethods,
    namespace: 'application',
    owner: 'application',
    stability: 'experimental',
  })
}

export async function callApplicationRpc(runtime: ApplicationRuntime, method: string, params: JsonValue | undefined): Promise<JsonValue> {
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
      }) as unknown as JsonValue

    case 'application.getCard':
      return await runtime.getCard({
        cardId: readString(params, 'cardId'),
      }) as unknown as JsonValue

    case 'application.listCards':
      return await runtime.listCards({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.createProviderAccount':
      return await runtime.createProviderAccount({
        providerExtensionId: readString(params, 'providerExtensionId'),
        displayName: readString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        secretRefs: readOptionalStringRecord(params, 'secretRefs'),
      }) as unknown as JsonValue

    case 'application.getProviderAccount':
      return await runtime.getProviderAccount({
        providerAccountId: readString(params, 'providerAccountId'),
      }) as unknown as JsonValue

    case 'application.listProviderAccounts':
      return await runtime.listProviderAccounts({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateProviderAccount':
      return await runtime.updateProviderAccount({
        providerAccountId: readString(params, 'providerAccountId'),
        displayName: readOptionalString(params, 'displayName'),
        config: readOptionalObject(params, 'config'),
        secretRefs: readOptionalStringRecord(params, 'secretRefs'),
      }) as unknown as JsonValue

    case 'application.deleteProviderAccount':
      return await runtime.deleteProviderAccount({
        providerAccountId: readString(params, 'providerAccountId'),
      }) as unknown as JsonValue

    case 'application.createModelProfile':
      return await runtime.createModelProfile({
        providerAccountId: readString(params, 'providerAccountId'),
        capability: readOptionalModelCapability(params, 'capability'),
        displayName: readString(params, 'displayName'),
        providerModelId: readString(params, 'providerModelId'),
        config: readOptionalObject(params, 'config'),
      }) as unknown as JsonValue

    case 'application.getModelProfile':
      return await runtime.getModelProfile({
        modelProfileId: readString(params, 'modelProfileId'),
      }) as unknown as JsonValue

    case 'application.listModelProfiles':
      return await runtime.listModelProfiles({
        providerAccountId: readOptionalString(params, 'providerAccountId'),
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateModelProfile':
      return await runtime.updateModelProfile({
        modelProfileId: readString(params, 'modelProfileId'),
        displayName: readOptionalString(params, 'displayName'),
        providerModelId: readOptionalString(params, 'providerModelId'),
        config: readOptionalObject(params, 'config'),
      }) as unknown as JsonValue

    case 'application.deleteModelProfile':
      return await runtime.deleteModelProfile({
        modelProfileId: readString(params, 'modelProfileId'),
      }) as unknown as JsonValue

    case 'application.pingModelProfile':
      return await runtime.pingModelProfile({
        modelProfileId: readString(params, 'modelProfileId'),
      }) as unknown as JsonValue

    case 'application.createAgentRuntimeProfile':
      return await runtime.createAgentRuntimeProfile({
        name: readString(params, 'name'),
        purpose: readOptionalString(params, 'purpose'),
        presetId: readOptionalString(params, 'presetId'),
        modelProfileId: readOptionalString(params, 'modelProfileId'),
      }) as unknown as JsonValue

    case 'application.getAgentRuntimeProfile':
      return await runtime.getAgentRuntimeProfile({
        agentRuntimeProfileId: readString(params, 'agentRuntimeProfileId'),
      }) as unknown as JsonValue

    case 'application.listAgentRuntimeProfiles':
      return await runtime.listAgentRuntimeProfiles({
        cursor: readOptionalString(params, 'cursor'),
        limit: readOptionalNumber(params, 'limit'),
      }) as unknown as JsonValue

    case 'application.updateAgentRuntimeProfile':
      return await runtime.updateAgentRuntimeProfile({
        agentRuntimeProfileId: readString(params, 'agentRuntimeProfileId'),
        name: readOptionalString(params, 'name'),
        purpose: readOptionalString(params, 'purpose'),
        presetId: readOptionalString(params, 'presetId'),
        modelProfileId: readOptionalString(params, 'modelProfileId'),
      }) as unknown as JsonValue

    case 'application.deleteAgentRuntimeProfile':
      return await runtime.deleteAgentRuntimeProfile({
        agentRuntimeProfileId: readString(params, 'agentRuntimeProfileId'),
      }) as unknown as JsonValue

    case 'application.createSession':
      return await runtime.createSession({
        cardSourceVersionId: readString(params, 'cardSourceVersionId'),
        cardSnapshot: readOptionalObject(params, 'cardSnapshot'),
        agentRuntimeProfileId: readOptionalString(params, 'agentRuntimeProfileId'),
        title: readOptionalString(params, 'title'),
      }) as unknown as JsonValue

    case 'application.createSessionFromCard':
      return await runtime.createSessionFromCard({
        cardId: readString(params, 'cardId'),
        agentRuntimeProfileId: readOptionalString(params, 'agentRuntimeProfileId'),
        title: readOptionalString(params, 'title'),
      }) as unknown as JsonValue

    case 'application.importWorkspaceArtifact':
      return await runtime.importWorkspaceArtifact({
        artifact: readPromptWorkspaceArtifact(params, 'artifact'),
        workspaceId: readOptionalString(params, 'workspaceId'),
      }) as unknown as JsonValue

    case 'application.getPromptWorkspace':
      return await runtime.getPromptWorkspace({
        workspaceId: readString(params, 'workspaceId'),
      }) as unknown as JsonValue

    case 'application.updatePromptAsset':
      return await runtime.updatePromptAsset({
        workspaceId: readString(params, 'workspaceId'),
        assetId: readString(params, 'assetId'),
        body: readOptionalString(params, 'body'),
        label: readOptionalString(params, 'label'),
        enabled: readOptionalBoolean(params, 'enabled'),
      }) as unknown as JsonValue

    case 'application.updateProjectionOrderProfile':
      return await runtime.updateProjectionOrderProfile({
        workspaceId: readString(params, 'workspaceId'),
        orderNodeId: readString(params, 'orderNodeId'),
        orderList: readOptionalStringArray(params, 'orderList'),
        projectionOrderProfile: readProjectionOrderProfile(params, 'projectionOrderProfile'),
      }) as unknown as JsonValue

    case 'application.exportWorkspaceArtifact':
      return await runtime.exportWorkspaceArtifact({
        workspaceId: readString(params, 'workspaceId'),
      }) as unknown as JsonValue

    case 'application.previewPrompt':
      return await runtime.previewPrompt({
        sessionId: readString(params, 'sessionId'),
        branchId: readOptionalString(params, 'branchId'),
        input: readString(params, 'input'),
        workspaceId: readOptionalString(params, 'workspaceId'),
        projectionOrderProfile: readOptionalProjectionOrderProfile(params, 'projectionOrderProfile'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
      }) as unknown as JsonValue

    case 'application.submitTurn':
      return await runtime.submitTurn({
        sessionId: readString(params, 'sessionId'),
        branchId: readOptionalString(params, 'branchId'),
        agentRuntimeProfileId: readOptionalString(params, 'agentRuntimeProfileId'),
        input: readString(params, 'input'),
        intent: readOptionalTurnIntent(params, 'intent'),
        workspaceId: readOptionalString(params, 'workspaceId'),
        projectionOrderProfile: readOptionalProjectionOrderProfile(params, 'projectionOrderProfile'),
        activationFacts: readOptionalObject(params, 'activationFacts'),
      }) as unknown as JsonValue

    case 'application.getSession':
      return await runtime.getSession({
        sessionId: readString(params, 'sessionId'),
      }) as unknown as JsonValue

    case 'application.getTimeline':
      return await runtime.getTimeline({
        sessionId: readString(params, 'sessionId'),
        branchId: readOptionalString(params, 'branchId'),
      }) as unknown as JsonValue

    case 'application.getAgentTranscript':
      return await runtime.getAgentTranscript({
        sessionId: readString(params, 'sessionId'),
        branchId: readOptionalString(params, 'branchId'),
      }) as unknown as JsonValue

    case 'application.getRun':
      return await runtime.getRun({
        runId: readString(params, 'runId'),
      }) as unknown as JsonValue

    case 'application.forkBranch':
      return await runtime.forkBranch({
        sessionId: readString(params, 'sessionId'),
        fromEntryId: readNullableString(params, 'fromEntryId'),
        title: readOptionalString(params, 'title'),
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

function readPromptWorkspaceArtifact(params: JsonValue | undefined, key: string) {
  if (!isRecord(params) || params[key] === undefined) throw new Error(`Expected workspace artifact param: ${key}`)
  const value = params[key]
  if (!isPromptWorkspaceArtifact(value)) throw new Error(`Expected workspace artifact param: ${key}`)
  return value
}

function readOptionalPreset(params: JsonValue | undefined, key: string): { system?: string } | undefined {
  if (!isRecord(params) || params[key] === undefined) return undefined
  const value = params[key]
  if (!isRecord(value)) throw new Error(`Expected preset param: ${key}`)

  return {
    system: typeof value.system === 'string' ? value.system : undefined,
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

function readOptionalModelCapability(params: JsonValue | undefined, key: string): 'chat.completion' | undefined {
  const value = readOptionalString(params, key)
  if (value === undefined) return undefined
  if (value === 'chat.completion') return value
  throw new Error(`Expected model capability param: ${key}`)
}

function readOptionalTurnIntent(params: JsonValue | undefined, key: string): 'rp' | 'rewrite' | 'continue' | 'modify' | undefined {
  const value = readOptionalString(params, key)
  if (value === undefined) return undefined
  if (value === 'rp' || value === 'rewrite' || value === 'continue' || value === 'modify') return value
  throw new Error(`Expected turn intent param: ${key}`)
}

function readOptionalProjectionOrderProfile(params: JsonValue | undefined, key: string): ProjectionOrderProfile | undefined {
  const value = readOptionalObject(params, key)
  if (value === undefined) return undefined
  return readProjectionOrderProfileValue(value, key)
}

function readProjectionOrderProfile(params: JsonValue | undefined, key: string): ProjectionOrderProfile {
  const value = readOptionalObject(params, key)
  if (value === undefined) throw new Error(`Expected projection order profile param: ${key}`)
  return readProjectionOrderProfileValue(value, key)
}

function readProjectionOrderProfileValue(value: JsonValue, key: string): ProjectionOrderProfile {
  if (!isRecord(value)) throw new Error(`Expected projection order profile object: ${key}`)
  if (typeof value.id !== 'string') throw new Error(`Expected projection order profile id: ${key}.id`)
  if (value.scope !== 'global' && value.scope !== 'session') throw new Error(`Expected projection order profile scope: ${key}.scope`)
  if (!Array.isArray(value.slotRanks)) throw new Error(`Expected projection order profile slotRanks: ${key}.slotRanks`)

  return {
    id: value.id,
    scope: value.scope,
    skeletonPatch: readProjectionSkeletonPatch(value.skeletonPatch, `${key}.skeletonPatch`),
    slotRanks: value.slotRanks.map((item, index) => {
      if (!isRecord(item)) throw new Error(`Expected projection slot rank object: ${key}.slotRanks[${index}]`)
      if (typeof item.injectionGroupKey !== 'string') throw new Error(`Expected projection slot rank injectionGroupKey: ${key}.slotRanks[${index}]`)
      if (typeof item.slotKey !== 'string') throw new Error(`Expected projection slot rank slotKey: ${key}.slotRanks[${index}]`)
      if (typeof item.rankKey !== 'string') throw new Error(`Expected projection slot rank rankKey: ${key}.slotRanks[${index}]`)
      const anchor = readProjectionAnchor(item.anchor, `${key}.slotRanks[${index}].anchor`)

      return {
        injectionGroupKey: item.injectionGroupKey,
        ...(anchor ? { anchor } : {}),
        slotKey: item.slotKey,
        rankKey: item.rankKey,
      }
    }),
  }
}

function readProjectionSkeletonPatch(value: JsonValue | undefined, key: string): ProjectionOrderProfile['skeletonPatch'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`Expected projection skeleton patch object: ${key}`)

  return {
    zones: readProjectionZones(value.zones, `${key}.zones`),
    injectionGroups: readProjectionInjectionGroups(value.injectionGroups, `${key}.injectionGroups`),
    fallbackZoneId: typeof value.fallbackZoneId === 'string' ? value.fallbackZoneId : undefined,
  }
}

function readProjectionZones(value: JsonValue | undefined, key: string): NonNullable<ProjectionOrderProfile['skeletonPatch']>['zones'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected projection zones array: ${key}`)

  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Expected projection zone object: ${key}[${index}]`)
    if (typeof item.id !== 'string') throw new Error(`Expected projection zone id: ${key}[${index}].id`)
    if (typeof item.key !== 'string') throw new Error(`Expected projection zone key: ${key}[${index}].key`)
    if (typeof item.displayName !== 'string') throw new Error(`Expected projection zone displayName: ${key}[${index}].displayName`)
    if (typeof item.orderIndex !== 'number') throw new Error(`Expected projection zone orderIndex: ${key}[${index}].orderIndex`)
    if (!isRecord(item.renderHint)) throw new Error(`Expected projection zone renderHint: ${key}[${index}].renderHint`)

    return {
      id: item.id,
      parentId: typeof item.parentId === 'string' ? item.parentId : null,
      key: item.key,
      displayName: item.displayName,
      band: readProjectionZoneBand(item.band, `${key}[${index}].band`),
      orderIndex: item.orderIndex,
      anchors: readProjectionAnchors(item.anchors, `${key}[${index}].anchors`),
      renderHint: {
        providerRoleHint: readProjectionProviderRole(item.renderHint.providerRoleHint, `${key}[${index}].renderHint.providerRoleHint`),
        wrapper: item.renderHint.wrapper === 'message' ? 'message' : 'section',
      },
    }
  })
}

function readProjectionInjectionGroups(value: JsonValue | undefined, key: string): NonNullable<ProjectionOrderProfile['skeletonPatch']>['injectionGroups'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new Error(`Expected projection injection groups array: ${key}`)

  return value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`Expected projection injection group object: ${key}[${index}]`)
    if (typeof item.key !== 'string') throw new Error(`Expected projection injection group key: ${key}[${index}].key`)
    if (typeof item.displayName !== 'string') throw new Error(`Expected projection injection group displayName: ${key}[${index}].displayName`)
    if (typeof item.targetZoneKey !== 'string') throw new Error(`Expected projection injection group targetZoneKey: ${key}[${index}].targetZoneKey`)
    if (!Array.isArray(item.accepts) || !item.accepts.every(kind => kind === 'preset' || kind === 'settingLayer' || kind === 'narrativeChat' || kind === 'runtime')) {
      throw new Error(`Expected projection injection group accepts: ${key}[${index}].accepts`)
    }

    return {
      key: item.key,
      displayName: item.displayName,
      targetZoneKey: item.targetZoneKey,
      anchor: readRequiredProjectionAnchor(item.anchor, `${key}[${index}].anchor`),
      accepts: item.accepts,
    }
  })
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

function readProjectionProviderRole(value: JsonValue | undefined, label: string): 'system' | 'assistant' | 'user' {
  if (value === 'system' || value === 'assistant' || value === 'user') return value
  throw new Error(`Expected projection provider role: ${label}`)
}

function readProjectionAnchors(value: JsonValue | undefined, label: string): Array<'before' | 'inside' | 'after'> {
  if (!Array.isArray(value)) throw new Error(`Expected projection anchors: ${label}`)
  return value.map((item, index) => readRequiredProjectionAnchor(item, `${label}[${index}]`))
}

function readRequiredProjectionAnchor(value: JsonValue | undefined, label: string): 'before' | 'inside' | 'after' {
  const anchor = readProjectionAnchor(value, label)
  if (!anchor) throw new Error(`Expected projection anchor: ${label}`)
  return anchor
}

function readProjectionAnchor(value: JsonValue | undefined, label: string): 'before' | 'inside' | 'after' | undefined {
  if (value === undefined) return undefined
  if (value === 'before' || value === 'inside' || value === 'after') return value
  throw new Error(`Expected projection anchor: ${label}`)
}
