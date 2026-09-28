import { extensionInstallationId, type ClientExtensionModule } from '@loom-studio/extension-sdk'
import { createMemoryLogSink, createRootLogger, queryExtensionLogs } from '@loom-studio/logging'
import { describe, expect, it, vi } from 'vitest'
import { createClientExtensionHost, type ClientExtensionDataApi, type ManagedClientExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientExtensionDataApi, mapPackageImportState } from '../../../apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { useAppearanceStore } from '../../../apps/studio-client/src/shared/studio-shell/appearance-store.js'

function extensionPackage(enabled = true): ManagedClientExtensionPackage {
  return {
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
      desired: { enabled },
      contributions: {
        renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' }],
      },
    }],
  }
}

describe('Client Extension Host', () => {
  it('fixes Config and Record request ownership to the host installation', async () => {
    const listConfigs = vi.fn(async () => ({ configs: [] }))
    const listRecords = vi.fn(async () => ({ records: [] }))
    const data = createClientExtensionDataApi({
      extensionRuntime: { listConfigs, listRecords },
    } as unknown as Parameters<typeof createClientExtensionDataApi>[0])
    const target = { kind: 'card' as const, cardId: 'a' }
    const query = { packageId: 'forged', target: { kind: 'card', cardId: 'b' } }
    await data.configs.list('example.client', query as never, target)
    await data.records.list('example.client', query as never, target)
    expect(listConfigs).toHaveBeenLastCalledWith({ packageId: 'example.client', target })
    expect(listRecords).toHaveBeenLastCalledWith({ packageId: 'example.client', target })
    await data.configs.list('example.client', query as never)
    expect(listConfigs).toHaveBeenLastCalledWith({ packageId: 'example.client', target: { kind: 'global' } })
    expect(data.assets.url('asset-1', { packageId: 'example.client', moduleId: 'client', target }))
      .toBe('/extension-assets/example.client/client/a/asset-1')
    expect(data.assets.url('asset-1')).toBe('/assets/asset-1')
  })
  it('loads only the current Card and releases its commands and background without changing global preferences', async () => {
    const contexts = new Map<string, Parameters<ClientExtensionModule['activate']>[0]>()
    const loadModule = vi.fn(async () => ({
      activate: (context: Parameters<ClientExtensionModule['activate']>[0]) => {
        contexts.set(context.files.url('wallpaper.png'), context)
        context.renderers.register({
          id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline',
        }, { mount: () => ({ dispose() {} }) })
        context.backgrounds.register({ id: 'scene', name: 'Scene', description: 'Scene', image: context.files.url('wallpaper.png') })
        context.commands.register('ping', vi.fn())
      },
    }))
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'a' })
    const originalBackground = useAppearanceStore.getState().background
    const configList = vi.fn(async () => [])
    const host = createClientExtensionHost({
      rendererHost, loadModule,
      data: { configs: { list: configList } } as unknown as ClientExtensionDataApi,
      appearance: {
        setBackground: useAppearanceStore.getState().setBackground,
        scoped: { set: useAppearanceStore.getState().setScopedBackground, clear: useAppearanceStore.getState().clearScopedBackground },
      },
    })
    const global = extensionPackage()
    global.modules[0]!.contributions.commands = [{ id: 'ping', title: 'Ping' }]
    global.modules[0]!.contributions.actions = [{ commandId: 'ping', surface: 'composer.quick-actions' }]
    const a = { ...global, archiveDigest: 'a'.repeat(64), target: { kind: 'card' as const, cardId: 'a' } }
    const b = { ...global, archiveDigest: 'b'.repeat(64), target: { kind: 'card' as const, cardId: 'b' } }
    try {
      await host.reconcile([global, a, b])
      expect(loadModule).toHaveBeenCalledTimes(2)
      expect(host.summaries()).toHaveLength(2)
      expect(host.summaries().find(item => !item.target)?.state).toBe('active')
      expect(host.summaries().filter(item => item.target?.kind === 'card')).toEqual([
        expect.objectContaining({ state: 'active', target: a.target }),
      ])
      const aUrl = `/card-extensions/a/example.client/1.0.0/${a.archiveDigest}/files/wallpaper.png`
      const aContext = contexts.get(aUrl)!
      await aContext.configs.list({ scope: { kind: 'card', cardId: 'a' } })
      expect(configList).toHaveBeenCalledWith('example.client', { scope: { kind: 'card', cardId: 'a' } }, a.target)
      expect(aContext.backgrounds.activate('scene')).toBe(true)
      expect(useAppearanceStore.getState().scopedBackground).toMatchObject({ cardId: 'a', image: aUrl })
      expect(useAppearanceStore.getState().background).toEqual(originalBackground)
      expect(host.commandRegistrations()).toEqual(expect.arrayContaining([
        expect.objectContaining({ packageId: 'example.client', moduleId: 'client', commandId: 'ping', target: a.target }),
      ]))
      rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'b' })
      expect(aContext.backgrounds.activate('scene')).toBe(false)
      await expect(host.executeCommand({ packageId: 'example.client', moduleId: 'client', commandId: 'ping', sourceSurface: 'composer.quick-actions', target: a.target }))
        .resolves.toMatchObject({ status: 'failed', code: 'command.disabled' })
      await host.reconcile([global, b])
      expect(loadModule).toHaveBeenCalledTimes(3)
      expect(host.summaries()).toHaveLength(2)
      expect(host.summaries().find(item => !item.target)?.state).toBe('active')
      expect(useAppearanceStore.getState().scopedBackground).toBeNull()
      expect(useAppearanceStore.getState().background).toEqual(originalBackground)
      expect(host.backgrounds().every(item => item.target?.kind !== 'card' || item.target.cardId === 'b')).toBe(true)
      expect(() => aContext.backgrounds.activate('scene')).toThrow()
    } finally {
      await host.dispose()
      useAppearanceStore.setState({ background: originalBackground, scopedBackground: null })
    }
  })

  it('starts an enabled background-only Card module without requiring a dummy renderer', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'a' })
    const installed = { ...extensionPackage(), target: { kind: 'card' as const, cardId: 'a' }, archiveDigest: 'a'.repeat(64) }
    installed.modules[0]!.contributions = {}
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({ activate: context => context.backgrounds.register({
        id: 'scene', name: 'Scene', description: 'Scene', image: context.files.url('scene.png'),
      }) }),
    })
    await host.reconcile([installed])
    expect(host.summaries()[0]?.state).toBe('active')
    expect(host.backgrounds()).toHaveLength(1)
    await host.dispose()
    expect(host.backgrounds()).toEqual([])
  })

  it('requires declaration and grant, and revokes captured notification contexts on grant changes', async () => {
    const notify = vi.fn()
    const contexts: Parameters<ClientExtensionModule['activate']>[0][] = []
    const host = createClientExtensionHost({
      rendererHost: createClientRendererHost(),
      notify,
      loadModule: async () => ({ activate: context => { contexts.push(context) } }),
    })
    const pkg = extensionPackage()
    await host.reconcile([pkg])
    await expect(contexts[0]!.notifications.show({ message: 'Denied' })).rejects.toMatchObject({ code: 'capability.denied' })
    pkg.modules[0]!.requestedUiCapabilities = ['ui.notify']
    pkg.modules[0]!.desired.grants = { ui: ['ui.notify'] }
    await host.reconcile([pkg])
    const granted = contexts.at(-1)!
    await granted.notifications.show({ message: 'Ready' })
    expect(notify).toHaveBeenCalledWith('extension:example.client/client', { message: 'Ready' })
    pkg.modules[0]!.desired.grants = { ui: [] }
    await host.reconcile([pkg])
    await expect(granted.notifications.show({ message: 'Stale' })).rejects.toThrow()
    await expect(contexts.at(-1)!.notifications.show({ message: 'Denied' })).rejects.toMatchObject({ code: 'capability.denied' })
    expect(notify).toHaveBeenCalledOnce()
    await host.dispose()
  })
  it('collects client extension events with host identity and limits queries to this host and package', async () => {
    const memory = createMemoryLogSink({ capacity: 50 })
    const root = createRootLogger({ service: 'studio-client', instanceId: 'client-test', sinks: [memory] })
    let context!: Parameters<ClientExtensionModule['activate']>[0]
    const host = createClientExtensionHost({
      rendererHost: createClientRendererHost(),
      logger: root.child('extension.loader'),
      queryLogs: (packageId, input) => queryExtensionLogs({ current: memory }, packageId, input, 'client'),
      loadModule: async () => ({ activate: value => {
        context = value
        value.logger.child('sync').log('info', 'sync done', { event: 'sync.completed', data: { packageId: 'forged' } })
      } }),
    })
    await host.reconcile([extensionPackage()])
    const page = await context.logs.query({ limit: 20 })
    expect(page.sources).toEqual(['client'])
    expect(page.items.some(record => record.message === 'sync done' && record.extension?.packageId === 'example.client')).toBe(true)
    expect(page.items.some(record => record.event === 'extension.activation.started')).toBe(true)
    await expect(context.logs.query({ limit: 20, packageId: 'other' } as never)).rejects.toThrow('cannot set')
    await host.dispose()
    expect(() => context.logs.query({ limit: 20 })).toThrow()
  })
  it('maps Package declarations to imported resource provenance without treating modules as resources', () => {
    const target = { kind: 'card' as const, cardId: 'a' }
    const [mapped, privateMapped] = mapPackageImportState([extensionPackage(), { ...extensionPackage(), target }], [
      { origin: { kind: 'extension-package', packageId: 'example.client', contributionId: 'rule' } },
      { origin: { kind: 'extension-package', packageId: 'example.client', contributionId: 'private-rule',
        installationId: extensionInstallationId('example.client', target) } },
    ], [
      { origin: { kind: 'extension-package', packageId: 'other.client', contributionId: 'extractor' } },
    ])
    expect(mapped?.importedResources).toEqual({
      transformRuleContributionIds: ['rule'],
      textExtractorContributionIds: [],
    })
    expect(mapped?.modules).toEqual(extensionPackage().modules)
    expect(privateMapped?.importedResources).toEqual({ transformRuleContributionIds: ['private-rule'], textExtractorContributionIds: [] })
  })

  it('activates declared Renderer contributions and disposes them when disabled', async () => {
    const rendererHost = createClientRendererHost()
    const module: ClientExtensionModule = {
      activate: context => context.renderers.register(
        { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
        { mount: vi.fn() },
      ),
    }
    const host = createClientExtensionHost({ rendererHost, loadModule: async () => module })
    await host.reconcile([extensionPackage()])
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])

    await host.reconcile([extensionPackage(false)])
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(0)
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'inactive' })])
  })

  it.each(['disable', 'dispose'])('cleans every module registration despite throwing disposers during %s', async action => {
    const rendererHost = createClientRendererHost()
    const listConfigs = vi.fn(async () => [])
    const configHandler = vi.fn()
    const dispose = vi.fn((moduleId: string) => { throw new Error(`${moduleId} cleanup failed`) })
    const data: ClientExtensionDataApi = {
      configs: { list: listConfigs, get: async () => null, upsert: async () => { throw new Error('not used') } },
      records: { list: async () => [], get: async () => null },
      state: { get: async () => { throw new Error('not used') } },
      history: { project: async () => ({}), extract: async () => ({}) },
      rpc: { call: async () => ({}) },
      assets: { url: assetId => `/assets/${assetId}` },
    }
    const packageWithModules = extensionPackage()
    packageWithModules.modules = ['first', 'second'].map(moduleId => ({
      ...packageWithModules.modules[0]!,
      moduleId,
      contributions: {
        ...packageWithModules.modules[0]!.contributions,
        commands: [{ id: 'ping', title: 'Ping' }],
      },
    }))
    const host = createClientExtensionHost({
      rendererHost,
      data,
      loadModule: async () => ({
        activate: context => {
          context.renderers.register(
            { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
          context.commands.register('ping', vi.fn())
          context.configs.subscribe({}, configHandler)
          return { dispose: () => dispose(context.extension.moduleId) }
        },
      }),
    })
    await host.reconcile([packageWithModules])
    await host.notifyConfigsChanged()
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(2)
    expect(host.commandRegistrations()).toHaveLength(2)
    expect(configHandler).toHaveBeenCalledTimes(2)

    if (action === 'disable') {
      const disabled = structuredClone(packageWithModules)
      for (const module of disabled.modules) module.desired.enabled = false
      await host.reconcile([disabled])
    } else {
      await host.dispose()
    }
    await host.dispose()
    await host.notifyConfigsChanged()

    expect(dispose).toHaveBeenCalledTimes(2)
    expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    expect(host.commandRegistrations()).toEqual([])
    expect(listConfigs).toHaveBeenCalledTimes(2)
    expect(configHandler).toHaveBeenCalledTimes(2)
    expect(host.summaries()).toEqual(['first', 'second'].map(moduleId => expect.objectContaining({
      moduleId,
      state: 'inactive',
      error: expect.stringContaining(`${moduleId} cleanup failed`),
    })))
    expect(host.diagnostics()).toEqual(expect.arrayContaining(['first', 'second'].map(moduleId => expect.objectContaining({
      code: 'client-extension.disposal_failed',
      moduleId,
      message: expect.stringContaining(`${moduleId} cleanup failed`),
    }))))
  })

  it('preserves activation failure diagnostics when cleanup also fails', async () => {
    const rendererHost = createClientRendererHost()
    const register = rendererHost.register
    vi.spyOn(rendererHost, 'register').mockImplementation(input => {
      const handle = register(input)
      return { dispose: async () => {
        await handle.dispose()
        throw new Error('renderer cleanup failed')
      } }
    })
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => {
          context.renderers.register(
            { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
          throw new Error('activation failed')
        },
      }),
    })

    await host.reconcile([extensionPackage()])
    await host.dispose()
    expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'degraded', error: 'activation failed' })])
    expect(host.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'client-extension.activation_failed', message: 'activation failed' }),
      expect.objectContaining({ code: 'client-extension.disposal_failed', message: expect.stringContaining('renderer cleanup failed') }),
    ]))
  })

  it.each(['disable', 'reload', 'dispose'])('rejects Renderer registration by an in-flight Command after %s without blocking the next instance', async action => {
    const rendererHost = createClientRendererHost()
    let release!: () => void
    let started!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const commandStarted = new Promise<void>(resolve => { started = resolve })
    const contexts: Parameters<ClientExtensionModule['activate']>[0][] = []
    const commandPackage = extensionPackage()
    commandPackage.modules[0]!.contributions = {
      renderers: [
        { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
        { id: 'late', name: 'Late', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
      ],
      commands: [{ id: 'late', title: 'Late' }],
      actions: [{ commandId: 'late', surface: 'extension.workbench.actions' }],
    }
    const lateRenderer = commandPackage.modules[0]!.contributions.renderers![1]!
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => {
          contexts.push(context)
          context.renderers.register(commandPackage.modules[0]!.contributions.renderers![0]!, { mount: vi.fn() })
          context.commands.register('late', async () => {
            started()
            await pending
            context.renderers.register(lateRenderer, { mount: vi.fn() })
          })
        },
      }),
    })
    await host.reconcile([commandPackage])
    const execution = host.executeCommand({
      packageId: 'example.client',
      moduleId: 'client',
      commandId: 'late',
      sourceSurface: 'extension.workbench.actions',
    })
    await commandStarted
    if (action === 'disable') {
      const disabled = structuredClone(commandPackage)
      disabled.modules[0]!.desired.enabled = false
      await host.reconcile([disabled])
    } else if (action === 'reload') {
      await host.reconcile([commandPackage], { reload: ['example.client/client'] })
    } else {
      await host.dispose()
    }
    expect(contexts[0]!.signal.aborted).toBe(true)
    release()
    await expect(execution).resolves.toMatchObject({ status: 'failed', code: 'command.execution_failed' })
    expect(rendererHost.list('narrative.timeline.tail').some(renderer => renderer.contributionId === 'late')).toBe(false)

    if (action !== 'reload') await host.reconcile([commandPackage])
    expect(contexts).toHaveLength(2)
    expect(contexts[1]!.signal.aborted).toBe(false)
    contexts[1]!.renderers.register(lateRenderer, { mount: vi.fn() })
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(2)
    await host.dispose()
    await host.dispose()
    expect(rendererHost.list('narrative.timeline.tail')).toEqual([])
    expect(host.commandRegistrations()).toEqual([])
  })

  it('reloads with a new instance and does not retain duplicate registrations', async () => {
    const rendererHost = createClientRendererHost()
    const activate = vi.fn((context: Parameters<ClientExtensionModule['activate']>[0]) => context.renderers.register(
      { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
      { mount: vi.fn() },
    ))
    const host = createClientExtensionHost({ rendererHost, loadModule: async () => ({ activate }) })
    await host.reconcile([extensionPackage()])
    const firstInstanceId = host.summaries()[0]?.instanceId
    await host.reconcile([extensionPackage()], { reload: ['example.client/client'] })
    expect(activate).toHaveBeenCalledTimes(2)
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(1)
    expect(host.summaries()[0]?.instanceId).not.toBe(firstInstanceId)
  })

  it('clears a previous activation failure after a successful retry', async () => {
    const rendererHost = createClientRendererHost()
    let shouldFail = true
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => {
          if (shouldFail) throw new Error('temporary load failure')
          return context.renderers.register(
            { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
        },
      }),
    })

    await host.reconcile([extensionPackage()])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'degraded' })])
    expect(host.diagnostics()).toHaveLength(1)

    shouldFail = false
    await host.reconcile([extensionPackage()])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])
    expect(host.diagnostics()).toEqual([])
  })

  it('degrades only the failing module and reports undeclared runtime registration', async () => {
    const rendererHost = createClientRendererHost()
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => context.renderers.register(
          { id: 'other', name: 'Other', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
          { mount: vi.fn() },
        ),
      }),
    })
    await host.reconcile([extensionPackage()])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'degraded' })])
    expect(host.diagnostics()).toEqual([expect.objectContaining({ code: 'client-extension.activation_failed' })])
    expect(rendererHost.list('narrative.timeline.tail')).toHaveLength(0)
  })

  it('binds Package-owned data sources and rejects RPC outside the Package namespace', async () => {
    const rendererHost = createClientRendererHost()
    const list = vi.fn(async () => [])
    const call = vi.fn(async () => ({ ok: true }))
    const data: ClientExtensionDataApi = {
      configs: { list: async () => [], get: async () => null, upsert: async () => { throw new Error('not used') } },
      records: { list, get: async () => null },
      state: { get: async target => ({ scopeId: 'global', target, revisionId: 'rev-1', value: {}, createdAt: '2026-08-29T00:00:00.000Z' }) },
      history: { project: async () => ({}), extract: async () => ({}) },
      rpc: { call },
      assets: { url: assetId => `/assets/${assetId}` },
    }
    const host = createClientExtensionHost({
      rendererHost,
      data,
      loadModule: async () => ({
        activate: async context => {
          await context.records.list({ recordType: 'image' })
          expect(context.assets.url('asset 1')).toBe('/assets/asset 1')
          await context.rpc.call('example.client.refresh', {})
          await expect(context.rpc.call('application.getCard', {})).rejects.toThrow('must use package namespace')
          return context.renderers.register(
            { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
        },
      }),
    })

    await host.reconcile([extensionPackage()])
    expect(list).toHaveBeenCalledWith('example.client', { recordType: 'image' }, { kind: 'global' })
    expect(call).toHaveBeenCalledWith('example.client.refresh', {}, { packageId: 'example.client', target: { kind: 'global' } })
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])
  })

  it('delivers only committed Config snapshots and disposes subscriptions with the module', async () => {
    const rendererHost = createClientRendererHost()
    let configs = [{
      id: 'config-1',
      packageId: 'example.client',
      scope: { kind: 'global' as const },
      key: 'enabled',
      value: true,
      version: 1,
      createdAt: '2026-09-14T00:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
    }]
    const listConfigs = vi.fn(async () => configs)
    const handler = vi.fn()
    const data: ClientExtensionDataApi = {
      configs: { list: listConfigs, get: async () => configs[0] ?? null, upsert: async () => configs[0]! },
      records: { list: async () => [], get: async () => null },
      state: { get: async target => ({ scopeId: 'global', target, revisionId: 'rev-1', value: {}, createdAt: '2026-08-29T00:00:00.000Z' }) },
      history: { project: async () => ({}), extract: async () => ({}) },
      rpc: { call: async () => ({}) },
      assets: { url: assetId => `/assets/${assetId}` },
    }
    const host = createClientExtensionHost({
      rendererHost,
      data,
      loadModule: async () => ({
        activate: context => {
          const subscription = context.configs.subscribe({ scope: { kind: 'global' } }, handler)
          const renderer = context.renderers.register(
            { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
          return { dispose: async () => { await subscription.dispose(); await renderer.dispose() } }
        },
      }),
    })

    await host.reconcile([extensionPackage()])
    await host.notifyConfigsChanged()
    expect(handler).toHaveBeenCalledWith(configs)
    await host.notifyConfigsChanged()
    expect(handler).toHaveBeenCalledTimes(1)

    configs = [{ ...configs[0]!, value: false, version: 2 }]
    await host.notifyConfigsChanged()
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith(configs)

    await host.reconcile([extensionPackage(false)])
    configs = [{ ...configs[0]!, version: 3 }]
    await host.notifyConfigsChanged()
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('lets an Extension explicitly claim the Workspace background without an active Timeline', async () => {
    const rendererHost = createClientRendererHost()
    const packageWithBackground: ManagedClientExtensionPackage = {
      ...extensionPackage(),
      modules: [{
        ...extensionPackage().modules[0]!,
        contributions: {
          renderers: [{ id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' }],
        },
      }],
    }
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => {
          const handle = context.renderers.register(
            { id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' },
            { mount: vi.fn() },
          )
          expect(context.renderers.open('background')).toBe(true)
          return handle
        },
      }),
    })
    await host.reconcile([packageWithBackground])
    expect(rendererHost.activeContributionKey('shell.background', 'workspace')).toBe('extension:example.client/client/background')
  })

  it('returns false instead of throwing when a Renderer has no active scope', async () => {
    const rendererHost = createClientRendererHost()
    const packageWithSheet: ManagedClientExtensionPackage = {
      ...extensionPackage(),
      modules: [{
        ...extensionPackage().modules[0]!,
        contributions: {
          renderers: [{ id: 'sheet', name: 'Sheet', surface: 'composer.sheet', instanceScope: 'timeline' }],
        },
      }],
    }
    const host = createClientExtensionHost({
      rendererHost,
      loadModule: async () => ({
        activate: context => {
          const handle = context.renderers.register(
            { id: 'sheet', name: 'Sheet', surface: 'composer.sheet', instanceScope: 'timeline' },
            { mount: vi.fn() },
          )
          expect(context.renderers.open('sheet')).toBe(false)
          expect(() => context.renderers.close('sheet')).not.toThrow()
          return handle
        },
      }),
    })

    await host.reconcile([packageWithSheet])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])
    expect(rendererHost.activeClaims()).toEqual([])
  })

  it('keeps manifest-declared Command-only modules lazy until the first invocation', async () => {
    const rendererHost = createClientRendererHost()
    rendererHost.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-1' })
    const handler = vi.fn()
    const loadModule = vi.fn(async () => ({
      activate: (context: Parameters<ClientExtensionModule['activate']>[0]) => context.commands.register('ping', handler),
    }))
    const commandPackage: ManagedClientExtensionPackage = {
      ...extensionPackage(),
      modules: [{
        ...extensionPackage().modules[0]!,
        contributions: {
          commands: [{ id: 'ping', title: 'Ping' }],
          actions: [{ commandId: 'ping', surface: 'composer.quick-actions' }],
        },
      }],
    }
    const host = createClientExtensionHost({ rendererHost, loadModule })

    await host.reconcile([commandPackage])
    expect(loadModule).not.toHaveBeenCalled()
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'inactive' })])
    expect(host.commandRegistrations()).toEqual([])

    await expect(host.executeCommand({
      packageId: 'example.client',
      moduleId: 'client',
      commandId: 'ping',
      sourceSurface: 'extension.workbench.actions',
    })).resolves.toEqual(expect.objectContaining({ status: 'failed', code: 'command.placement_not_found' }))
    expect(loadModule).not.toHaveBeenCalled()

    const context = {
      sourceSurface: 'composer.quick-actions' as const,
      workspaceId: 'workspace',
      timelineId: 'timeline-1',
    }
    await expect(host.executeCommand({
      packageId: 'example.client',
      moduleId: 'client',
      commandId: 'ping',
      sourceSurface: 'composer.quick-actions',
    })).resolves.toEqual({ status: 'completed' })
    expect(loadModule).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(context)
    expect(host.commandRegistrations()).toEqual([expect.objectContaining({ commandId: 'ping' })])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])

    const firstInstanceId = host.commandRegistrations()[0]?.instanceId
    await host.reconcile([commandPackage], { reload: ['example.client/client'] })
    expect(loadModule).toHaveBeenCalledTimes(2)
    expect(host.commandRegistrations()).toHaveLength(1)
    expect(host.commandRegistrations()[0]?.instanceId).not.toBe(firstInstanceId)

    const disabledPackage = structuredClone(commandPackage)
    disabledPackage.modules[0]!.desired.enabled = false
    await host.reconcile([disabledPackage])
    expect(host.commandRegistrations()).toEqual([])
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'inactive' })])
  })

  it('reports a declared Command whose Handler is missing after activation', async () => {
    const rendererHost = createClientRendererHost()
    const commandPackage: ManagedClientExtensionPackage = {
      ...extensionPackage(),
      modules: [{
        ...extensionPackage().modules[0]!,
        contributions: {
          commands: [{ id: 'missing', title: 'Missing' }],
          actions: [{ commandId: 'missing', surface: 'extension.workbench.actions' }],
        },
      }],
    }
    const host = createClientExtensionHost({ rendererHost, loadModule: async () => ({ activate: () => undefined }) })
    await host.reconcile([commandPackage])

    await expect(host.executeCommand({
      packageId: 'example.client',
      moduleId: 'client',
      commandId: 'missing',
      sourceSurface: 'extension.workbench.actions',
    })).resolves.toEqual(expect.objectContaining({ status: 'failed', code: 'command.handler_missing' }))
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'degraded' })])
    expect(host.diagnostics()).toEqual([expect.objectContaining({ code: 'client-extension.command_not_registered', commandId: 'missing' })])
  })
})
