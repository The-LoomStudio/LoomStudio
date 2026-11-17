import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostOptions } from '@loom-studio/kernel/extension-host'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { createMacroProviderRegistry, createNarrativeContextRegistry, createStateContentRegistry } from '@loom-studio/application-runtime'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

describe('Timeline-scoped Extension execution', () => {
  it('requires a managed target for story storage while leaving global configuration editable', async () => {
    const harness = createExtensionHostHarness({
      validateStorageScope: async () => {},
      assertTimelineWork: async () => {},
      runTimelineWork: async (input, work) => work({
        lease: { ...input, installationVersion: 1, generation: 'one' }, signal: new AbortController().signal,
      }),
    })
    await harness.extensionHost.discover(createExtensionFixture('timeline-storage', {
      manifest: {
        manifestVersion: 2, id: 'example.storageScope', version: '1.0.0', displayName: 'Storage',
        participation: 'timeline', engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          contributes: { rpc: [{ name: 'example.storageScope.write' }, { name: 'example.storageScope.list' }] } }],
      },
      source: `export function activate(ctx) {
        ctx.rpc.register('example.storageScope.list', () => ctx.storage.configs.list());
        ctx.rpc.register('example.storageScope.write', p => {
          const write = () => ctx.storage.configs.upsert({ scope: p.scope, key: 'theme', value: 'green' });
          return p.managed ? ctx.timeline.run({ scope: 'timeline', timelineId: 'a', branchId: 'branch' }, write) : write();
        });
      }`,
    }))
    await harness.extensionHost.activate('example.storageScope', 'server')
    try {
      await harness.kernel.callRpc('example.storageScope.write', { scope: { kind: 'global' } })
      await expect(harness.kernel.callRpc('example.storageScope.list', {})).rejects.toThrow('explicit scope')
      await expect(harness.kernel.callRpc('example.storageScope.write', { scope: { kind: 'timeline', timelineId: 'a' } })).rejects.toThrow('ctx.timeline.run')
      await expect(harness.kernel.callRpc('example.storageScope.write', {
        managed: true, scope: { kind: 'timeline', timelineId: 'b' },
      })).rejects.toThrow('outside the current Timeline')
      await harness.kernel.callRpc('example.storageScope.write', { managed: true, scope: { kind: 'timeline', timelineId: 'a' } })
      expect((await harness.documents.list()).items).toHaveLength(2)
    } finally { await harness.extensionHost.disposeAll() }
  })

  it('excludes unadopted macro and memory sources and binds callbacks to their actual branch', async () => {
    const macros = createMacroProviderRegistry()
    const narrative = createNarrativeContextRegistry()
    const content = createStateContentRegistry()
    let enabled = true
    const readState = vi.fn<NonNullable<ExtensionHostOptions['readState']>>(async target => ({
      scopeId: 'scope', target, revisionId: 'r1', value: {}, createdAt: 'now',
    }))
    const harness = createExtensionHostHarness({
      readState,
      canRunTimelineWork: async input => enabled && input.timelineId === 'adopted',
      assertTimelineWork: async lease => {
        if (!enabled || lease.timelineId !== 'adopted') throw new Error('Paused')
      },
      runTimelineWork: async (input, work) => {
        if (!enabled || input.timelineId !== 'adopted') throw new Error('Not adopted')
        return work({ lease: { ...input, installationVersion: 1, generation: 'g1' }, signal: new AbortController().signal })
      },
      registerMacroProvider: (provider, owner) => macros.register({ ...provider, sourceLabel: owner.packageId }, owner.target, owner.isAvailable),
      registerNarrativeContextProvider: (provider, owner) => narrative.register(provider, owner.target, owner.isAvailable),
      registerStateContentHandler: (handler, owner) => content.register(handler, owner),
    })
    const directory = createExtensionFixture('timeline-context-sources', {
      manifest: {
        manifestVersion: 2, id: 'example.contexts', version: '1.0.0', displayName: 'Contexts',
        participation: 'timeline', engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'macros.provide': true, 'narrative.context.provide': true, 'state.read': true, 'state.write': true, 'state.processContent': true } }],
      },
      source: `export function activate(ctx) {
        ctx.state.registerContentHandler({
          id: 'example.contexts/update', contributionId: 'example.contexts.data', path: '/data',
          process: async input => {
            await ctx.state.read(input.target);
            return { value: { count: 1 } };
          }
        });
        ctx.macros.register({ id: 'example.contexts.tone', name: 'tone', resolve: async context => {
          await ctx.state.read({ scope: 'timeline', ...context.timelineTarget });
          return context.timelineTarget.branchId;
        } });
        ctx.narrativeContext.register({ id: 'example.contexts.memory',
          resolve: async context => {
            await ctx.state.read({ scope: 'timeline', timelineId: context.timelineId, branchId: context.branchId });
            return { version: 'v1', memory: null, rawThroughNodeId: null };
          },
          onSessionHandoff: async context => {
            await ctx.state.read({ scope: 'timeline', timelineId: context.timelineId, branchId: context.branchId });
          }
        });
      }`,
    })
    await harness.extensionHost.discover(directory)
    expect((await harness.extensionHost.activate('example.contexts', 'server')).state).toBe('active')
    const inspect = (timelineId?: string) => macros.inspect({
      snapshot: { global: {}, computed: {}, aliases: {} }, capturedAt: 'now',
      context: { global: {}, ...(timelineId ? { timelineTarget: { timelineId, branchId: 'checkpoint' } } : {}) },
    })
    const processContent = (timelineId: string) => content.process({
      text: 'advance', value: { data: { count: 0 } }, contributionIds: ['example.contexts.data'],
      target: { scope: 'timeline', timelineId, branchId: 'checkpoint' }, signal: new AbortController().signal,
    })
    try {
      expect((await inspect()).entries).toEqual([])
      expect((await inspect('other')).entries).toEqual([])
      expect(await narrative.resolve({ timelineId: 'other', branchId: 'checkpoint' })).toBeUndefined()
      expect((await processContent('other')).operations).toEqual([])
      expect(readState).not.toHaveBeenCalled()
      expect((await inspect('adopted')).entries).toMatchObject([{ name: 'tone', value: 'checkpoint', status: 'resolved' }])
      expect(await narrative.notifySessionHandoff({
        timelineId: 'adopted', branchId: 'checkpoint', agentSessionId: 's', summaryEntryId: 'entry', rawHeadNodeId: null,
      })).toBe('notified')
      expect((await processContent('adopted')).operations).toEqual([{ op: 'set', path: '/data', value: { count: 1 } }])
      expect(readState).toHaveBeenCalledTimes(4)
      for (const [target, owner] of readState.mock.calls) {
        expect(target).toEqual({ scope: 'timeline', timelineId: 'adopted', branchId: 'checkpoint' })
        expect(owner.lease).toMatchObject({ timelineId: 'adopted', generation: 'g1' })
      }
      enabled = false
      expect((await inspect('adopted')).entries).toEqual([])
      expect(await narrative.notifySessionHandoff({
        timelineId: 'adopted', branchId: 'checkpoint', agentSessionId: 's', summaryEntryId: 'entry', rawHeadNodeId: null,
      })).toBe('not-configured')
      expect((await processContent('adopted')).operations).toEqual([])
      expect(readState).toHaveBeenCalledTimes(4)
    } finally { await harness.extensionHost.disposeAll() }
  })

  it('requires managed work for State access and forwards the host-owned lease to writes', async () => {
    const installationId = extensionInstallationId('example.story', { kind: 'global' })
    const lease = { timelineId: 'timeline-a', installationId, installationVersion: 1, generation: 'adoption-1' }
    const controller = new AbortController()
    const writeState = vi.fn<NonNullable<ExtensionHostOptions['writeState']>>(async input => ({
      snapshot: { scopeId: 'scope-a', target: input.target, revisionId: 'r2', value: {}, createdAt: 'now' },
      changesetId: 'change-a',
    }))
    const assertTimelineWork = vi.fn<NonNullable<ExtensionHostOptions['assertTimelineWork']>>(async incoming => {
      expect(incoming).toEqual(lease)
      controller.signal.throwIfAborted()
    })
    const harness = createExtensionHostHarness({
      writeState,
      assertTimelineWork,
      runTimelineWork: async (input, work) => {
        expect(input.installationId).toBe(installationId)
        expect(input.timelineId).toBe('timeline-a')
        return work({ lease, signal: controller.signal })
      },
    })
    const directory = createExtensionFixture('timeline-participation', {
      manifest: {
        manifestVersion: 2, id: 'example.story', version: '1.0.0', displayName: 'Story',
        participation: 'timeline', engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'state.write': true },
          contributes: { rpc: [{ name: 'example.story.write' }] },
        }],
      },
      source: `export function activate(ctx) {
        ctx.rpc.register('example.story.write', async params => {
          const target = { scope: 'timeline', timelineId: 'timeline-a', branchId: 'branch-a' };
          const write = () => ctx.state.write({
            target: params.foreign ? { ...target, branchId: 'branch-b' } : target,
            expectedRevisionId: 'r1', operations: [{ op: 'set', path: '/memory', value: {} }]
          });
          if (params.managed) return ctx.timeline.run(target, write);
          return write();
        });
      }`,
    })
    await harness.extensionHost.discover(directory)
    await harness.extensionHost.activate('example.story', 'server')
    try {
      await expect(harness.kernel.callRpc('example.story.write', {})).rejects.toThrow()
      expect(writeState).not.toHaveBeenCalled()
      await expect(harness.kernel.callRpc('example.story.write', { managed: true, foreign: true })).rejects.toThrow()
      expect(writeState).not.toHaveBeenCalled()
      await harness.kernel.callRpc('example.story.write', { managed: true })
      expect(writeState).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        packageId: 'example.story', lease,
      }))
      controller.abort(new Error('Paused'))
      await expect(harness.kernel.callRpc('example.story.write', { managed: true })).rejects.toThrow('Paused')
      expect(writeState).toHaveBeenCalledTimes(1)
    } finally { await harness.extensionHost.dispose('example.story', 'server') }
  })
})
