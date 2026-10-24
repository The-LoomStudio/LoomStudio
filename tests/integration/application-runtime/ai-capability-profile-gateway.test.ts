import {
  createAiGatewayCapabilityRegistry,
  createOfficialProviderAdapterRegistry,
  type AiGatewayProviderRegistration,
} from '@loom-studio/ai-gateway'
import {
  createApplicationRuntime,
  createObservationStore,
  createDocumentBackedProfiledAiGateway,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createMemorySecretBackend, createSecretStore } from '../../../packages/secret-store/src/index.js'
import { describe, expect, it, vi } from 'vitest'

describe('AI Capability Profile Gateway', () => {
  it('isolates prepared evidence from credentials and callback failure', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    const registration = providerRegistration()
    registration.provider.capabilities[0]!.inputFields!.push({ key: 'limit', label: 'Limit', type: 'number', defaultValue: 3 })
    registry.register(registration, { kind: 'platform' })
    let captured: unknown
    await expect(registry.invokeRegistered({
      providerId: 'example.gateway.rerank', capabilityId: 'text.rerank',
      accountConfig: { endpoint: 'https://rerank.test' }, credential: { apiKey: 'super-secret-value' },
      profileConfig: { model: 'rerank-v1' }, input: { query: 'loom' },
      onPrepared: evidence => { captured = evidence; throw new Error('observer failed') },
    })).resolves.toMatchObject({ output: { query: 'loom', authorized: true } })
    expect(captured).toMatchObject({ input: { query: 'loom', limit: 3 }, profileConfig: { model: 'rerank-v1' } })
    expect(JSON.stringify(captured)).not.toContain('secret-value')
    expect(JSON.stringify(captured)).not.toContain('credential')
  })

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
    const observations = createObservationStore()
    const gateway = createDocumentBackedProfiledAiGateway({ documents, registry, secrets, observations })

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

    const recorded = observations.list({ kind: 'api' }).records[0]!
    expect(observations.get(recorded.id)).toMatchObject({ status: 'completed', request: {
      phase: 'completed', capability: { profileId: created.profile.id, providerId: 'example.gateway.rerank', capabilityId: 'text.rerank' },
      input: { query: 'loom' }, configuration: { model: 'rerank-v1' }, providerCallId: expect.any(String),
    } })
    expect(JSON.stringify(observations.get(recorded.id))).not.toContain('super-secret-value')
    expect(JSON.stringify(observations.get(recorded.id))).not.toContain('credential')
    const run = gateway.createRun({ profileId: created.profile.id, input: { query: 'run' } })
    await expect(run.result).resolves.toMatchObject({ output: { query: 'run' } })
    expect(observations.list({ kind: 'api' }).records).toHaveLength(2)

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

    await expect(runtime.deleteProviderProfile({ providerProfileId: account.providerProfile.id }))
      .resolves.toMatchObject({ deleted: true })
    await expect(runtime.getAiCapabilityProfile({ profileId: created.profile.id }))
      .resolves.toMatchObject({ profile: {
        providerProfileId: account.providerProfile.id,
        providerExtensionId: 'example.gateway.rerank',
        config: { model: 'rerank-v1' },
        available: false,
        unavailableReason: 'provider-profile-missing',
      } })
    await expect(runtime.listAiCapabilityProfiles())
      .resolves.toMatchObject({ profiles: [expect.objectContaining({ id: created.profile.id, available: false })] })
    await expect(gateway.invoke({ profileId: created.profile.id, input: { query: 'after delete' } }))
      .rejects.toThrow(account.providerProfile.id)
    await expect(runtime.updateAiCapabilityProfile({ profileId: created.profile.id, displayName: 'Needs repair' }))
      .resolves.toMatchObject({ profile: { displayName: 'Needs repair', available: false } })

    const healthyAccount = await runtime.createProviderProfile({
      providerExtensionId: 'example.gateway.rerank', displayName: 'Rerank Account',
      config: { endpoint: 'https://rerank.test' },
      credential: { apiKey: 'replacement-test-value' },
    })
    const healthyProfile = await runtime.createAiCapabilityProfile({
      providerProfileId: healthyAccount.providerProfile.id, capabilityId: 'text.rerank',
      displayName: 'Healthy profile', config: { model: 'rerank-v1' },
    })
    expect((await runtime.listAiCapabilityProfiles()).profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.profile.id, available: false }),
      expect.objectContaining({ id: healthyProfile.profile.id, available: true }),
    ]))
    const stored = (await documents.get(created.profile.id))!
    await documents.write({
      id: stored.id, type: stored.type, expectedVersion: stored.version,
      content: { ...(stored.content as Record<string, never>), providerProfileId: 'missing-provider' },
    })
    const missing = (await runtime.getAiCapabilityProfile({ profileId: created.profile.id })).profile
    expect(missing).toMatchObject({ providerProfileId: 'missing-provider', unavailableReason: 'provider-profile-missing', available: false })
    expect(missing.providerExtensionId).toBeUndefined()
    expect((await runtime.listAiCapabilityProfiles()).profiles).toHaveLength(2)
    await expect(runtime.updateAiCapabilityProfile({ profileId: created.profile.id, providerProfileId: 'still-missing' }))
      .rejects.toThrow('still-missing')
    expect((await runtime.getAiCapabilityProfile({ profileId: created.profile.id })).profile).toEqual(missing)
    await expect(runtime.updateAiCapabilityProfile({
      profileId: created.profile.id, providerProfileId: healthyAccount.providerProfile.id,
    })).resolves.toMatchObject({ profile: {
      providerProfileId: healthyAccount.providerProfile.id,
      config: { model: 'rerank-v1' }, available: true,
    } })
    await expect(gateway.invoke({ profileId: created.profile.id, input: { query: 'rebound' } }))
      .resolves.toMatchObject({ output: { query: 'rebound', model: 'rerank-v1' } })

    const write = documents.write.bind(documents)
    const pendingCreate = vi.spyOn(documents, 'write').mockImplementationOnce(async input => {
      await runtime.deleteProviderProfile({ providerProfileId: healthyAccount.providerProfile.id })
      return await write(input)
    })
    try {
      await expect(runtime.createAiCapabilityProfile({
        providerProfileId: healthyAccount.providerProfile.id, capabilityId: 'text.rerank',
        displayName: 'Created during deletion', config: { model: 'rerank-v1' },
      })).resolves.toMatchObject({ profile: { available: false, unavailableReason: 'provider-profile-missing' } })
    } finally {
      pendingCreate.mockRestore()
    }

    registration.dispose()
    observations.dispose()
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
