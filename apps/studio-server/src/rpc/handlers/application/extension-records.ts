import type {
  ApplicationRuntime,
} from '@loom-studio/application-runtime'
import type { ExtensionEntityRef, ExtensionStorageScope } from '@loom-studio/extension-host'
import type { JsonValue } from '@loom-studio/shared'
import {
  isRecord,
  readOptionalString,
  readString,
} from '../../rpc-params.js'

export async function handleExtensionRecordsRpc(
  runtime: ApplicationRuntime,
  method: string,
  params: JsonValue | undefined,
): Promise<JsonValue | undefined> {
  switch (method) {
    case 'application.listExtensionRecords':
      return await runtime.listExtensionRecords({
        packageId: readString(params, 'packageId'),
        scope: readOptionalExtensionStorageScope(params, 'scope'),
        recordType: readOptionalString(params, 'recordType'),
        binding: readOptionalExtensionEntityRef(params, 'binding'),
      }) as unknown as JsonValue

    case 'application.getExtensionRecord':
      return await runtime.getExtensionRecord({
        packageId: readString(params, 'packageId'),
        recordId: readString(params, 'recordId'),
      }) as unknown as JsonValue

    default:
      return undefined
  }
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
