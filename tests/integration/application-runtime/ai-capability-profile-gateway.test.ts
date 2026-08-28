import {
  createAiGatewayCapabilityRegistry,
  createOfficialProviderAdapterRegistry,
  type AiGatewayProviderRegistration,
} from '@loom-studio/ai-gateway'
import {
  createApplicationRuntime,
  createDocumentBackedProfiledAiGateway,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createMemorySecretBackend, createSecretStore } from '../../../packages/secret-store/src/index.js'
import { describe, expect, it } from 'vitest'

describe('AI Capability Profile Gateway', () => {
  it('persists profiles, resolves secrets only inside the gateway, and survives provider remounts', async () => {
    let nextId = 0
    const engine = createSqliteDataEngine({
      filename: ':memory:',
      createId: prefix => `${prefix}-${++nextId}`,
      now: () => '2026-08-28T00:00:00.000Z',
    })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine })
    const secrets = createSecretStore({
      engine,
      backend: createMemorySecretBackend(),
      createId: prefix => `${prefix}-${++nextId}`,
      now: () => '2026-08-28T00:00:00.000Z',
      authorizeUse: (_metadata, context) => context.caller === 'application.ai-gateway',
    })
    const registry = createAiGatewayCapabilityRegistry()
    let registration = registry.register(providerRegistration(), { kind: 'platform' })
    const runtime = createApplicationRuntime({
      dataEngine: engine,
      documents,
      promptResources,
      secrets,
      aiCapabilities: registry,
      providerAdapters: createOfficialProviderAdapterRegistry({ aiCapabilities: registry }),
    })
    const gateway = createDocumentBackedProfiledAiGateway({ documents, registry, secrets })

    const account = await runtime.createProviderProfile({
      providerExtensionId: 'example.gateway.rerank',
      displayName: 'Rerank Account',
      config: { endpoint: 'https://rerank.test' },
      credential: { apiKey: 'super-secret-value' },
    })
    const created = await runtime.createAiCapabilityProfile({
      providerProfileId: account.providerProfile.id,
      capabilityId: 'text.rerank',
      displayName: 'Default Rerank',
      config: { model: 'rerank-v1' },
    })

    expect(account.providerProfile).toMatchObject({
      credential: { configured: true },
    })
    expect(JSON.stringify(account.providerProfile)).not.toContain('super-secret-value')
    expect(created.profile).toMatchObject({
      providerExtensionId: 'example.gateway.rerank',
      capabilityId: 'text.rerank',
      available: true,
    })
    await expect(runtime.deleteProviderProfile({
      providerProfileId: account.providerProfile.id,
    })).rejects.toThrow('AI Capability Profile')

    await expect(gateway.invoke({
      profileId: created.profile.id,
      input: { query: 'loom' },
    })).resolves.toMatchObject({
      profileId: created.profile.id,
      output: {
        endpoint: 'https://rerank.test',
        model: 'rerank-v1',
        query: 'loom',
        authorized: true,
      },
    })

    registration.dispose()
    await expect(runtime.getAiCapabilityProfile({ profileId: created.profile.id }))
      .resolves.toMatchObject({ profile: { available: false } })
    await expect(gateway.invoke({
      profileId: created.profile.id,
      input: { query: 'loom' },
    })).rejects.toThrow('provider is not available')

    registration = registry.register(providerRegistration(), { kind: 'platform' })
    await expect(runtime.getAiCapabilityProfile({ profileId: created.profile.id }))
      .resolves.toMatchObject({ profile: { available: true } })
    await expect(gateway.invoke({
      profileId: created.profile.id,
      input: { query: 'again' },
    })).resolves.toMatchObject({ output: { query: 'again', authorized: true } })

    registration.dispose()
    engine.close()
  })
})

function providerRegistration(): AiGatewayProviderRegistration {
  return {
    provider: {
      id: 'example.gateway.rerank',
      displayName: 'Example Rerank',
      accountFields: [{ key: 'endpoint', label: 'Endpoint', type: 'string', required: true }],
      credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'secret', required: true }],
      capabilities: [{
        id: 'text.rerank',
        displayName: 'Text Rerank',
        profileFields: [{ key: 'model', label: 'Model', type: 'string', required: true }],
        inputFields: [{ key: 'query', label: 'Query', type: 'string', required: true }],
      }],
    },
    handlers: {
      'text.rerank': ({ accountConfig, credential, profileConfig, input }) => ({
        endpoint: accountConfig.endpoint,
        model: profileConfig.model,
        query: (input as { query: string }).query,
        authorized: credential.apiKey === 'super-secret-value',
      }),
    },
  }
}
