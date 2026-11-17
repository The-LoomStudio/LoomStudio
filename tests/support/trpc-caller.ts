import type { JsonValue } from '@loom-studio/shared'
import { studioTrpcRouter } from '../../apps/studio-server/src/rpc/trpc/router.js'
import type { StudioRpcServices } from '../../apps/studio-server/src/rpc/trpc/services-context.js'
type RpcCallContext = {
  clientId: string
  correlationId: string
  callId: string
  parentCallId?: string
  signal?: AbortSignal
}

export type StudioRpcRouter = {
  call(method: string, params: JsonValue | undefined, context: RpcCallContext): Promise<JsonValue>
}
export function createStudioRpcRouter(services: StudioRpcServices): StudioRpcRouter {
  return {
    async call(method, params, context) {
      const caller = studioTrpcRouter.createCaller({
        runtime: services.applicationRuntime, services, convertPromptResource: services.convertPromptResource,
        request: { ...context, abortSignal: context.signal },
      })
      const namespace = method.split('.')[0]!
      const result = ['application', 'official', 'directories', 'settings', 'logs', 'ai', 'system', 'extensions', 'diagnostics', 'resourceDownloads', 'dashboard'].includes(namespace)
        ? await Reflect.get(caller, method)(params)
        : await caller.extensions.invoke({
            packageId: services.extensionHost?.list().find(item => method.startsWith(`${item.packageId}.`))?.packageId ?? namespace,
            method,
            params,
          })
      return JSON.parse(JSON.stringify(result))
    },
  }
}

import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import type { PromptResourceConverter } from '../../apps/studio-server/src/extensions/import-conversion.js'

export async function callApplicationRpc(runtime: ApplicationRuntime, method: string, params: JsonValue | undefined, context?: RuntimeRequestContext, convertPromptResource?: PromptResourceConverter): Promise<JsonValue> {
  const caller = studioTrpcRouter.createCaller({ runtime, request: context ?? {}, convertPromptResource })
  return JSON.parse(JSON.stringify(await Reflect.get(caller, method)(params)))
}
