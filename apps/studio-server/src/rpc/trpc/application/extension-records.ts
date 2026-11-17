import type {
  ApplicationRuntime
} from '@loom-studio/application-runtime'
import type { ExtensionEntityRef, ExtensionStorageScope } from '@loom-studio/kernel/extension-host'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalInstallationTarget as readInstallationTarget,
  readOptionalNumber,
  readOptionalString,
  readString,
} from '../../rpc-params.js'
import { jsonInput, procedure } from '../context.js'

export const extensionRecordsProcedures = {
  'listExtensionRecords': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listExtensionRecords']>[0] => {
    return {
      target: readInstallationTarget(params),
      packageId: readString(params, 'packageId'),
      scope: readOptionalExtensionStorageScope(params, 'scope'),
      recordType: readOptionalString(params, 'recordType'),
      binding: readOptionalExtensionEntityRef(params, 'binding'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listExtensionRecords(input)),
  'getExtensionRecord': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getExtensionRecord']>[0] => {
    return {
      target: readInstallationTarget(params),
      packageId: readString(params, 'packageId'),
      recordId: readString(params, 'recordId'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getExtensionRecord(input)),
  'listExtensionConfigs': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['listExtensionConfigs']>[0] => {
    return {
      target: readInstallationTarget(params),
      packageId: readString(params, 'packageId'),
      scope: readOptionalExtensionStorageScope(params, 'scope'),
    }
  })).query(({ ctx, input }) => ctx.runtime.listExtensionConfigs(input)),
  'getExtensionConfig': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['getExtensionConfig']>[0] => {
    return {
      target: readInstallationTarget(params),
      packageId: readString(params, 'packageId'),
      scope: readRequiredExtensionStorageScope(params, 'scope'),
      key: readString(params, 'key'),
    }
  })).query(({ ctx, input }) => ctx.runtime.getExtensionConfig(input)),
  'upsertExtensionConfig': procedure.input(jsonInput((params: JsonValue | undefined): Parameters<ApplicationRuntime['upsertExtensionConfig']>[0] => {
    if (!isRecord(params) || !Object.hasOwn(params, 'value')) throw new Error('Expected Extension Config value')
    return {
      target: readInstallationTarget(params),
      packageId: readString(params, 'packageId'),
      scope: readRequiredExtensionStorageScope(params, 'scope'),
      key: readString(params, 'key'),
      value: params.value,
      expectedVersion: readOptionalNumber(params, 'expectedVersion'),
    }
  })).mutation(({ ctx, input }) => ctx.runtime.upsertExtensionConfig(input, ctx.request)),
}

function readRequiredExtensionStorageScope(value: JsonValue | undefined, key: string): ExtensionStorageScope {
  const scope = readOptionalExtensionStorageScope(value, key)
  if (!scope) throw new Error(`Expected Extension Storage scope: ${key}`)
  return scope
}

function readOptionalExtensionStorageScope(value: JsonValue | undefined, key: string): ExtensionStorageScope | undefined {
  if (!isRecord(value) || value[key] === undefined) return undefined
  const scope = value[key]
  if (!isRecord(scope)) throw new Error(`Expected Extension Storage scope object: ${key}`)
  if (scope.kind === 'global') return { kind: 'global' }
  if (scope.kind === 'card' && typeof scope.cardId === 'string' && scope.cardId) {
    return { kind: 'card', cardId: scope.cardId }
  }
  if (scope.kind === 'timeline' && typeof scope.timelineId === 'string' && scope.timelineId) {
    return { kind: 'timeline', timelineId: scope.timelineId }
  }
  if (scope.kind === 'agent-session' && typeof scope.agentSessionId === 'string' && scope.agentSessionId) {
    return { kind: 'agent-session', agentSessionId: scope.agentSessionId }
  }
  throw new Error(`Expected Extension Storage scope: ${key}`)
}

function readOptionalExtensionEntityRef(value: JsonValue | undefined, key: string): ExtensionEntityRef | undefined {
  if (!isRecord(value) || value[key] === undefined) return undefined
  const ref = value[key]
  if (!isRecord(ref)) throw new Error(`Expected Extension Entity reference object: ${key}`)
  if (ref.kind === 'narrative-node' && typeof ref.timelineId === 'string' && ref.timelineId && typeof ref.nodeId === 'string' && ref.nodeId) {
    return { kind: 'narrative-node', timelineId: ref.timelineId, nodeId: ref.nodeId }
  }
  if (ref.kind === 'agent-message' && typeof ref.agentSessionId === 'string' && ref.agentSessionId && typeof ref.messageId === 'string' && ref.messageId) {
    return { kind: 'agent-message', agentSessionId: ref.agentSessionId, messageId: ref.messageId }
  }
  if (ref.kind === 'asset' && typeof ref.assetId === 'string' && ref.assetId) {
    return { kind: 'asset', assetId: ref.assetId }
  }
  if (ref.kind === 'state-path' && typeof ref.timelineId === 'string' && ref.timelineId && typeof ref.path === 'string' && ref.path) {
    return { kind: 'state-path', timelineId: ref.timelineId, path: ref.path }
  }
  throw new Error(`Expected Extension Entity reference: ${key}`)
}
