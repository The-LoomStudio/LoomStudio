import type { AiGatewayCapabilityRegistry, ProfiledAiGateway } from '@loom-studio/ai-gateway'
import type { JsonValue } from '@loom-studio/shared'
import { isRecord, readString } from '../rpc-params.js'

export async function callAiGatewayRpc(
  services: { registry: AiGatewayCapabilityRegistry; gateway: ProfiledAiGateway },
  method: string,
  params: JsonValue | undefined,
): Promise<JsonValue> {
  switch (method) {
    case 'ai.providers.list':
      return { providers: services.registry.list() as unknown as JsonValue }
    case 'ai.invoke': {
      if (!isRecord(params)) throw new Error('Expected AI Gateway invoke params')
      if (params.input === undefined) throw new Error('Expected AI Gateway input')
      return await services.gateway.invoke({
        profileId: readString(params, 'profileId'),
        input: params.input as JsonValue,
        caller: { kind: 'studio-client' },
      }) as unknown as JsonValue
    }
    default:
      throw new Error(`AI Gateway RPC method not found: ${method}`)
  }
}
