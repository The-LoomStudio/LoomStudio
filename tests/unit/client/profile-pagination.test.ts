// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { defaultScheduler, notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '../../support/client/render-hook.js'
import { useAgentTools } from '../../../apps/studio-client/src/features/agent-presets/model/use-agent-tools.js'
import { useAgentPresets } from '../../../apps/studio-client/src/features/prompt-resources/model/use-agent-presets.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { AgentPreset, AgentToolDefinition } from '../../../apps/studio-client/src/entities/index.js'

const cleanups: Array<() => void> = []
beforeEach(() => notifyManager.setScheduler(queueMicrotask))
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); notifyManager.setScheduler(defaultScheduler) })
const original: AgentToolDefinition = { id: 'tool', version: 1, name: 'Original', description: '', owner: { namespace: 'test' },
  input: { kind: 'structured', schema: { type: 'object' } }, createdAt: '', updatedAt: '' }
const saved = { ...original, version: 2, name: 'Saved' }

function fixture() {
  const api = { agentTools: { list: vi.fn(async () => ({ tools: [original] })), update: vi.fn<StudioApi['agentTools']['update']>(async () => ({ tool: saved })) } }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const source = { api: api as unknown as StudioApi, endpoint: '/first', ready: false, resources: [] as AgentPreset[] }
  const hook = renderHook(() => ({
    ...useAgentTools({ ...source, runAction: action => action() }),
    ...useAgentPresets({ resources: source.resources, ready: source.ready }),
  }), child => createElement(QueryClientProvider, { client }, child))
  cleanups.push(() => { hook.unmount(); client.clear() })
  return { api, client, source, hook }
}

describe('Agent catalog consumers', () => {
  it('keeps selection while loading and replaces a missing Preset after the catalog succeeds', () => {
    const f = fixture()
    act(() => f.hook.current.selectAgentPreset('selected'))
    f.source.resources = [{ id: 'new-preset', resourceKind: 'preset' }, { id: 'lore', resourceKind: 'lore' }] as AgentPreset[]
    f.hook.rerender()
    expect(f.hook.current.selectedAgentPresetId).toBe('selected')
    expect(f.hook.current.agentPresets.map(preset => preset.id)).toEqual(['new-preset'])
    f.source.ready = true
    f.hook.rerender()
    expect(f.hook.current.selectedAgentPresetId).toBe('new-preset')
    f.source.resources = []
    f.hook.rerender()
    expect(f.hook.current.selectedAgentPresetId).toBeUndefined()
    expect(f.api.agentTools.list).not.toHaveBeenCalled()
  })

  it('keeps the newest Agent tool refresh when an older request finishes last', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<{ tools: AgentToolDefinition[] }>()
    f.api.agentTools.list.mockReturnValueOnce(pending.promise).mockResolvedValue({ tools: [saved] })
    let old!: Promise<void>
    act(() => { old = f.hook.current.refreshAgentTools() })
    await act(async () => { await f.hook.current.refreshAgentTools() })
    await act(async () => { pending.resolve({ tools: [original] }); await old })
    expect(f.hook.current.tools).toEqual([saved])
  })

  it('refreshes the full tool catalog after a write interrupts a read', async () => {
    const f = fixture()
    await act(async () => { await f.hook.current.refreshAgentTools() })
    const pending = Promise.withResolvers<{ tools: AgentToolDefinition[] }>()
    const other = { ...original, id: 'other' }
    f.api.agentTools.list.mockReturnValueOnce(pending.promise).mockResolvedValue({ tools: [saved, other] })
    let stale!: Promise<void>
    act(() => { stale = f.hook.current.refreshAgentTools() })
    await act(async () => { await f.hook.current.updateAgentTool(original) })
    await act(async () => { pending.resolve({ tools: [original] }); await stale })
    expect(f.hook.current.tools).toEqual([saved, other])
    expect(f.api.agentTools.list).toHaveBeenCalledTimes(3)
    expect(f.api.agentTools.update.mock.calls[0]?.[0]).toMatchObject({ toolId: 'tool', expectedVersion: 1 })
  })

  it.each(['read', 'write'] as const)('isolates a late %s after switching endpoints', async kind => {
    const f = fixture()
    await act(async () => { await f.hook.current.refreshAgentTools() })
    const read = Promise.withResolvers<{ tools: AgentToolDefinition[] }>()
    const write = Promise.withResolvers<{ tool: AgentToolDefinition }>()
    if (kind === 'read') f.api.agentTools.list.mockReturnValueOnce(read.promise)
    else f.api.agentTools.update.mockReturnValueOnce(write.promise)
    let old!: Promise<void>
    act(() => { old = kind === 'read' ? f.hook.current.refreshAgentTools() : f.hook.current.updateAgentTool(original) })
    f.source.endpoint = '/second'
    f.source.api = { agentTools: { list: async () => ({ tools: [{ ...original, name: 'Second' }] }) } } as unknown as StudioApi
    f.hook.rerender()
    expect(f.hook.current.tools).toEqual([])
    await act(async () => { await f.hook.current.refreshAgentTools() })
    await act(async () => { read.resolve({ tools: [saved] }); write.resolve({ tool: saved }); await old })
    expect(f.hook.current.tools[0]?.name).toBe('Second')
    expect(f.client.getMutationCache().getAll()).toEqual([])
  })
})
