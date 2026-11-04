// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, type FormEvent } from 'react'
import { defaultScheduler, notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '../../support/client/render-hook.js'
import { useProviderSettings } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { ProviderAccount, AiCapabilityProfile, RegisteredAiGatewayProvider } from '../../../apps/studio-client/src/entities/index.js'

const cleanups: Array<() => void> = []
beforeEach(() => notifyManager.setScheduler(queueMicrotask))
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  notifyManager.setScheduler(defaultScheduler)
  vi.restoreAllMocks()
})

async function run<T>(operation: () => T): Promise<Awaited<T>> {
  let result!: { value: Awaited<T> } | { error: unknown }
  await act(async () => {
    try { result = { value: await operation() } } catch (error) { result = { error } }
  })
  if ('error' in result) throw result.error
  return result.value
}
function start<T>(operation: () => T): T {
  let value!: T
  act(() => { value = operation() })
  return value
}
function mountSettings(api: StudioApi, runAction: (action: () => Promise<void>) => Promise<void> = action => action()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let source = { api, endpoint: '/first' }
  const hook = renderHook(() => useProviderSettings({
    ...source, runAction,
    initialProviderAccountDraft: { displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: '' },
  }), child => createElement(QueryClientProvider, { client }, child))
  cleanups.push(() => { hook.unmount(); client.clear() })
  return {
    client,
    render: () => hook.current,
    changeSource: (api: StudioApi, endpoint: string) => { source = { api, endpoint }; hook.rerender() },
  }
}

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
  return { ...mountSettings(api as unknown as StudioApi), list, credential, api, failure, saved, capability }
}

