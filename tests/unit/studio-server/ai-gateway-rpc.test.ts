import {
  createAiGatewayCapabilityRegistry,
  createProfiledAiGateway,
  registerOfficialFakeAiProvider,
} from '@loom-studio/ai-gateway'
import { describe, expect, it } from 'vitest'
import { callAiGatewayRpc } from '../../../apps/studio-server/src/rpc/handlers/ai-gateway-rpc.js'

describe('AI Gateway RPC', () => {
  it('lists registered providers and invokes a capability', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    registerOfficialFakeAiProvider(registry)
    const gateway = createProfiledAiGateway({
      registry,
      resolveProfile: async profileId => ({
        profileId,
        providerProfileId: 'provider-profile-1',
        providerId: 'official.fake',
        capabilityId: 'chat.completions',
        accountConfig: {},
        profileConfig: {},
      }),
    })

    await expect(callAiGatewayRpc({ registry, gateway }, 'ai.providers.list', {})).resolves.toMatchObject({
      providers: [{ id: 'official.fake' }],
    })
    await expect(callAiGatewayRpc({ registry, gateway }, 'ai.invoke', {
      profileId: 'profile-1',
      input: { messages: [{ role: 'user', content: 'rpc' }] },
    })).resolves.toMatchObject({
      profileId: 'profile-1',
      output: { choices: [{ message: { content: 'Agent draft: rpc' } }] },
    })
  })
})
