import * as cardMedia from '../../../apps/studio-client/src/shared/lib/card-media.js'
import type { EffectCallback } from 'react'
import { extensionInstallationId, type ClientExtensionModule } from '@loom-studio/extension-sdk'
import type { ListExtensionInstallationsResult, TimelineExtensionParticipation } from '../../../apps/studio-client/src/entities/extension.js'
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
  useAppearanceStore: Object.assign(() => vi.fn(), { getState: () => ({ background: null }), setState: vi.fn() }),
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

async function drainTasks(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

function createHarness() {
  const list = vi.fn(async () => ({ items: [extensionPackage] }))
  const listRuleSummaries = vi.fn(async () => ({ rules: [] }))
  const getParticipation = vi.fn<() => Promise<TimelineExtensionParticipation>>()
  const listInstallations = vi.fn<() => Promise<ListExtensionInstallationsResult>>()
  const getState = vi.fn()
  const api = {
    extensions: { list, diagnostics: async () => ({ diagnostics: [] }) },
    textTransforms: { listRuleSummaries, listExtractorSummaries: async () => ({ extractors: [] }) },
    extensionRuntime: {},
    states: { get: getState },
    timelineExtensions: { get: getParticipation },
    extensionInstallations: { list: listInstallations },
  } as unknown as Parameters<typeof useClientExtensionRuntime>[0]['api']
  const rendererHost = createClientRendererHost()
  const clientLogs = createMemoryLogSink({ capacity: 50 })
  const logger = createRootLogger({ service: 'studio-client', instanceId: 'hook-test', sinks: [clientLogs] }).child('extension.loader')
  const runtime = useClientExtensionRuntime({ api, rendererHost, logger, clientLogs, notify: vi.fn() })
  const setup = hooks.effects.at(-1)!
  return { runtime, rendererHost, list, listRuleSummaries, setup, getParticipation, listInstallations, getState }
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
  it('reports sustained disconnection but cancels the notice on reconnect or cleanup', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    class TestEvents extends EventTarget {
      static OPEN = 1
      readyState = 0
      static instance: TestEvents
      constructor() { super(); TestEvents.instance = this }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEvents)
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('document', page)
    const { runtime, setup } = createHarness()
    const cleanup = setup() as () => void
    const errors = () => hooks.setters.flatMap(setter => setter.mock.calls.map(([value]) => value))
      .filter(value => value instanceof Error && value.message === 'Extension event stream disconnected')
    try {
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      TestEvents.instance.dispatchEvent(new Event('error'))
      vi.advanceTimersByTime(1000)
      expect(errors()).toHaveLength(0)
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      vi.advanceTimersByTime(5000)
      expect(errors()).toHaveLength(0)
      TestEvents.instance.dispatchEvent(new Event('error'))
      vi.advanceTimersByTime(5000)
      expect(errors()).toHaveLength(0)
      page.visibilityState = 'hidden'
      page.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(60_000)
      expect(errors()).toHaveLength(0)
      page.visibilityState = 'visible'
      page.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(29_999)
      expect(errors()).toHaveLength(0)
      vi.advanceTimersByTime(1)
      expect(errors()).toHaveLength(1)
      TestEvents.instance.dispatchEvent(new Event('error'))
      vi.advanceTimersByTime(30_000)
      expect(errors()).toHaveLength(1)
      const connectionSetter = hooks.setters.find(setter => setter.mock.calls.some(([value]) =>
        value instanceof Error && value.message === 'Extension event stream disconnected'))!
      TestEvents.instance.dispatchEvent(new Event('open'))
      expect(connectionSetter).toHaveBeenLastCalledWith(undefined)
      TestEvents.instance.dispatchEvent(new Event('error'))
      cleanup()
      vi.advanceTimersByTime(30_000)
      expect(errors()).toHaveLength(1)
    } finally { cleanup(); await runtime.host.dispose(); vi.useRealTimers() }
  })

  it('follows adoption and State through SSE, rejects changed installations and stops on disconnect', async () => {
    class TestEvents extends EventTarget {
      static OPEN = 1
      readyState = 0
      static instance: TestEvents
      onerror?: () => void
      constructor() { super(); TestEvents.instance = this }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEvents)
    const harness = createHarness()
    const { runtime, rendererHost, list, setup, getParticipation, listInstallations, getState } = harness
    const pkg = { ...extensionPackage, participation: 'timeline' as const }
    list.mockResolvedValue({ items: [pkg] })
    const target = { scope: 'timeline' as const, timelineId: 'story', branchId: 'main' }
    const installationId = extensionInstallationId(pkg.packageId, { kind: 'global' })
    const entry = { installationId, packageId: pkg.packageId, packageVersion: pkg.version, installationVersion: 1, enabled: true, generation: 'a' }
    getParticipation.mockResolvedValue({ timelineId: 'story', version: 1, entries: [] })
    listInstallations.mockResolvedValue({ installations: [{
      id: installationId, version: 1, packageId: pkg.packageId, packageVersion: pkg.version,
      participation: 'timeline', target: { kind: 'global' }, createdAt: '', updatedAt: '',
    }] })
    getState.mockResolvedValue({ snapshot: { target, scopeId: 'story:main', revisionId: 'r1', value: {}, createdAt: '' } })
    const stateChanged = vi.fn()
    const contexts: Parameters<ClientExtensionModule['activate']>[0][] = []
    hooks.loadModule.mockResolvedValue({
      activate: context => {
        contexts.push(context)
        context.renderers.register(pkg.modules[0]!.contributions.renderers![0]!, { mount() {} })
        context.state.subscribe(context.timeline.target!, stateChanged)
      },
    } satisfies ClientExtensionModule)
    rendererHost.setScopeSnapshot({ workspace: 'workspace', ...target })
    const cleanup = setup() as () => void
    try {
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(hooks.loadModule).not.toHaveBeenCalled()
      getParticipation.mockResolvedValue({ timelineId: 'story', version: 2, entries: [entry] })
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      expect(stateChanged).toHaveBeenCalledOnce()
      expect(list).toHaveBeenCalledOnce()
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      expect(stateChanged).toHaveBeenCalledOnce()
      getState.mockResolvedValue({ snapshot: { target, scopeId: 'story:main', revisionId: 'r2', value: {}, createdAt: '' } })
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(stateChanged).toHaveBeenCalledTimes(2)
      harness.listRuleSummaries.mockRejectedValueOnce(new Error('one malformed Rule'))
      await runtime.refresh()
      expect(contexts[0]!.signal.aborted).toBe(false)
      expect(runtime.host.isPackageAvailable(pkg)).toBe(true)
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      getParticipation.mockResolvedValue({ timelineId: 'story', version: 3, entries: [{ ...entry, enabled: false }] })
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(contexts[0]!.signal.aborted).toBe(true)
      expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
      getParticipation.mockResolvedValue({ timelineId: 'story', version: 4, entries: [{ ...entry, generation: 'b' }] })
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(hooks.loadModule).toHaveBeenCalledTimes(2)
      TestEvents.instance.dispatchEvent(new Event('error'))
      expect(contexts[1]!.signal.aborted).toBe(true)
      await drainTasks()
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(hooks.loadModule).toHaveBeenCalledTimes(3)
      const installations = await listInstallations()
      listInstallations.mockResolvedValue({ installations: installations.installations.map(item => ({ ...item, version: 2 })) })
      TestEvents.instance.dispatchEvent(new Event('extensions.data.changed'))
      await drainTasks()
      expect(contexts[2]!.signal.aborted).toBe(true)
      expect(runtime.host.isPackageAvailable(pkg)).toBe(false)
      expect(hooks.loadModule).toHaveBeenCalledTimes(3)
    } finally { cleanup(); await runtime.host.dispose() }
  })

  it('ignores a late adoption response for a previously selected Branch', async () => {
    const { runtime, rendererHost, list, setup, getParticipation, listInstallations } = createHarness()
    list.mockResolvedValue({ items: [{ ...extensionPackage, participation: 'timeline' }] })
    const previous = Promise.withResolvers<TimelineExtensionParticipation>()
    getParticipation.mockReturnValueOnce(previous.promise).mockResolvedValue({ timelineId: 'story', version: 2, entries: [] })
    const id = extensionInstallationId(extensionPackage.packageId, { kind: 'global' })
    listInstallations.mockResolvedValue({ installations: [{
      id, version: 1, packageId: extensionPackage.packageId, packageVersion: extensionPackage.version,
      participation: 'timeline', target: { kind: 'global' }, createdAt: '', updatedAt: '',
    }] })
    rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'main' })
    const cleanup = setup() as () => void
    try {
      await drainTasks()
      rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'fork' })
      await drainTasks()
      previous.resolve({ timelineId: 'story', version: 1, entries: [{
        installationId: id, packageId: extensionPackage.packageId, packageVersion: extensionPackage.version,
        installationVersion: 1, enabled: true, generation: 'old',
      }] })
      await drainTasks()
      expect(hooks.loadModule).not.toHaveBeenCalled()
      expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    } finally { cleanup(); await runtime.host.dispose() }
  })

  it('does not publish startup readiness from scope reconciliation before its catalog has loaded', async () => {
    const { runtime, rendererHost, list, setup } = createHarness()
    const catalog = Promise.withResolvers<{ items: ManagedClientExtensionPackage[] }>()
    list.mockReturnValueOnce(catalog.promise)
    const readiness = hooks.setters[5]!
    const publishedSequence = () => readiness.mock.calls.reduce((sequence, [update]) => update(sequence), 0)
    rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'main' })
    const cleanup = setup() as () => void
    try {
      await drainTasks()
      rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'fork' })
      await drainTasks()
      expect(publishedSequence()).toBe(0)
      catalog.resolve({ items: [extensionPackage] })
      await drainTasks()
      expect(publishedSequence()).toBeGreaterThan(0)
      expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
    } finally { cleanup(); await runtime.host.dispose() }
  })

  it('publishes startup readiness from the current participation refresh after the first is superseded', async () => {
    const { runtime, rendererHost, list, setup, getParticipation, listInstallations } = createHarness()
    list.mockResolvedValue({ items: [{ ...extensionPackage, participation: 'timeline' }] })
    const previous = Promise.withResolvers<TimelineExtensionParticipation>()
    const current = Promise.withResolvers<TimelineExtensionParticipation>()
    getParticipation.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise)
    listInstallations.mockResolvedValue({ installations: [] })
    const readiness = hooks.setters[5]!
    const publishedSequence = () => readiness.mock.calls.reduce((sequence, [update]) => update(sequence), 0)
    rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'main' })
    const cleanup = setup() as () => void
    try {
      await drainTasks()
      rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'story', branchId: 'fork' })
      await drainTasks()
      previous.resolve({ timelineId: 'story', version: 1, entries: [] })
      await drainTasks()
      expect(publishedSequence()).toBe(0)
      current.resolve({ timelineId: 'story', version: 2, entries: [] })
      await drainTasks()
      expect(publishedSequence()).toBeGreaterThan(0)
      expect(list).toHaveBeenCalledTimes(1)
    } finally { cleanup(); await runtime.host.dispose() }
  })

  it('resynchronizes catalog and configs on reconnect without reloading unchanged modules', async () => {
    class TestEvents extends EventTarget {
      static OPEN = 1
      readyState = 0
      static instance: TestEvents
      onerror?: () => void
      constructor() { super(); TestEvents.instance = this }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEvents)
    const { runtime, list, setup } = createHarness()
    const mediaChanged = vi.spyOn(cardMedia, 'invalidateCardMedia')
    const changed = vi.spyOn(runtime.host, 'notifyConfigsChanged')
    const cleanup = setup() as () => void
    try {
      await drainTasks()
      expect(hooks.loadModule).not.toHaveBeenCalled()
      expect(list).not.toHaveBeenCalled()
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(list).toHaveBeenCalledOnce()
      expect(mediaChanged).not.toHaveBeenCalled()
      expect(changed).toHaveBeenCalledOnce()
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      list.mockResolvedValueOnce({ items: [] })
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(runtime.host.summaries()).toEqual([])
      expect(changed).toHaveBeenCalledTimes(2)
      expect(mediaChanged).toHaveBeenCalledOnce()
      TestEvents.instance.dispatchEvent(new Event('directories.media.changed'))
      expect(mediaChanged).toHaveBeenCalledTimes(2)
      mediaChanged.mockRestore()
      expect(hooks.loadModule).toHaveBeenCalledOnce()
    } finally { cleanup(); await runtime.host.dispose() }
  })
  it('loads the catalog when initial SSE fails and resynchronizes on recovery', async () => {
    class TestEvents extends EventTarget {
      static OPEN = 1
      readyState = 0
      static instance: TestEvents
      constructor() { super(); TestEvents.instance = this }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEvents)
    const { runtime, list, setup } = createHarness()
    const cleanup = setup() as () => void
    try {
      TestEvents.instance.dispatchEvent(new Event('error'))
      await drainTasks()
      expect(list).toHaveBeenCalledOnce()
      expect(hooks.loadModule).toHaveBeenCalledOnce()
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(list).toHaveBeenCalledTimes(2)
      expect(hooks.loadModule).toHaveBeenCalledOnce()
    } finally { cleanup(); await runtime.host.dispose() }
  })
  it('recovers a missed same-version reload from the catalog and does not reload it twice', async () => {
    class TestEvents extends EventTarget {
      static OPEN = 1
      readyState = 0
      static instance: TestEvents
      onerror?: () => void
      constructor() { super(); TestEvents.instance = this }
      close() {}
    }
    vi.stubGlobal('EventSource', TestEvents)
    const { runtime, rendererHost, list, setup } = createHarness()
    const cleanup = setup() as () => void
    try {
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      const first = runtime.host.summaries()[0]?.instanceId
      const reloaded = { ...extensionPackage, modules: extensionPackage.modules.map(module => ({ ...module, reloadId: 'reload-1' })) }
      list.mockResolvedValue({ items: [reloaded] })
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      const second = runtime.host.summaries()[0]?.instanceId
      expect(second).not.toBe(first)
      expect(hooks.loadModule).toHaveBeenCalledTimes(2)
      expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
      TestEvents.instance.dispatchEvent(new Event('extensions.changed'))
      await drainTasks()
      TestEvents.instance.dispatchEvent(new Event('open'))
      await drainTasks()
      expect(runtime.host.summaries()[0]?.instanceId).toBe(second)
      expect(hooks.loadModule).toHaveBeenCalledTimes(2)
    } finally { cleanup(); await runtime.host.dispose() }
  })
  it('loads only the current Card catalog and ignores late responses without restarting global modules', async () => {
    const { runtime, rendererHost, list, setup } = createHarness()
    const a = Promise.withResolvers<{ items: ManagedClientExtensionPackage[] }>()
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
    const { runtime, rendererHost, list, listRuleSummaries, setup } = createHarness()
    const catalog = Promise.withResolvers<{ items: ManagedClientExtensionPackage[] }>()
    const rules = Promise.withResolvers<{ rules: [] }>()
    if (phase === 'catalog') list.mockReturnValueOnce(catalog.promise)
    else listRuleSummaries.mockReturnValueOnce(rules.promise)
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
    const previous = Promise.withResolvers<{ items: ManagedClientExtensionPackage[] }>()
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
    const catalog = Promise.withResolvers<{ items: ManagedClientExtensionPackage[] }>()
    list.mockReturnValueOnce(catalog.promise)
    const cleanup = setup() as () => void
    cleanup()
    catalog.reject(new Error('late catalog failure'))
    await drainTasks()

    expect(hooks.setters.every(set => set.mock.calls.length === 0)).toBe(true)
    await runtime.host.dispose()
  })
})


it('keeps module-free background packages in the runtime catalog', async () => {
  const { runtime, list, setup } = createHarness()
  list.mockResolvedValue({ items: [{ ...extensionPackage, modules: [], resources: {
    backgrounds: [{ id: 'scene', name: 'Scene', description: 'Scene', image: './scene.png' }],
  } }] })
  const cleanup = setup() as () => void
  try {
    await drainTasks()
    expect(runtime.host.backgrounds()).toEqual([expect.objectContaining({ key: 'example.client/scene' })])
    expect(hooks.loadModule).not.toHaveBeenCalled()
  } finally { cleanup(); await drainTasks() }
})
