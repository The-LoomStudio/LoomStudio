import { createOfficialProviderAdapterRegistry } from '../../../packages/ai-gateway/src/index.js'
import { describe, expect, it } from 'vitest'

describe('official provider adapter registry', () => {
  it.each([
    ['official.openai', 'openai'],
    ['official.anthropic', 'anthropic'],
    ['official.google', 'google'],
    ['official.openai-compatible', 'openai-compatible'],
  ] as const)('routes %s to the %s provider kind', (providerExtensionId, kind) => {
    const resolved = createOfficialProviderAdapterRegistry().resolve(providerExtensionId, {
      config: {},
      credential: { apiKey: 'account-key' },
    })
    expect(resolved).toMatchObject({ provider: { kind, apiKey: 'account-key' }, capability: { streaming: true } })
  })

  it('validates provider-owned account and credential schemas', () => {
    const registry = createOfficialProviderAdapterRegistry()
    expect(() => registry.validateAccountConfig('official.openai', { unknown: true })).toThrow()
    expect(() => registry.validateAccountConfig('official.openai', { baseUrl: 'not-a-url' })).toThrow()
    expect(() => registry.validateCredential('official.anthropic', { apiKey: '' })).toThrow()
    expect(registry.getSchemas('official.google')).toMatchObject({
      accountConfig: { additionalProperties: false },
      credential: { required: ['apiKey'], additionalProperties: false },
    })
  })

  it('uses one adapter for multiple provider accounts without sharing credentials', () => {
    const registry = createOfficialProviderAdapterRegistry()
    const first = registry.resolve('openai-compatible', {
      config: { baseUrl: 'https://first.test/v1' },
      credential: { apiKey: 'first-key' },
    })
    const second = registry.resolve('official.openai-compatible', {
      config: { baseUrl: 'https://second.test/v1' },
      credential: { apiKey: 'second-key' },
    })
    expect(first.adapterId).toBe(second.adapterId)
    expect(first.provider).toMatchObject({ baseUrl: 'https://first.test/v1', apiKey: 'first-key' })
    expect(second.provider).toMatchObject({ baseUrl: 'https://second.test/v1', apiKey: 'second-key' })
  })

  it('keeps fake as a credential-free built-in adapter', () => {
    expect(createOfficialProviderAdapterRegistry().resolve('fake', { config: {} })).toMatchObject({
      provider: { kind: 'fake' },
      capability: { streaming: false },
    })
  })
})
