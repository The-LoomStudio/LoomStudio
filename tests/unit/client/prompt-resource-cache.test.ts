import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { usePromptResourceState } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { ListPromptResourcesResult, PromptResource, LoreMount, PresetToolMount } from '../../../apps/studio-client/src/entities/index.js'

let activeClient: QueryClient | undefined
afterEach(() => { activeClient?.clear() })

describe('Prompt Resource mutation cache publication', () => {
  it('passes Query cancellation to the resource list while retaining the current cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    activeClient = client
    const key = ['prompt-resources', '/rpc-a', 'resources']
    const cached = { resources: [] }
    client.setQueryData(key, cached)
    const started = Promise.withResolvers<void>()
    let requestSignal: AbortSignal | undefined
    const list = vi.fn((_kind?: 'preset' | 'lore', signal?: AbortSignal) => {
      requestSignal = signal
      started.resolve()
      return new Promise<ListPromptResourcesResult>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    })
    function Consumer() {
      usePromptResourceState({ api: { promptResources: { list } } as unknown as StudioApi, endpoint: '/rpc-a' })
      return null
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
    const query = client.getQueryCache().find({ queryKey: key, exact: true })!
    const pending = query.fetch().catch(error => error)
    await started.promise
    await client.cancelQueries({ queryKey: key, exact: true })
    await pending
    expect(requestSignal?.aborted).toBe(true)
    expect(client.getQueryData(key)).toBe(cached)
    expect(query.state.fetchStatus).toBe('idle')
  })

  it.each([false, true])('retains invalid resource diagnostics with cached healthy resources: %s', cached => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    activeClient = client
    const key = ['prompt-resources', '/rpc-a', 'resources']
    const invalidResources = [{ id: 'bad', resourceKind: 'lore', label: 'Broken', version: 1, error: 'Invalid JSON' }]
    if (cached) client.setQueryData(key, { resources: [], invalidResources })
    let state!: ReturnType<typeof usePromptResourceState>
    function Consumer() {
      state = usePromptResourceState({ api: {} as StudioApi, endpoint: '/rpc-a' })
      return null
    }
    const render = () => renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
    render()
    if (!cached) {
      expect(state.resourcesReady).toBe(false)
      client.setQueryData(key, { resources: [], invalidResources })
      render()
    }
    expect(state.resourcesReady).toBe(true)
    expect(state.invalidPromptResources).toEqual(invalidResources)
    state.setPromptResources(() => [])
    expect(client.getQueryData<ListPromptResourcesResult>(key)?.invalidResources).toEqual(invalidResources)
  })
  it.each(['unchanged', 'updated', 'deleted'] as const)('merges a targeted refresh into the current collection when the target is %s', async change => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    activeClient = client
    const resource = (id: string, version: number): PromptResource => ({
      id, version, resourceKind: 'lore', rootNode: { id: `${id}-root`, kind: 'module', label: id },
      createdAt: '', updatedAt: '',
    })
    const old = resource('target', 1)
    const refreshed = resource('target', 2)
    const newer = resource('target', 3)
    const other = resource('other', 2)
    const added = resource('added', 1)
    const pending = Promise.withResolvers<{ resource: PromptResource }>()
    const api = { promptResources: { get: () => pending.promise } } as unknown as StudioApi
    const key = ['prompt-resources', '/rpc-a', 'resources']
    const otherKey = ['prompt-resources', '/rpc-b', 'resources']
    client.setQueryData(key, { resources: [old, resource('other', 1)] })
    client.setQueryData(otherKey, { resources: [old] })
    let state!: ReturnType<typeof usePromptResourceState>
    function Consumer() {
      state = usePromptResourceState({ api, endpoint: '/rpc-a' })
      return null
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
    const request = state.refreshPromptResource('target')
    state.setPromptResources(() => [
      ...(change === 'deleted' ? [] : [change === 'updated' ? newer : old]), other, added,
    ])
    pending.resolve({ resource: refreshed })
    expect(await request).toEqual(change === 'deleted' ? undefined : change === 'updated' ? newer : refreshed)
    expect(client.getQueryData<ListPromptResourcesResult>(key)?.resources).toEqual([
      ...(change === 'deleted' ? [] : [change === 'updated' ? newer : refreshed]), other, added,
    ])
    expect(client.getQueryData<ListPromptResourcesResult>(otherKey)?.resources).toEqual([old])
  })

  it.each(['resources', 'lore-mounts', 'preset-tool-mounts'] as const)(
    'does not allow an older %s response to overwrite committed cache changes',
    async area => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      activeClient = client
      let resolveOld!: (value: unknown) => void
      const oldResponse = new Promise(resolve => { resolveOld = resolve })
      const list = vi.fn(() => oldResponse)
      const api = { promptResources: {
        list, listLoreMounts: list, listPresetToolMounts: list,
      } } as unknown as StudioApi
      const key = ['prompt-resources', '/rpc-a', area]
      const otherKey = ['prompt-resources', '/rpc-b', area]
      const payload = (resources: unknown[]) => area === 'resources' ? { resources } : resources
      const old = [{ id: 'item', version: 1 }]
      const saved = [{ id: 'item', version: 2 }]
      client.setQueryData(key, payload(old))
      client.setQueryData(otherKey, payload(old))
      let state!: ReturnType<typeof usePromptResourceState>
      function Consumer() {
        state = usePromptResourceState({ api, endpoint: '/rpc-a' })
        return null
      }
      renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
      const pending = client.fetchQuery({ queryKey: key, queryFn: async () => {
        const response = await oldResponse as { resources?: unknown; mounts?: unknown }
        return area === 'resources' ? response : response.mounts
      } }).catch(error => error)
      const publish = (records: typeof saved) => {
        if (area === 'resources') state.setPromptResources(() => records as PromptResource[])
        else if (area === 'lore-mounts') state.setLoreMounts(() => records as unknown as LoreMount[])
        else state.setPresetToolMounts(() => records as unknown as PresetToolMount[])
      }
      publish(saved)
      expect(client.getQueryData(key)).toEqual(payload(saved))
      resolveOld(area === 'resources' ? { resources: old } : { mounts: old })
      await oldResponse
      await pending
      await Promise.resolve()
      expect(client.getQueryData(key)).toEqual(payload(saved))
      expect(client.getQueryData(otherKey)).toEqual(payload(old))

      let resolveDeleted!: (value: unknown) => void
      const stale = new Promise(resolve => { resolveDeleted = resolve })
      const deletedPending = client.fetchQuery({ queryKey: key, queryFn: () => stale }).catch(error => error)
      publish([])
      resolveDeleted(saved)
      await stale
      await deletedPending
      expect(client.getQueryData(key)).toEqual(payload([]))
      await client.fetchQuery({ queryKey: key, queryFn: async () => payload(saved) })
      expect(client.getQueryData(key)).toEqual(payload(saved))
    },
  )
})
