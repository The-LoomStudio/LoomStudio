import {
  createAiGatewayCapabilityRegistry,
  createProfiledAiGateway,
  registerOfficialFakeAiProvider,
} from '@loom-studio/ai-gateway'
import { describe, expect, it } from 'vitest'

describe('AI Gateway capability registry', () => {
  it('registers, invokes, and disposes a provider capability', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    const handle = registry.register({
      provider: {
        id: 'example.embedding',
        displayName: 'Example Embedding',
        capabilities: [{
          id: 'text.embedding',
          displayName: 'Embedding',
          inputFields: [{ key: 'text', label: 'Text', type: 'string', required: true }],
        }],
      },
      handlers: {
        'text.embedding': ({ input }) => ({ vector: [(input as { text: string }).text.length] }),
      },
    }, { kind: 'platform' })

    expect(registry.list().map(provider => provider.id)).toEqual(['example.embedding'])
    await expect(registry.invokeRegistered({
      providerId: 'example.embedding',
      capabilityId: 'text.embedding',
      accountConfig: {},
      profileConfig: {},
      input: { text: 'loom' },
    })).resolves.toMatchObject({
      providerId: 'example.embedding',
      capabilityId: 'text.embedding',
      output: { vector: [4] },
    })

    handle.dispose()
    expect(registry.list()).toEqual([])
  })

  it('provides a deterministic official fake provider', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    registerOfficialFakeAiProvider(registry)

    await expect(registry.invokeRegistered({
      providerId: 'official.fake',
      capabilityId: 'chat.completions',
      accountConfig: {},
      profileConfig: {},
      input: { messages: [{ role: 'user', content: 'hello' }] },
    })).resolves.toMatchObject({
      output: {
        object: 'chat.completion',
        model: 'fake-echo-m0',
        choices: [{ message: { role: 'assistant', content: 'Agent draft: hello' } }],
      },
    })
  })

  it('resolves profiles and credentials before invoking a registered provider', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    registry.register({
      provider: {
        id: 'example.rerank',
        displayName: 'Example Rerank',
        accountFields: [{ key: 'baseUrl', label: 'Base URL', type: 'string', required: true }],
        credentialFields: [{ key: 'apiKey', label: 'API key', type: 'secret', required: true }],
        capabilities: [{
          id: 'text.rerank',
          displayName: 'Rerank',
          profileFields: [{ key: 'model', label: 'Model', type: 'string', required: true }],
          inputFields: [{ key: 'query', label: 'Query', type: 'string', required: true }],
        }],
      },
      handlers: {
        'text.rerank': ({ accountConfig, credential, profileConfig, input }) => ({
          endpoint: accountConfig.baseUrl,
          authorized: credential.apiKey === 'secret-value',
          model: profileConfig.model,
          query: (input as { query: string }).query,
        }),
      },
    }, { kind: 'platform' })
    const gateway = createProfiledAiGateway({
      registry,
      resolveProfile: async profileId => ({
        profileId,
        providerProfileId: 'provider-profile-1',
        providerId: 'example.rerank',
        capabilityId: 'text.rerank',
        accountConfig: { baseUrl: 'https://rerank.test' },
        profileConfig: { model: 'rerank-v1' },
      }),
      credentials: {
        withCredential: async (_profile, operation) => await operation({ apiKey: 'secret-value' }),
      },
    })

    await expect(gateway.invoke({
      profileId: 'capability-profile-1',
      input: { query: 'loom' },
    })).resolves.toMatchObject({
      profileId: 'capability-profile-1',
      output: {
        endpoint: 'https://rerank.test',
        authorized: true,
        model: 'rerank-v1',
        query: 'loom',
      },
    })
  })
})
