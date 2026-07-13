import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { callApplicationRpc, listApplicationRpcCapabilities } from './application-rpc.js'
import { listRendererPocRpcCapabilities, type RendererPocService } from './renderer-poc.js'
import type { RpcCapability } from './rpc-capability.js'

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
  capabilities: RpcCapability[]
  call(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue> | JsonValue
}

export type StudioRpcRouter = {
  capabilities(): RpcCapability[]
  call(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue>
}

export function createStudioRpcRouter(services: {
  applicationRuntime: ApplicationRuntime
  kernel: KernelRpcCaller
  rendererPoc: RendererPocService
}): StudioRpcRouter {
  const routes: StudioRpcRoute[] = []
  const listCapabilities = (): RpcCapability[] => routes.flatMap(route => route.capabilities)

  routes.push(
    {
      namespace: 'studio',
      capabilities: [{
        name: 'studio.rpc.listCapabilities',
        namespace: 'studio',
        owner: 'studio-server',
        stability: 'experimental',
      }],
      call: method => {
        if (method !== 'studio.rpc.listCapabilities') {
          throw new Error(`Studio RPC method not found: ${method}`)
        }

        return { capabilities: listCapabilities() as unknown as JsonValue }
      },
    },
    {
      namespace: 'application',
      capabilities: listApplicationRpcCapabilities(),
      call: (method, params, context) => callApplicationRpc(services.applicationRuntime, method, params, context),
    },
    {
      namespace: 'renderer',
      capabilities: listRendererPocRpcCapabilities(),
      call: (method, params) => services.rendererPoc.call(method, params),
    },
  )

  return {
    capabilities: listCapabilities,
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
