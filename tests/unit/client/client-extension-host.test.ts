import type { ClientExtensionModule } from '@loom-studio/extension-sdk'
import { describe, expect, it, vi } from 'vitest'
import { createClientExtensionHost, type ClientExtensionDataApi, type ManagedClientExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'

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
    expect(list).toHaveBeenCalledWith('example.client', { recordType: 'image' })
    expect(call).toHaveBeenCalledWith('example.client.refresh', {})
    expect(host.summaries()).toEqual([expect.objectContaining({ state: 'active' })])
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
    expect(rendererHost.activeContributionKey('shell.background', 'workspace')).toBe('example.client/client/background')
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
