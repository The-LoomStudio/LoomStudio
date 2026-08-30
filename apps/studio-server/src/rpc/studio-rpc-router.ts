import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { LogReader } from '@loom-studio/logging'
import type { JsonValue } from '@loom-studio/shared'
import { callApplicationRpc } from './handlers/application/index.js'
import { callAiGatewayRpc } from './handlers/ai-gateway-rpc.js'
import { callLogsRpc } from './handlers/logs-rpc.js'
import type { NetworkSettingsStore } from '../platform/network-settings.js'
import { callSettingsRpc } from './handlers/settings-rpc.js'

type RpcCallContext = {
  clientId: string
  correlationId: string
  callId: string
  parentCallId?: string
}

type KernelRpcCaller = {
  callRpc(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue>
}

type StudioRpcRoute = {
  namespace: string
  call(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue> | JsonValue
}

export type StudioRpcRouter = {
  call(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue>
}

export function createStudioRpcRouter(services: {
  applicationRuntime: ApplicationRuntime
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  kernel: KernelRpcCaller
  logs?: LogReader
  networkSettings?: NetworkSettingsStore
  emitEvent?: (name: string, payload: JsonValue, context: RpcCallContext) => void
}): StudioRpcRouter {
  const routes: StudioRpcRoute[] = [{
    namespace: 'application',
    call: async (method, params, context) => {
      if (method !== 'application.deleteCard' || !services.emitEvent) {
        return await callApplicationRpc(services.applicationRuntime, method, params, context)
      }
      const cardId = readRequiredString(params, 'cardId')
      const includePlayData = readOptionalBoolean(params, 'includePlayData') ?? false
      const preview = await services.applicationRuntime.previewCardDeletion({ cardId })
      const result = await callApplicationRpc(services.applicationRuntime, method, params, context)
      const changesetId = readRequiredString(result, 'mutation', 'changesetId')
      services.emitEvent('entity.lifecycle.changed', {
        operation: 'tombstoned',
        root: { kind: 'card', id: cardId },
        affected: {
          timelines: includePlayData ? preview.timelines.length : 0,
          extensionConfigs: preview.extensionData.cardScoped.configs + (includePlayData ? preview.extensionData.timelineScoped.configs : 0),
          extensionRecords: preview.extensionData.cardScoped.records + (includePlayData ? preview.extensionData.timelineScoped.records : 0),
        },
        changesetId,
      }, context)
      return result
    },
  }]

  if (services.aiCapabilities && services.aiGateway) {
    routes.push({
      namespace: 'ai',
      call: (method, params) => callAiGatewayRpc({
        registry: services.aiCapabilities!,
        gateway: services.aiGateway!,
      }, method, params),
    })
  }

  if (services.networkSettings) {
    routes.push({
      namespace: 'settings',
      call: (method, params) => callSettingsRpc(services.networkSettings!, method, params),
    })
  }

  if (services.logs) {
    routes.push({
      namespace: 'logs',
      call: (method, params) => callLogsRpc(services.logs!, method, params),
    })
  }

  return {
    call: async (method, params, context) => {
      const route = routes.find(item => item.namespace === readRpcNamespace(method))
      if (route) return await route.call(method, params, context)
      return await services.kernel.callRpc(method, params, context)
    },
  }
}

function readRpcNamespace(method: string): string {
  const separatorIndex = method.indexOf('.')
  return separatorIndex < 0 ? method : method.slice(0, separatorIndex)
}

function readOptionalBoolean(value: JsonValue | undefined, key: string): boolean | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value[key]
  return typeof item === 'boolean' ? item : undefined
}

function readRequiredString(value: JsonValue | undefined, key: string, nestedKey?: string): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`RPC parameter must be an object: ${key}`)
  const item = value[key]
  if (nestedKey) return readRequiredString(item, nestedKey)
  if (typeof item !== 'string' || !item) throw new Error(`RPC string is required: ${key}`)
  return item
}
