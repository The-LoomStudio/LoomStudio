import type { ClientExtensionActivationContext } from '@loom-studio/extension-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedLoomScriptRendererMount } from '../../../apps/studio-client/src/entities/loom-script.js'
import { createClientWorkerModule } from '../../../apps/studio-client/src/shared/worker-runtime/client-worker-module.js'
import { createClientScriptRuntime } from '../../../apps/studio-client/src/features/loom-scripts/model/client-script-runtime.js'
import type { ClientExtensionDataApi } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'

vi.mock('../../../apps/studio-client/src/shared/worker-runtime/client-worker-module.js', () => ({ createClientWorkerModule: vi.fn() }))
beforeEach(() => { vi.mocked(createClientWorkerModule).mockReset() })

function mount(runtime: 'client' | 'client-worker' = 'client'): ResolvedLoomScriptRendererMount {
  return {
    mountId: 'mount-a', mountVersion: 1, target: { kind: 'card', cardId: 'card-a' }, enabled: true, orderIndex: 0,
    grantedCapabilities: [`runtime.${runtime}`], source: 'version 1',
    script: { id: 'script-a', version: 1, metadataId: 'test.script', name: 'Test', scriptVersion: '1.0.0', runtime, requestedCapabilities: [`runtime.${runtime}`], contributions: [] },
  }
}

