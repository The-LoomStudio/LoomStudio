import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderSettings } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import { useAgentProfiles } from '../../../apps/studio-client/src/features/agent-profiles/model/use-agent-profiles.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const state = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const setter = vi.fn()
    state.setters.push(setter)
    return [typeof initial === 'function' ? initial() : initial, setter]
  },
}))

beforeEach(() => { state.setters.length = 0 })

describe('profile list pagination consumers', () => {
  it.each(['provider', 'capability'] as const)('distinguishes failed %s creation from a committed creation with failed refresh', async kind => {
    const failure = new Error('Unavailable')
    const create = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(
      kind === 'provider' ? { providerProfile: { id: 'created' } } : { profile: { id: 'created' } },
    )
    const api = {
      providerAccounts: { create, list: async () => { throw failure } },
      aiCapabilityProfiles: { create, list: async () => { throw failure } },
    } as unknown as StudioApi
    const report = vi.fn()
    const settings = useProviderSettings({
      api,
      initialProviderAccountDraft: { displayName: '', baseUrl: '', apiKey: '' },
      runAction: async action => {
        try { await action() } catch (error) { report(error); throw error }
      },
    })
    const createProfile = () => kind === 'provider'
      ? settings.createAiProviderAccount({ providerExtensionId: 'provider', displayName: 'Draft', config: {} })
      : settings.createAiCapabilityProfile({ providerProfileId: 'provider', capabilityId: 'chat', displayName: 'Draft', config: {} })
    await expect(createProfile()).rejects.toBe(failure)
    await expect(createProfile()).resolves.toBe('created')
    expect(report).toHaveBeenCalledTimes(2)
  })

  it('propagates model update failure without poisoning the next queued edit', async () => {
    const failure = new Error('Update rejected')
    const update = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({})
    const api = {
      providerAccounts: {
        list: async () => ({ providerProfiles: [{ id: 'provider', enabledModelIds: [], version: 1 }] }),
        update,
      },
    } as unknown as StudioApi
    const settings = useProviderSettings({
      api, initialProviderAccountDraft: { displayName: '', baseUrl: '', apiKey: '' },
      runAction: action => action(),
    })
    await expect(settings.createModelProfile('provider', 'first')).rejects.toBe(failure)
    await expect(settings.createModelProfile('provider', 'second')).resolves.toBeUndefined()
    expect(update).toHaveBeenNthCalledWith(2, { providerProfileId: 'provider', enabledModelIds: ['second'] })
  })

  it('does not report a committed Agent creation as failed when the subsequent refresh fails', async () => {
    const failure = new Error('Refresh failed')
    const api = {
      agentProfiles: {
        create: async () => ({ agentProfile: { id: 'created' } }),
        list: async () => { throw failure },
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    let reported: unknown
    const profiles = useAgentProfiles({
      api, runAction: async action => {
        try { await action() } catch (error) { reported = error; throw error }
      },
    })
    await expect(profiles.createAgentProfile({
      name: 'Committed', presetId: 'preset', model: { providerProfileId: 'provider', modelId: 'model' },
    })).resolves.toBe(true)
    expect(reported).toBe(failure)
    expect(state.setters[3]).toHaveBeenCalledWith('created')
  })

  it.each([true, false])('reports Agent creation success explicitly (success: %s)', async success => {
    const failure = new Error('Create failed')
    const api = {
      agentProfiles: {
        create: async () => {
          if (!success) throw failure
          return { agentProfile: { id: 'created' } }
        },
        list: async () => ({ agentProfiles: [{ id: 'created' }] }),
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    let reported: unknown
    const profiles = useAgentProfiles({
      api,
      runAction: async action => {
        try { await action() } catch (error) { reported = error; throw error }
      },
    })
    const pending = profiles.createAgentProfile({
      name: 'Draft', presetId: 'preset', model: { providerProfileId: 'provider', modelId: 'model' },
    })
    if (success) await expect(pending).resolves.toBe(true)
    else await expect(pending).rejects.toBe(failure)
    expect(reported).toBe(success ? undefined : failure)
    if (!success) expect(state.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
  })

  it.each(['provider', 'capability', 'agent'] as const)('loads all 101 %s profiles into the consuming Hook', async kind => {
    const records = Array.from({ length: 101 }, (_, index) => ({
      id: `profile-${index}`, enabledModelIds: [], version: 1,
    }))
    const property = kind === 'provider' ? 'providerProfiles' : kind === 'agent' ? 'agentProfiles' : 'profiles'
    const list = vi.fn()
      .mockResolvedValueOnce({ [property]: records.slice(0, 100), nextCursor: 'second-page' })
      .mockResolvedValueOnce({ [property]: records.slice(100) })
    const api = {
      providerAccounts: { list: kind === 'provider' ? list : async () => ({ providerProfiles: [] }) },
      aiCapabilityProfiles: { list: kind === 'capability' ? list : async () => ({ profiles: [] }) },
      aiGateway: { listProviders: async () => [] },
      agentProfiles: { list },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    if (kind === 'agent') {
      await useAgentProfiles({ api, runAction: action => action() }).refreshAgentProfiles()
    } else {
      await useProviderSettings({
        api, runAction: action => action(),
        initialProviderAccountDraft: { displayName: '', baseUrl: '', apiKey: '' },
      }).refreshProviderSettings()
    }
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenNthCalledWith(2, { cursor: 'second-page', limit: 100 })
    expect(state.setters.some(setter => setter.mock.calls.some(([value]) => Array.isArray(value) && value.length === 101))).toBe(true)
  })

  it('does not publish a partial Provider list when a later page fails', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ providerProfiles: [{ id: 'first', enabledModelIds: [] }], nextCursor: 'next' })
      .mockRejectedValueOnce(new Error('Page unavailable'))
    const api = { providerAccounts: { list } } as unknown as StudioApi
    const settings = useProviderSettings({
      api, runAction: action => action(),
      initialProviderAccountDraft: { displayName: '', baseUrl: '', apiKey: '' },
    })
    await expect(settings.refreshProviderAccounts()).rejects.toThrow('Page unavailable')
    expect(state.setters.every(setter => setter.mock.calls.length === 0)).toBe(true)
  })
})
