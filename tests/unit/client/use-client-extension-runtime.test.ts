import type { EffectCallback } from 'react'
import type { ClientExtensionModule } from '@loom-studio/extension-sdk'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useClientExtensionRuntime } from '../../../apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.js'
import type { ManagedClientExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'

const hooks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  setters: [] as ReturnType<typeof vi.fn>[],
  loadModule: vi.fn(),
}))

// Drive Effect setup/cleanup directly while exercising the real Hook and Client Host.
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useMemo: (create: () => unknown) => create(),
  useCallback: (callback: unknown) => callback,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const set = vi.fn()
    hooks.setters.push(set)
    return [initial, set]
  },
  useEffect: (effect: EffectCallback) => { hooks.effects.push(effect) },
}))

vi.mock('../../../apps/studio-client/src/shared/studio-shell/appearance-store.js', () => ({
  useAppearanceStore: () => vi.fn(),
}))

vi.mock('../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js')>()
  return {
    ...actual,
    createClientExtensionHost: (options: Parameters<typeof actual.createClientExtensionHost>[0]) => actual.createClientExtensionHost({
      ...options,
      loadModule: hooks.loadModule,
    }),
  }
})

const extensionPackage: ManagedClientExtensionPackage = {
  packageId: 'example.client',
  version: '1.0.0',
  displayName: 'Client Example',
  tags: [],
  available: true,
  sourceKinds: ['repository'],
  modules: [{
    packageId: 'example.client',
    moduleId: 'client',
    runtimeKind: 'client',
    entryUrl: '/extensions/example.client/1.0.0/files/dist/client.js',
    desired: { enabled: true },
    contributions: {
      renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' }],
    },
  }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function drainTasks(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

function createHarness() {
  const list = vi.fn(async () => ({ items: [extensionPackage] }))
  const listRules = vi.fn(async () => ({ rules: [] }))
  const api = {
    extensions: { list, diagnostics: async () => ({ diagnostics: [] }) },
    textTransforms: { listRules, listExtractors: async () => ({ extractors: [] }) },
    extensionRuntime: {},
    states: {},
  } as unknown as Parameters<typeof useClientExtensionRuntime>[0]['api']
  const rendererHost = createClientRendererHost()
  const clientLogs = createMemoryLogSink({ capacity: 50 })
  const logger = createRootLogger({ service: 'studio-client', instanceId: 'hook-test', sinks: [clientLogs] }).child('extension.loader')
  const runtime = useClientExtensionRuntime({ api, rendererHost, logger, clientLogs })
  const setup = hooks.effects.at(-1)!
  return { runtime, rendererHost, list, listRules, setup }
}

beforeEach(() => {
  hooks.effects.length = 0
  hooks.setters.length = 0
  hooks.loadModule.mockReset()
  hooks.loadModule.mockResolvedValue({
    activate: context => context.renderers.register(
      extensionPackage.modules[0]!.contributions.renderers![0]!,
      { mount() {} },
    ),
  } satisfies ClientExtensionModule)
  vi.stubGlobal('EventSource', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Client Extension Runtime Effect lifecycle', () => {
  it('loads only the current Card catalog and ignores late responses without restarting global modules', async () => {
    const { runtime, rendererHost, list, setup } = createHarness()
    const a = deferred<{ items: ManagedClientExtensionPackage[] }>()
    const privatePackage = (cardId: string): ManagedClientExtensionPackage => ({
      ...extensionPackage, target: { kind: 'card', cardId },
      modules: extensionPackage.modules.map(module => ({ ...module, desired: { enabled: false } })),
    })
    list.mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as { cardId: string } | undefined
      if (target?.cardId === 'a') return a.promise
      if (target?.cardId === 'c') throw new Error('Card catalog unavailable')
      return { items: target ? [privatePackage(target.cardId)] : [extensionPackage] }
    })
    const cleanup = setup() as () => void
    try {
      await drainTasks()
      const globalInstance = runtime.host.summaries()[0]?.instanceId
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'a' })
      await drainTasks()
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'b' })
      await drainTasks()
      a.resolve({ items: [privatePackage('a')] })
      await drainTasks()
      expect(list).toHaveBeenCalledWith({ kind: 'card', cardId: 'b' })
      expect(runtime.host.summaries()).toEqual(expect.arrayContaining([
        expect.objectContaining({ instanceId: globalInstance, state: 'active' }),
        expect.objectContaining({ target: { kind: 'card', cardId: 'b' }, state: 'inactive' }),
      ]))
      expect(runtime.host.summaries()).toHaveLength(2)
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'c' })
      await drainTasks()
      expect(runtime.host.summaries()).toEqual([expect.objectContaining({ instanceId: globalInstance, state: 'active' })])
    } finally {
      cleanup()
      await runtime.host.dispose()
    }
  })

  it.each(['catalog', 'import state'])('does not reconcile a late %s response after cleanup', async phase => {
    const { runtime, rendererHost, list, listRules, setup } = createHarness()
    const catalog = deferred<{ items: ManagedClientExtensionPackage[] }>()
    const rules = deferred<{ rules: [] }>()
    if (phase === 'catalog') list.mockReturnValueOnce(catalog.promise)
    else listRules.mockReturnValueOnce(rules.promise)
    const reconcile = vi.spyOn(runtime.host, 'reconcile')
    const cleanup = setup() as () => void
    await drainTasks()
    cleanup()
    catalog.resolve({ items: [extensionPackage] })
    rules.resolve({ rules: [] })
    await drainTasks()

    expect(reconcile).not.toHaveBeenCalled()
    expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    expect(hooks.setters.every(set => set.mock.calls.length === 0)).toBe(true)
    await runtime.host.dispose()
  })

  it('ignores the previous Effect response while allowing the same Host to activate on setup replay', async () => {
    const { runtime, rendererHost, list, setup } = createHarness()
    const previous = deferred<{ items: ManagedClientExtensionPackage[] }>()
    list.mockReturnValueOnce(previous.promise)
    const reconcile = vi.spyOn(runtime.host, 'reconcile')
    const cleanupPrevious = setup() as () => void
    cleanupPrevious()
    const cleanupCurrent = setup() as () => void
    try {
      await drainTasks()
      expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
      expect(runtime.host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])
      previous.resolve({ items: [] })
      await drainTasks()
      expect(reconcile).toHaveBeenCalledTimes(1)
      expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
      expect(hooks.loadModule).toHaveBeenCalledTimes(1)
    } finally {
      cleanupCurrent()
      await runtime.host.dispose()
    }
    expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
  })

  it('does not publish an error from a request rejected after cleanup', async () => {
    const { runtime, list, setup } = createHarness()
    const catalog = deferred<{ items: ManagedClientExtensionPackage[] }>()
    list.mockReturnValueOnce(catalog.promise)
    const cleanup = setup() as () => void
    cleanup()
    catalog.reject(new Error('late catalog failure'))
    await drainTasks()

    expect(hooks.setters.every(set => set.mock.calls.length === 0)).toBe(true)
    await runtime.host.dispose()
  })
})