describe('Client Script Runtime', () => {
  it('updates owner-isolated Config subscriptions without reactivating the module and cancels on dispose', async () => {
    vi.useFakeTimers()
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a', timelineId: 'story-a', branchId: 'main' })
    let context!: ClientExtensionActivationContext
    let value = 'A'
    const listConfigs = vi.fn(async () => [{ id: 'config-a', scriptDocumentId: 'script-a', scope: { kind: 'timeline' as const, timelineId: 'story-a' }, key: 'mode', value, version: value === 'A' ? 1 : 2, createdAt: '', updatedAt: '' }])
    const loadSource = vi.fn(async () => ({ activate(ctx: ClientExtensionActivationContext) { context = ctx } }))
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource, configs: { listConfigs, upsertConfig: vi.fn() } })
    const adopted = mount()
    adopted.grantedCapabilities.push('configs.read', 'configs.write')
    adopted.script.requestedCapabilities.push('configs.read', 'configs.write')
    try {
      await runtime.reconcile([adopted])
      const handler = vi.fn()
      const handle = context.configs.subscribe({}, handler)
      await vi.advanceTimersByTimeAsync(0)
      expect(handler.mock.calls[0]?.[0][0].value).toBe('A')
      expect(listConfigs).toHaveBeenCalledWith({ mountId: 'mount-a', runtimeRevision: 1, scope: { kind: 'timeline', timelineId: 'story-a' } })
      value = 'B'
      await vi.advanceTimersByTimeAsync(1000)
      expect(handler.mock.calls.at(-1)?.[0][0].value).toBe('B')
      expect(loadSource).toHaveBeenCalledTimes(1)
      await expect(context.configs.get({ scope: { kind: 'timeline', timelineId: 'other-story' }, key: 'mode' })).rejects.toThrow('outside')
      handle.dispose()
      const count = listConfigs.mock.calls.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(listConfigs).toHaveBeenCalledTimes(count)
    } finally { await runtime.dispose(); vi.useRealTimers() }
  })

  it('keeps the adopted source and instance across saves and same-card stories, refreshing only the selected mount', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a', timelineId: 'story-a', branchId: 'main' })
    const events: string[] = []
    const contexts: ClientExtensionActivationContext[] = []
    const loadSource = vi.fn(async (source: string) => ({ activate(context: ClientExtensionActivationContext) {
      contexts.push(context)
      events.push(`start:${source}`)
      return { dispose() { events.push(`stop:${source}`) } }
    } }))
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource })
    const first = { ...mount(), settings: { caption: '原名' } }
    const other = { ...mount(), mountId: 'mount-b', target: { kind: 'user' as const }, source: 'other' }
    try {
      await runtime.reconcile([first, other])
      expect(contexts[0]!.scriptSettings).toEqual({ caption: '原名' })
      expect(Object.isFrozen(contexts[0]!.scriptSettings)).toBe(true)
      const saved = { ...first, settings: { caption: '新名' }, source: 'version 2', script: { ...first.script, version: 2 } }
      await runtime.reconcile([saved, other])
      expect(loadSource).toHaveBeenCalledTimes(2)
      expect(contexts[0]!.scriptSettings).toEqual({ caption: '原名' })
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a', timelineId: 'story-b', branchId: 'main' })
      await runtime.reconcile([saved, other])
      expect(loadSource).toHaveBeenCalledTimes(2)
      expect(contexts[0]!.timeline.target?.timelineId).toBe('story-b')
      expect(() => contexts[0]!.configs.subscribe({}, () => {})).toThrow('requires an installed Extension')
      await runtime.reconcile([{ ...saved, mountVersion: 2 }, other])
      expect(events).toEqual(['start:version 1', 'start:other', 'stop:version 1', 'start:version 2'])
      expect(contexts.at(-1)!.scriptSettings).toEqual({ caption: '新名' })
      expect(contexts[0]!.signal.aborted).toBe(true)
      await runtime.reconcile([other])
      expect(events.at(-1)).toBe('stop:version 2')
      expect(contexts[1]!.signal.aborted).toBe(false)
    } finally { await runtime.dispose() }
    expect(events.at(-1)).toBe('stop:other')
  })

  it('checks trust before dependencies or source evaluation and loads prerequisites in declaration order', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a' })
    const fetchMock = vi.fn(async (url: string) => new Response(`/* ${url} */`))
    vi.stubGlobal('fetch', fetchMock)
    const loadSource = vi.fn(async (_source: string, _signal: AbortSignal) => ({ activate() {} }))
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource })
    const first = mount()
    first.script.requires = ['https://example.test/a.js', 'https://example.test/b.js']
    try {
      await runtime.reconcile([{ ...first, grantedCapabilities: [] }])
      expect(fetchMock).not.toHaveBeenCalled()
      expect(loadSource).not.toHaveBeenCalled()
      expect(runtime.host.diagnostics().some(item => item.message.includes('runtime.client is not granted'))).toBe(true)
      await runtime.reconcile([{ ...first, mountVersion: 2 }])
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(first.script.requires)
      expect(loadSource.mock.calls[0]?.[0]).toBe('/* https://example.test/a.js */\n;\n/* https://example.test/b.js */\n;\nversion 1')
      await runtime.reconcile([{ ...first, mountVersion: 2 }])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })

  it('requires separate Worker trust and passes prepared source only to the Worker module', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a' })
    const fetchMock = vi.fn(async () => new Response('const prerequisite = 1'))
    vi.stubGlobal('fetch', fetchMock)
    const loadSource = vi.fn(async () => ({ activate() {} }))
    let context!: ClientExtensionActivationContext
    vi.mocked(createClientWorkerModule).mockReturnValue({ activate(value) { context = value } })
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource })
    const first = { ...mount('client-worker'), settings: { count: 7 } }
    first.script.requires = ['https://example.test/dependency.js']
    try {
      await runtime.reconcile([{ ...first, grantedCapabilities: ['runtime.client'] }])
      expect(fetchMock).not.toHaveBeenCalled()
      expect(createClientWorkerModule).not.toHaveBeenCalled()
      expect(runtime.host.diagnostics().some(item => item.message.includes('runtime.client-worker is not granted'))).toBe(true)
      await runtime.reconcile([{ ...first, mountVersion: 2 }])
      expect(createClientWorkerModule).toHaveBeenCalledExactlyOnceWith({ source: 'const prerequisite = 1\n;\nversion 1' })
      expect(loadSource).not.toHaveBeenCalled()
      expect(context.scriptSettings).toEqual({ count: 7 })
      expect(() => context.state.get({ scope: 'global' })).toThrow('state.read')
      expect(() => context.configs.subscribe({}, () => {})).toThrow('requires an installed Extension')
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })

  it('keeps Worker instances across saves and same-card stories and replaces only the refreshed mount', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a', timelineId: 'story-a', branchId: 'main' })
    const events: string[] = []
    const contexts: ClientExtensionActivationContext[] = []
    vi.mocked(createClientWorkerModule).mockImplementation(input => {
      const source = 'source' in input ? input.source : input.entryUrl
      return { activate(context) {
        contexts.push(context)
        events.push(`start:${source}`)
        return { dispose() { events.push(`stop:${source}`) } }
      } }
    })
    const loadSource = vi.fn(async () => ({ activate() {} }))
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource })
    const first = mount('client-worker')
    const other = { ...mount('client-worker'), mountId: 'mount-b', target: { kind: 'user' as const }, source: 'other' }
    try {
      await runtime.reconcile([first, other])
      const saved = { ...first, source: 'version 2', script: { ...first.script, version: 2 } }
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a', timelineId: 'story-b', branchId: 'main' })
      await runtime.reconcile([saved, other])
      expect(createClientWorkerModule).toHaveBeenCalledTimes(2)
      expect(contexts[0]!.timeline.target?.timelineId).toBe('story-b')
      await runtime.reconcile([{ ...saved, mountVersion: 2 }, other])
      expect(events).toEqual(['start:version 1', 'start:other', 'stop:version 1', 'start:version 2'])
      expect(contexts[0]!.signal.aborted).toBe(true)
      expect(contexts[1]!.signal.aborted).toBe(false)
      expect(loadSource).not.toHaveBeenCalled()
    } finally { await runtime.dispose() }
    expect(events).toContain('stop:version 2')
    expect(events).toContain('stop:other')
  })

  it.each(['client', 'client-worker'] as const)('does not evaluate %s source when its dependency finishes after the mount is removed', async executionRuntime => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card-a' })
    const response = Promise.withResolvers<Response>()
    const fetchMock = vi.fn(() => response.promise)
    vi.stubGlobal('fetch', fetchMock)
    const loadSource = vi.fn(async (_source: string, _signal: AbortSignal) => ({ activate() {} }))
    const runtime = createClientScriptRuntime({ rendererHost, data: {} as ClientExtensionDataApi, loadSource })
    const first = mount(executionRuntime)
    first.script.requires = ['https://example.test/slow.js']
    try {
      const starting = runtime.reconcile([first])
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      const stopping = runtime.reconcile([])
      response.resolve(new Response('prerequisite'))
      await Promise.all([starting, stopping])
      expect(loadSource).not.toHaveBeenCalled()
      expect(createClientWorkerModule).not.toHaveBeenCalled()
      expect(runtime.host.summaries()).toEqual([])
    } finally { await runtime.dispose(); vi.unstubAllGlobals() }
  })
})
