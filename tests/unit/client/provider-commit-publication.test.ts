import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useProviderSettings } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { ProviderAccount, AiCapabilityProfile, RegisteredAiGatewayProvider } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (current: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current }
    return hooks.values[index]
  },
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = [] })
afterEach(() => vi.restoreAllMocks())

function fixture() {
  const original: ProviderAccount = {
    id: 'provider', version: 1, providerExtensionId: 'official.openai-compatible',
    displayName: 'Original', config: {}, enabledModelIds: ['old-model'],
    credential: { configured: false }, createdAt: '2026-09-23', updatedAt: '2026-09-23',
  }
  const saved = { ...original, version: 2, displayName: 'Saved', enabledModelIds: ['new-model'] }
  const capability: AiCapabilityProfile = {
    id: 'capability', version: 2, providerProfileId: original.id, capabilityId: 'chat',
    displayName: 'Saved', config: {}, available: true, createdAt: original.createdAt, updatedAt: original.updatedAt,
  }
  const failure = new Error('Refresh failed')
  const list = vi.fn().mockResolvedValue({ providerProfiles: [original] })
  const credential = vi.fn().mockResolvedValue({ credential: { configured: true } })
  const api = {
    providerAccounts: {
      list, create: vi.fn().mockResolvedValue({ providerProfile: saved }),
      update: vi.fn().mockResolvedValue({ providerProfile: saved }),
      delete: vi.fn().mockResolvedValue({ deleted: true }), replaceCredential: credential,
    },
    aiCapabilityProfiles: {
      create: vi.fn().mockResolvedValue({ profile: capability }),
      update: vi.fn().mockResolvedValue({ profile: capability }),
      list: vi.fn().mockRejectedValue(failure),
    },
    aiGateway: { listProviders: vi.fn<() => Promise<RegisteredAiGatewayProvider[]>>().mockResolvedValue([]) },
  }
  const render = () => {
    hooks.cursor = 0
    return useProviderSettings({
      api: api as unknown as StudioApi, runAction: action => action(),
      initialProviderAccountDraft: { displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: '' },
    })
  }
  return { render, list, credential, api, failure, saved, capability }
}