describe('Provider committed result publication', () => {
  it.each([false, true])('keeps the current provider catalog when an older refresh finishes (latest fails: %s)', async latestFails => {
    const f = fixture()
    const initial: RegisteredAiGatewayProvider[] = [{
      id: 'current', displayName: 'Current', capabilities: [], registeredBy: { kind: 'platform' },
    }]
    f.api.aiGateway.listProviders.mockResolvedValueOnce(initial)
    await run(() => f.render().refreshAiProviders())
    const pending = Promise.withResolvers<RegisteredAiGatewayProvider[]>()
    f.api.aiGateway.listProviders.mockReturnValueOnce(pending.promise)
    const old = start(() => f.render().refreshAiProviders())
    if (latestFails) {
      f.api.aiGateway.listProviders.mockRejectedValueOnce(f.failure)
      await expect(run(() => f.render().refreshAiProviders())).rejects.toBe(f.failure)
    } else {
      await run(() => f.render().refreshAiProviders())
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
    const old = start(() => f.render().refreshProviderSettings())
    await run(() => f.render().refreshProviderSettings())
    pending.resolve()
    await old
    expect(kind === 'provider' ? f.render().providerAccounts : f.render().aiCapabilityProfiles)
      .toEqual([kind === 'provider' ? f.saved : f.capability])
  })

  it('keeps the previous connection when saving fails during a concurrent refresh', async () => {
    const f = fixture()
    await run(() => f.render().refreshProviderAccounts())
    const old = f.render().providerAccounts
    const pending = Promise.withResolvers<void>()
    f.list.mockImplementationOnce(async () => { await pending.promise; return { providerProfiles: old } })
    f.list.mockResolvedValue({ providerProfiles: [f.saved] })
    const stale = start(() => f.render().refreshProviderAccounts())
    f.api.providerAccounts.update.mockRejectedValue(f.failure)
    await expect(run(() => f.render().updateProviderConnection('provider', {
      displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    }))).rejects.toBe(f.failure)
    pending.resolve()
    await stale
    expect(f.render().providerAccounts).toEqual(old)
    expect(f.list).toHaveBeenCalledTimes(2)
  })

  it.each(['create-form', 'create', 'update', 'connection', 'ai-update', 'add-model', 'edit-model', 'delete-model', 'delete'] as const)(
    'retains the committed %s result when the follow-up list fails',
    async operation => {
      const f = fixture()
      await run(() => f.render().refreshProviderAccounts())
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
      const pending = run(() => actions[operation]())
      if (operation === 'create') await expect(pending).resolves.toBe('provider')
      else await expect(pending).rejects.toBe(f.failure)
      const current = f.render()
      expect(current.providerAccounts).toEqual(operation === 'delete' ? [] : [
        f.saved,
      ])
      expect(current.modelProfiles.map(model => model.providerModelId)).toEqual(operation === 'delete' ? [] : ['new-model'])
      expect(JSON.stringify(current.providerAccounts)).not.toContain('secret')
      expect(JSON.stringify(f.client.getQueryCache().getAll().map(query => query.state.data))).not.toContain('secret')
      expect(f.client.getMutationCache().getAll()).toEqual([])
    },
  )

  it.each(['update', 'delete'] as const)('does not publish an uncommitted Provider %s', async operation => {
    const f = fixture()
    await run(() => f.render().refreshProviderAccounts())
    const original = f.render().providerAccounts
    const originalModels = f.render().modelProfiles
    f.api.providerAccounts[operation].mockRejectedValue(f.failure)
    const pending = run(() => operation === 'update'
      ? f.render().updateProviderAccount('provider', { displayName: 'Saved' })
      : f.render().deleteProviderAccount('provider'))
    await expect(pending).rejects.toBe(f.failure)
    expect(f.render().providerAccounts).toEqual(original)
    expect(f.render().modelProfiles).toEqual(originalModels)
    expect(f.list).toHaveBeenCalledOnce()
  })

  it('retains the old connection when the coordinated save fails', async () => {
    const f = fixture()
    await run(() => f.render().refreshProviderAccounts())
    const original = f.render().providerAccounts
    f.api.providerAccounts.update.mockRejectedValue(f.failure)
    await expect(run(() => f.render().updateProviderConnection('provider', {
      displayName: 'Saved', baseUrl: 'https://example.test/v1', apiKey: 'secret',
    }))).rejects.toBe(f.failure)
    expect(f.render().providerAccounts).toEqual(original)
    expect(f.api.providerAccounts.update).toHaveBeenCalledWith({ providerProfileId: 'provider', expectedVersion: 1, displayName: 'Saved', config: { baseUrl: 'https://example.test/v1' }, credential: { apiKey: 'secret' } })
    expect(f.credential).not.toHaveBeenCalled()
    expect(f.list).toHaveBeenCalledOnce()
  })

  it.each(['create', 'update'] as const)('retains committed capability %s after refresh failure', async operation => {
    const f = fixture()
    const request = { providerProfileId: 'provider', capabilityId: 'chat', displayName: 'Saved', config: {} }
    const pending = run(() => operation === 'create' ? f.render().createAiCapabilityProfile(request)
      : f.render().updateAiCapabilityProfile({ ...request, profileId: 'capability' }))
    if (operation === 'create') await expect(pending).resolves.toBe('capability')
    else await expect(pending).rejects.toBe(f.failure)
    expect(f.render().aiCapabilityProfiles).toEqual([f.capability])
  })
  it.each(['provider', 'capability'] as const)('distinguishes failed %s creation from a committed creation with failed refresh', async kind => {
    const failure = new Error('Unavailable')
    const create = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(
      kind === 'provider' ? { providerProfile: { id: 'created', enabledModelIds: [] } } : { profile: { id: 'created' } },
    )
    const api = {
      providerAccounts: { create, list: async () => { throw failure } },
      aiCapabilityProfiles: { create, list: async () => { throw failure } },
    } as unknown as StudioApi
    const report = vi.fn()
    const settings = mountSettings(api, async action => {
      try { await action() } catch (error) { report(error); throw error }
    }).render()
    const createProfile = () => kind === 'provider'
      ? settings.createAiProviderAccount({ providerExtensionId: 'provider', displayName: 'Draft', config: {} })
      : settings.createAiCapabilityProfile({ providerProfileId: 'provider', capabilityId: 'chat', displayName: 'Draft', config: {} })
    await expect(run(createProfile)).rejects.toBe(failure)
    await expect(run(createProfile)).resolves.toBe('created')
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('propagates model update failure without poisoning the next queued edit', async () => {
    const failure = new Error('Update rejected')
    const update = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ providerProfile: { id: 'provider', enabledModelIds: ['second'], version: 2 } })
    const api = {
      providerAccounts: {
        list: async () => ({ providerProfiles: [{ id: 'provider', enabledModelIds: [], version: 1 }] }),
        update,
      },
    } as unknown as StudioApi
    const settings = mountSettings(api).render()
    await expect(run(() => settings.createModelProfile('provider', 'first'))).rejects.toBe(failure)
    await expect(run(() => settings.createModelProfile('provider', 'second'))).resolves.toBeUndefined()
    expect(update).toHaveBeenNthCalledWith(2, { providerProfileId: 'provider', expectedVersion: 1, enabledModelIds: ['second'] })
  })

  it.each(['provider', 'capability'] as const)('loads all 101 %s profiles into the consuming Hook', async kind => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      id: `profile-${index}`, enabledModelIds: [], version: 1,
    }))
    const property = kind === 'provider' ? 'providerProfiles' : 'profiles'
    const list = vi.fn()
      .mockResolvedValueOnce({ [property]: records.slice(0, 100), nextCursor: 'second-page' })
      .mockResolvedValueOnce({ [property]: records.slice(100) })
    const api = {
      providerAccounts: { list: kind === 'provider' ? list : async () => ({ providerProfiles: [] }) },
      aiCapabilityProfiles: { list: kind === 'capability' ? list : async () => ({ profiles: [] }) },
      aiGateway: { listProviders: async () => [] },
    } as unknown as StudioApi
    const mounted = mountSettings(api)
    await run(() => mounted.render().refreshProviderSettings())
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(2, { cursor: 'second-page', limit: 100 })
    expect(kind === 'provider' ? mounted.render().providerAccounts : mounted.render().aiCapabilityProfiles).toHaveLength(101)
  })

  it('does not publish a partial Provider list when a later page fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ providerProfiles: [{ id: 'first', enabledModelIds: [] }], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('Page unavailable'))
    const api = { providerAccounts: { list } } as unknown as StudioApi
    const mounted = mountSettings(api)
    await expect(run(() => mounted.render().refreshProviderAccounts())).rejects.toThrow('Page unavailable')
    expect(mounted.render().providerAccounts).toEqual([])
    expect(mounted.render().providerAccountsLoaded).toBe(false)
  })

  it.each(['read', 'write'] as const)('isolates a late %s from the previous endpoint', async operation => {
    const f = fixture()
    expect(f.list).not.toHaveBeenCalled()
    expect(f.render().providerAccountsLoaded).toBe(false)
    await run(() => f.render().refreshProviderAccounts())
    const pending = Promise.withResolvers<{ providerProfiles: ProviderAccount[]; providerProfile: ProviderAccount }>()
    if (operation === 'read') f.list.mockReturnValueOnce(pending.promise)
    else f.api.providerAccounts.update.mockReturnValueOnce(pending.promise)
    const old = start(() => operation === 'read' ? f.render().refreshProviderAccounts()
      : f.render().updateProviderAccount('provider', { displayName: 'Saved' }))
    const secondAccount = { ...f.saved, id: 'second-provider' }
    f.changeSource({
      providerAccounts: { list: async () => ({ providerProfiles: [secondAccount] }) },
    } as unknown as StudioApi, '/second')
    expect(f.render().providerAccounts).toEqual([])
    expect(f.render().providerAccountsLoaded).toBe(false)
    await run(() => f.render().refreshProviderAccounts())
    await run(async () => {
      pending.resolve({ providerProfiles: [f.saved], providerProfile: f.saved })
      await old
    })
    expect(f.render().providerAccounts).toEqual([secondAccount])
    expect(f.render().providerAccountsLoaded).toBe(true)
  })
})
