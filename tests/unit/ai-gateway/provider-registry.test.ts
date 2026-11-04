import { createOfficialProviderAdapterRegistry } from '../../../packages/ai-gateway/src/index.js'
import { describe, expect, it } from 'vitest'

describe('official provider adapter registry', () => {
  it('discovers models with parsed credentials and rejects invalid configuration before transport', async () => {
    const requests: Array<{ url: string; authorization: string | null }> = []
    const transport = (async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') })
      return Response.json({ data: [{ id: ' model-a ' }, { id: 'model-a' }] })
    }) as typeof fetch
    const registry = createOfficialProviderAdapterRegistry()
    await expect(registry.listModels('official.openai-compatible', {
      config: { baseUrl: 'https://example.test/v1' }, credential: { apiKey: ' key ' }, fetch: transport,
    })).resolves.toEqual(['model-a'])
    expect(requests).toEqual([{ url: 'https://example.test/v1/models', authorization: 'Bearer key' }])
    await expect(registry.listModels('official.openai-compatible', {
      config: { baseUrl: 'not-a-url' }, credential: { apiKey: 'key' }, fetch: transport,
    })).rejects.toThrow()
    await expect(registry.listModels('official.openai-compatible', {
      config: {}, credential: { apiKey: ' ' }, fetch: transport,
    })).rejects.toThrow()
    expect(requests).toHaveLength(1)
  })

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
    expect(() => createOfficialProviderAdapterRegistry().resolve(kind, { config: {}, credential: { apiKey: 'account-key' } })).toThrow('Unsupported provider extension')
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
    const first = registry.resolve('official.openai-compatible', {
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
    const registry = createOfficialProviderAdapterRegistry()
    expect(registry.resolve('official.fake', { config: {} })).toMatchObject({
      provider: { kind: 'fake' },
      capability: { streaming: false },
    })
    expect(registry.validateAccountConfig('official.fake', {})).toEqual({})
    expect(registry.validateAccountConfig('official.fake', {
      responseTemplate: 'obsolete',
      baseUrl: 'https://obsolete.test',
    })).toEqual({})
    expect(registry.getSchemas('official.fake')).toMatchObject({
      accountConfig: { properties: {} },
      credential: { properties: {} },
    })
  })
})
