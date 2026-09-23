import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '../../../apps/studio-client/node_modules/@tanstack/react-query/build/modern/index.js'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { usePromptResourceState } from '../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { PromptResource, SettingMount, PresetToolMount } from '../../../apps/studio-client/src/entities/index.js'

let activeClient: QueryClient | undefined
afterEach(() => { activeClient?.clear() })

describe('Prompt Resource mutation cache publication', () => {
  it.each(['resources', 'setting-mounts', 'preset-tool-mounts'] as const)(
    'does not allow an older %s response to overwrite committed cache changes',
    async area => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      activeClient = client
      let resolveOld!: (value: unknown) => void
      const oldResponse = new Promise(resolve => { resolveOld = resolve })
      const list = vi.fn(() => oldResponse)
      const api = { promptResources: {
        list, listSettingMounts: list, listPresetToolMounts: list,
      } } as unknown as StudioApi
      const key = ['prompt-resources', '/rpc-a', area]
      const otherKey = ['prompt-resources', '/rpc-b', area]
      const old = [{ id: 'item', version: 1 }]
      const saved = [{ id: 'item', version: 2 }]
      client.setQueryData(key, old)
      client.setQueryData(otherKey, old)
      let state!: ReturnType<typeof usePromptResourceState>
      function Consumer() {
        state = usePromptResourceState({ api, endpoint: '/rpc-a' })
        return null
      }
      renderToString(createElement(QueryClientProvider, { client }, createElement(Consumer)))
      const pending = client.fetchQuery({ queryKey: key, queryFn: async () => {
        const response = await oldResponse as { resources?: unknown; mounts?: unknown }
        return area === 'resources' ? response.resources : response.mounts
      } }).catch(error => error)
      const publish = (records: typeof saved) => {
        if (area === 'resources') state.setPromptResources(() => records as PromptResource[])
        else if (area === 'setting-mounts') state.setSettingMounts(() => records as unknown as SettingMount[])
        else state.setPresetToolMounts(() => records as unknown as PresetToolMount[])
      }
      publish(saved)
      expect(client.getQueryData(key)).toEqual(saved)
      resolveOld(area === 'resources' ? { resources: old } : { mounts: old })
      await oldResponse
      await pending
      await Promise.resolve()
      expect(client.getQueryData(key)).toEqual(saved)
      expect(client.getQueryData(otherKey)).toEqual(old)

      let resolveDeleted!: (value: unknown) => void
      const stale = new Promise(resolve => { resolveDeleted = resolve })
      const deletedPending = client.fetchQuery({ queryKey: key, queryFn: () => stale }).catch(error => error)
      publish([])
      resolveDeleted(saved)
      await stale
      await deletedPending
      expect(client.getQueryData(key)).toEqual([])
      await client.fetchQuery({ queryKey: key, queryFn: async () => saved })
      expect(client.getQueryData(key)).toEqual(saved)
    },
  )
})