describe('Provider committed result publication', () => {
  it.each([false, true])('keeps the current provider catalog when an older refresh finishes (latest fails: %s)', async latestFails => {
    const f = fixture()
    const initial: RegisteredAiGatewayProvider[] = [{
      id: 'current', displayName: 'Current', capabilities: [], registeredBy: { kind: 'platform' },
    }]
    f.api.aiGateway.listProviders.mockResolvedValueOnce(initial)
    await f.render().refreshAiProviders()
    const pending = Promise.withResolvers<RegisteredAiGatewayProvider[]>()
    f.api.aiGateway.listProviders.mockReturnValueOnce(pending.promise)
    const old = f.render().refreshAiProviders()
    if (latestFails) {
      f.api.aiGateway.listProviders.mockRejectedValueOnce(f.failure)
      await expect(f.render().refreshAiProviders()).rejects.toBe(f.failure)
    } else {
      await f.render().refreshAiProviders()
    }
    pending.resolve([{ ...initial[0], id: 'stale' }])
    await old
    expect(f.render().aiProviders).toEqual(latestFails ? initial : [])
    expect(f.api.aiGateway.listProviders).toHaveBeenCalledTimes(3)
  })

  it.each(['provider', 'capability'] as const)('does not replace a newer %s refresh with an older response', async kind => {
    const f = fixture()
    const pending = Promise.withResolvers<void>()
    if (kind === 'provider') {
      f.list.mockImplementationOnce(async () => { await pending.promise; return { providerProfiles: [] } })
      f.list.mockResolvedValue({ providerProfiles: [f.saved] })
      f.api.aiCapabilityProfiles.list.mockResolvedValue({ profiles: [] })
    } else {
      f.api.aiCapabilityProfiles.list.mockImplementationOnce(async () => { await pending.promise; return { profiles: [] } })
      f.api.aiCapabilityProfiles.list.mockResolvedValue({ profiles: [f.capability] })
    }
    const old = f.render().refreshProviderSettings()
    await f.render().refreshProviderSettings()
    pending.resolve()
    await old
    expect(kind === 'provider' ? f.render().providerAccounts : f.render().aiCapabilityProfiles)
      .toEqual([kind === 'provider' ? f.saved : f.capability])
  })

  it('rereads a list started before a committed configuration change even when credentials fail', async () => {
    const f = fixture()
    await f.render().refreshProviderAccounts()
    const old = f.render().providerAccounts
    const pending = Promise.withResolvers<void>()
    f.list.mockImplementationOnce(async () => { await pending.promise; return { providerProfiles: old } })
    f.list.mockResolvedValue({ providerProfiles: [f.saved] })
    const stale = f.render().refreshProviderAccounts()
    f.credential.mockRejectedValue(f.failure)
    await expect(f.render().updateProviderConnection('provider', {
      displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    })).rejects.toBe(f.failure)
    pending.resolve()
    await stale
    expect(f.render().providerAccounts).toEqual([f.saved])
    expect(f.list).toHaveBeenCalledTimes(3)
  })

  it.each(['create-form', 'create', 'update', 'connection', 'ai-update', 'add-model', 'edit-model', 'delete-model', 'delete'] as const)(
    'retains the committed %s result when the follow-up list fails',
    async operation => {
      const f = fixture()
      await f.render().refreshProviderAccounts()
      f.list.mockRejectedValue(f.failure)
      // Adding a model reads the current provider before committing.
      if (operation === 'add-model') f.list.mockResolvedValueOnce({ providerProfiles: [{ ...f.saved, enabledModelIds: ['old-model'] }] })
      const settings = f.render()
      const actions = {
        'create-form': () => settings.createProviderAccount({ preventDefault() {} } as FormEvent),
        create: () => settings.createAiProviderAccount({ providerExtensionId: 'provider', displayName: 'Saved', config: {} }),
        update: () => settings.updateProviderAccount('provider', { displayName: 'Saved' }),
        connection: () => settings.updateProviderConnection('provider', { displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: 'secret' }),
        'ai-update': () => settings.updateAiProviderAccount({ providerProfileId: 'provider', displayName: 'Saved', config: {}, credential: { apiKey: 'secret' } }),
        'add-model': () => settings.createModelProfile('provider', 'new-model'),
        'edit-model': () => settings.updateModelProfile('provider:old-model', { providerModelId: 'new-model' }),
        'delete-model': () => settings.deleteModelProfile('provider:old-model'),
        delete: () => settings.deleteProviderAccount('provider'),
      }
      const pending = actions[operation]()
      if (operation === 'create') await expect(pending).resolves.toBe('provider')
      else await expect(pending).rejects.toBe(f.failure)
      const current = f.render()
      expect(current.providerAccounts).toEqual(operation === 'delete' ? [] : [
        operation === 'connection' || operation === 'ai-update'
          ? { ...f.saved, credential: { configured: true } } : f.saved,
      ])
      expect(current.modelProfiles.map(model => model.providerModelId)).toEqual(operation === 'delete' ? [] : ['new-model'])
      expect(JSON.stringify(current.providerAccounts)).not.toContain('secret')
    },
  )

  it.each(['update', 'delete'] as const)('does not publish an uncommitted Provider %s', async operation => {
    const f = fixture()
    await f.render().refreshProviderAccounts()
    const original = f.render().providerAccounts
    const originalModels = f.render().modelProfiles
    f.api.providerAccounts[operation].mockRejectedValue(f.failure)
    const pending = operation === 'update'
      ? f.render().updateProviderAccount('provider', { displayName: 'Saved' })
      : f.render().deleteProviderAccount('provider')
    await expect(pending).rejects.toBe(f.failure)
    expect(f.render().providerAccounts).toEqual(original)
    expect(f.render().modelProfiles).toEqual(originalModels)
    expect(f.list).toHaveBeenCalledOnce()
  })

  it('retains committed metadata but not successful credentials when credential replacement fails', async () => {
    const f = fixture()
    await f.render().refreshProviderAccounts()
    f.credential.mockRejectedValue(f.failure)
    await expect(f.render().updateProviderConnection('provider', {
      displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    })).rejects.toBe(f.failure)
    expect(f.render().providerAccounts).toEqual([f.saved])
    expect(f.list).toHaveBeenCalledOnce()
  })

  it.each(['create', 'update'] as const)('retains committed capability %s after refresh failure', async operation => {
    const f = fixture()
    const request = { providerProfileId: 'provider', capabilityId: 'chat', displayName: 'Saved', config: {} }
    const pending = operation === 'create' ? f.render().createAiCapabilityProfile(request)
      : f.render().updateAiCapabilityProfile({ ...request, profileId: 'capability' })
    if (operation === 'create') await expect(pending).resolves.toBe('capability')
    else await expect(pending).rejects.toBe(f.failure)
    expect(f.render().aiCapabilityProfiles).toEqual([f.capability])
  })
})
