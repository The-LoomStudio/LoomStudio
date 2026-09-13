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

  it('creates, subscribes to, and cancels an in-memory run', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    registry.register({
      provider: {
        id: 'test.provider',
        displayName: 'Test',
        capabilities: [{ id: 'test', displayName: 'Test' }],
      },
      handlers: {
        test: ({ signal }) => new Promise(resolve => {
          signal?.addEventListener('abort', () => resolve({ cancelled: true }), { once: true })
        }),
      },
    }, { kind: 'platform' })
    const gateway = createProfiledAiGateway({
      registry,
      resolveProfile: async profileId => ({
        profileId,
        providerProfileId: 'provider-profile-1',
        providerId: 'test.provider',
        capabilityId: 'test',
        accountConfig: {},
        profileConfig: {},
      }),
    })
    const services = { registry, gateway }
    const created = await callAiGatewayRpc(services, 'ai.run.create', { profileId: 'profile-1', input: {} }) as { runId: string }
    await expect(callAiGatewayRpc(services, 'ai.run.state', { runId: created.runId })).resolves.toMatchObject({ state: 'running' })
    await expect(callAiGatewayRpc(services, 'ai.run.cancel', { runId: created.runId, reason: 'user-stop' })).resolves.toMatchObject({ runId: created.runId })
    await expect(callAiGatewayRpc(services, 'ai.run.subscribe', { runId: created.runId })).resolves.toMatchObject({
      events: [
        { type: 'started' },
        { type: 'cancelled', reason: 'user-stop' },
      ],
      state: 'cancelled',
    })
  })
})
