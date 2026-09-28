import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProviderSettings } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import { useAgentPresets } from '../../../apps/studio-client/src/features/agent-presets/model/use-agent-presets.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { AgentPreset, AgentToolDefinition } from '../../../apps/studio-client/src/entities/index.js'

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
  it('does not replace a later explicit Profile selection when creation completes', async () => {
    const pending = Promise.withResolvers<void>()
    const created = { id: 'created' }
    const api = {
      agentPresets: {
        create: async () => { await pending.promise; return { agentPreset: created } },
        list: async () => ({ agentPresets: [created, { id: 'other' }] }),
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    const profiles = useAgentPresets({ api, runAction: action => action() })
    const creation = profiles.updateAgentPreset({
      name: 'New', agentPresetId: 'preset', expectedVersion: (await profiles.getPromptResource({ resourceId: 'preset' })).resource.version, model: { providerProfileId: 'provider', modelId: 'model' },
    })
    profiles.selectAgentPreset('other')
    pending.resolve()
    await expect(creation).resolves.toBe(true)
    let selected: string | undefined
    for (const [value] of state.setters[3]!.mock.calls) selected = typeof value === 'function' ? value(selected) : value
    expect(selected).toBe('other')
    expect(state.setters[0]).toHaveBeenLastCalledWith([created, { id: 'other' }])
  })

  it('keeps the newest combined Agent refresh when an older request finishes last', async () => {
    const pending = Promise.withResolvers<void>()
    const latest = [{ id: 'new-profile' }]
    const list = vi.fn().mockImplementationOnce(async () => {
      await pending.promise
      return { agentPresets: [{ id: 'old-profile' }] }
    }).mockResolvedValue({ agentPresets: latest })
    const api = {
      agentPresets: { list },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    const profiles = useAgentPresets({ api, runAction: action => action() })
    const old = profiles.refreshAgentPresets()
    await profiles.refreshAgentPresets()
    pending.resolve()
    await old
    expect(state.setters[0]).toHaveBeenCalledExactlyOnceWith(latest)
  })

  it('rereads a combined Agent list when a tool was saved during the read', async () => {
    const original: AgentToolDefinition = {
      id: 'tool', version: 1, name: 'Original', description: '', owner: { namespace: 'test' },
      input: { kind: 'structured' }, createdAt: '', updatedAt: '',
    }
    const saved = { ...original, version: 2, name: 'Saved' }
    const list = vi.fn().mockResolvedValue({ agentPresets: [] })
    const listTools = vi.fn().mockResolvedValue({ tools: [original] })
    const api = {
      agentPresets: { list },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: listTools, update: async () => ({ tool: saved }) },
    } as unknown as StudioApi
    const profiles = useAgentPresets({ api, runAction: action => action() })
    await profiles.refreshAgentPresets()
    const pending = Promise.withResolvers<void>()
    list.mockImplementationOnce(async () => { await pending.promise; return { agentPresets: [] } })
    const stale = profiles.refreshAgentPresets()
    await profiles.updateAgentTool(original)
    listTools.mockResolvedValue({ tools: [saved] })
    pending.resolve()
    await stale
    let tools: AgentToolDefinition[] = []
    for (const [value] of state.setters[2]!.mock.calls) tools = typeof value === 'function' ? value(tools) : value
    expect(tools).toEqual([saved])
    expect(listTools).toHaveBeenCalledTimes(3)
  })

  it.each(['create', 'update', 'delete'] as const)('publishes committed Agent %s before a failed refresh', async kind => {
    const original = { id: 'profile', name: 'Original', version: 1 } as AgentPreset
    const unrelated = { id: 'other', name: 'Other', version: 1 } as AgentPreset
    const saved = { ...original, name: 'Saved', version: 2 }
    const failure = new Error('Refresh failed')
    const api = {
      agentPresets: {
        create: async () => ({ agentPreset: saved }),
        update: async () => ({ agentPreset: saved }),
        delete: async () => ({ deleted: true }),
        list: async () => { throw failure },
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    const profiles = useAgentPresets({ api, runAction: action => action() })
    const operation = kind === 'create'
      ? profiles.updateAgentPreset({ name: 'Saved', agentPresetId: 'preset', expectedVersion: (await profiles.getPromptResource({ resourceId: 'preset' })).resource.version, model: { providerProfileId: 'provider', modelId: 'model' } })
      : kind === 'update'
        ? profiles.updateAgentPreset(original.id, { name: 'Saved' })
        : profiles.deleteAgentPreset(original.id)
    if (kind === 'create') await expect(operation).resolves.toBe(true)
    else await expect(operation).rejects.toBe(failure)
    let records = kind === 'create' ? [unrelated] : [original, unrelated]
    for (const [value] of state.setters[0]!.mock.calls) records = typeof value === 'function' ? value(records) : value
    expect(records).toEqual(kind === 'delete' ? [unrelated] : [saved, unrelated])
    if (kind === 'delete') expect(state.setters[3]).not.toHaveBeenCalled()
  })

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
      agentPresets: {
        create: async () => ({ agentPreset: { id: 'created' } }),
        list: async () => { throw failure },
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    let reported: unknown
    const profiles = useAgentPresets({
      api, runAction: async action => {
        try { await action() } catch (error) { reported = error; throw error }
      },
    })
    await expect(profiles.updateAgentPreset({
      name: 'Committed', agentPresetId: 'preset', expectedVersion: (await profiles.getPromptResource({ resourceId: 'preset' })).resource.version, model: { providerProfileId: 'provider', modelId: 'model' },
    })).resolves.toBe(true)
    expect(reported).toBe(failure)
    expect(state.setters[3]).toHaveBeenCalledWith('created')
  })

  it.each([true, false])('reports Agent creation success explicitly (success: %s)', async success => {
    const failure = new Error('Create failed')
    const api = {
      agentPresets: {
        create: async () => {
          if (!success) throw failure
          return { agentPreset: { id: 'created' } }
        },
        list: async () => ({ agentPresets: [{ id: 'created' }] }),
      },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    let reported: unknown
    const profiles = useAgentPresets({
      api,
      runAction: async action => {
        try { await action() } catch (error) { reported = error; throw error }
      },
    })
    const pending = profiles.updateAgentPreset({
      name: 'Draft', agentPresetId: 'preset', expectedVersion: (await profiles.getPromptResource({ resourceId: 'preset' })).resource.version, model: { providerProfileId: 'provider', modelId: 'model' },
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
    const property = kind === 'provider' ? 'providerProfiles' : kind === 'agent' ? 'agentPresets' : 'profiles'
    const list = vi.fn()
      .mockResolvedValueOnce({ [property]: records.slice(0, 100), nextCursor: 'second-page' })
      .mockResolvedValueOnce({ [property]: records.slice(100) })
    const api = {
      providerAccounts: { list: kind === 'provider' ? list : async () => ({ providerProfiles: [] }) },
      aiCapabilityProfiles: { list: kind === 'capability' ? list : async () => ({ profiles: [] }) },
      aiGateway: { listProviders: async () => [] },
      agentPresets: { list },
      promptResources: { list: async () => ({ resources: [] }) },
      agentTools: { list: async () => ({ tools: [] }) },
    } as unknown as StudioApi
    if (kind === 'agent') {
      await useAgentPresets({ api, runAction: action => action() }).refreshAgentPresets()
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
