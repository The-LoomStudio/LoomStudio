import { describe, expect, it, vi } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'
import { createPromptProcessorRegistry } from '@loom-studio/application-runtime'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'

describe('extension prompt and model entrypoints', () => {
  it('holds one Timeline lease through prepare/render and rejects late results after pause', async () => {
    const registry = createPromptProcessorRegistry()
    const controllers: AbortController[] = []
    const releases: ReturnType<typeof vi.fn>[] = []
    let generation = 'g1'
    const snapshot = {
      scopeId: 'scope', target: { scope: 'timeline' as const, timelineId: 'story', branchId: 'checkpoint' },
      revisionId: 'r1', value: {}, createdAt: 'now',
    }
    const readState = vi.fn<NonNullable<ExtensionHostOptions['readState']>>(async () => snapshot)
    const { extensionHost, kernel } = createExtensionHostHarness({
      readState,
      registerPromptProcessor: (processor, owner) => registry.register(processor, owner.target),
      beginTimelineWork: async input => {
        if (input.timelineId !== 'story') throw new Error('Not adopted')
        const controller = new AbortController()
        controllers.push(controller)
        const dispose = vi.fn(() => controller.abort(new Error('Finished')))
        releases.push(dispose)
        return {
          lease: { timelineId: input.timelineId, installationId: input.installationId, installationVersion: 1, generation },
          signal: AbortSignal.any([input.signal!, controller.signal]), dispose,
          run: work => work(),
        }
      },
      assertTimelineWork: async lease => {
        if (lease.generation !== generation) throw new Error('Old generation')
      },
    })
    await extensionHost.discover(createExtensionFixture('timeline-processor-lifetime', {
      manifest: {
        manifestVersion: 2, id: 'example.scoped-processor', version: '1.0.0', displayName: 'Scoped processor',
        participation: 'timeline', engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'prompt.process': true, 'state.read': true },
          contributes: { rpc: [{ name: 'example.scoped-processor.disposals' }] } }],
      },
      source: `export function activate(ctx) {
        let disposals = 0;
        ctx.rpc.register('example.scoped-processor.disposals', () => disposals);
        ctx.prompt.registerProcessor({ id: 'example.scoped-processor/text', create: async context => {
          const target = { scope: 'timeline', timelineId: context.timeline.timelineId, branchId: context.timeline.branchId };
          await ctx.state.read(target);
          return {
            prepare: async () => { await ctx.state.read(target); return []; },
            render: async entry => { await ctx.state.read(target); return entry.content.toUpperCase(); },
            dispose: () => { disposals++; }
          };
        } });
      }`,
    }))
    await extensionHost.activate('example.scoped-processor', 'server')
    const context = {
      mode: 'runtime' as const, signal: new AbortController().signal,
      timeline: { timelineId: 'story', branchId: 'checkpoint', revisionId: 'r1', value: {} },
    }
    const entry = { id: 'e', sourceId: 's', sourceNodeId: 'n', kind: 'preset' as const, label: 'Text', content: 'hello' }
    try {
      await expect(registry.create('example.scoped-processor/text', { ...context, timeline: undefined })).rejects.toThrow('requires a target')
      await expect(registry.create('example.scoped-processor/text', {
        ...context, timeline: { ...context.timeline, timelineId: 'other' },
      })).rejects.toThrow('Not adopted')
      expect(readState).not.toHaveBeenCalled()
      const session = await registry.create('example.scoped-processor/text', context)
      expect(controllers[0]!.signal.aborted).toBe(false)
      await expect(session.prepare!([entry])).resolves.toEqual([])
      await expect(session.render(entry)).resolves.toBe('HELLO')
      expect(releases[0]).not.toHaveBeenCalled()
      for (const [target, owner] of readState.mock.calls) {
        expect(target).toEqual(snapshot.target)
        expect(owner.lease).toMatchObject({ generation: 'g1', timelineId: 'story' })
      }
      const pending = Promise.withResolvers<typeof snapshot>()
      readState.mockImplementationOnce(() => pending.promise)
      const late = session.render(entry)
      await vi.waitFor(() => expect(readState).toHaveBeenCalledTimes(4))
      generation = 'g2'
      controllers[0]!.abort(new Error('Paused'))
      pending.resolve(snapshot)
      await expect(late).rejects.toThrow('Paused')
      await session.dispose!()
      await session.dispose!()
      expect(releases[0]).toHaveBeenCalledOnce()
      expect(await kernel.callRpc('example.scoped-processor.disposals')).toBe(1)
      await expect(session.render(entry)).rejects.toThrow()
      const fresh = await registry.create('example.scoped-processor/text', context)
      await expect(fresh.render(entry)).resolves.toBe('HELLO')
      await fresh.dispose!()
      const factoryRead = Promise.withResolvers<typeof snapshot>()
      const calls = readState.mock.calls.length
      readState.mockImplementationOnce(() => factoryRead.promise)
      const creating = registry.create('example.scoped-processor/text', context)
      await vi.waitFor(() => expect(readState).toHaveBeenCalledTimes(calls + 1))
      controllers[2]!.abort(new Error('Paused during creation'))
      factoryRead.resolve(snapshot)
      await expect(creating).rejects.toThrow('Paused during creation')
      expect(releases[2]).toHaveBeenCalledOnce()
      expect(await kernel.callRpc('example.scoped-processor.disposals')).toBe(3)
    } finally { await extensionHost.disposeAll() }
  })

  it.each([true, false])('authorizes and unregisters prompt processors (granted: %s)', async granted => {
    const registry = createPromptProcessorRegistry()
    const registerPromptProcessor = vi.fn((processor, owner) => registry.register(processor, owner.target))
    const { extensionHost } = createExtensionHostHarness({ registerPromptProcessor })
    const directory = createExtensionFixture(`processor-${granted}`, {
      manifest: {
        manifestVersion: 2, id: 'example.processor', version: '0.0.0', displayName: 'Processor',
        engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'prompt.process': granted } }],
      },
      source: `export function activate(ctx) {
        ctx.prompt.registerProcessor({ id: 'example.processor/ejs', create: context => {
          if (context.timeline) throw new Error('State leaked without state.read')
          return { render: entry => entry.content.toUpperCase() }
        } })
      }`,
    })
    await extensionHost.discover(directory)
    if (!granted) {
      const result = await extensionHost.activate('example.processor', 'server')
      expect(result.instance?.state).toBe('activation_failed')
      expect(registerPromptProcessor).not.toHaveBeenCalled()
      return
    }
    await extensionHost.activate('example.processor', 'server')
    const context = {
      mode: 'preview' as const, signal: new AbortController().signal,
      timeline: { timelineId: 't', branchId: 'b', revisionId: 'r', value: { secret: 'not-authorized' } },
    }
    const session = await registry.create('example.processor/ejs', context)
    await expect(session.render({ id: 'e', sourceId: 's', sourceNodeId: 'n', kind: 'preset', label: 'E', content: 'hello' })).resolves.toBe('HELLO')
    await extensionHost.dispose('example.processor', 'server')
    await expect(registry.create('example.processor/ejs', context)).rejects.toThrow('unavailable')
    await expect(session.render({ id: 'e', sourceId: 's', sourceNodeId: 'n', kind: 'preset', label: 'E', content: 'again' })).rejects.toThrow()
  })
  it('binds prompt identity to the host installation and model calls to the instance signal', async () => {
    const buildPrompt = vi.fn<NonNullable<ExtensionHostOptions['buildPrompt']>>(async () => ({ messages: [{ role: 'user' as const, content: 'built' }] }))
    const invokeModel = vi.fn<NonNullable<ExtensionHostOptions['invokeModel']>>(async input => {
      expect(input.signal?.aborted).toBe(false)
      return { message: { role: 'assistant' as const, content: 'done' }, text: 'done', model: 'm', provider: 'test' }
    })
    const { extensionHost, kernel } = createExtensionHostHarness({ buildPrompt, invokeModel })
    const directory = createExtensionFixture('prompt-model', {
      manifest: {
        manifestVersion: 2, id: 'example.prompt-model', version: '0.0.0', displayName: 'Prompt model',
        engines: { studio: '^0.1.0' },
        modules: [{
          id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'ai.invoke': true },
          contributes: { rpc: [{ name: 'example.prompt-model.run' }] },
        }],
      },
      source: `export async function activate(ctx) {
        ctx.rpc.register('example.prompt-model.run', async () => {
          const built = await ctx.prompt.build({ content: [{ targetAnchorId: '@custom', content: 'hello' }] })
          const result = await ctx.ai.invokeModel({
            model: { providerProfileId: 'chosen', modelId: 'm' }, messages: built.messages,
          })
          return { text: result.text }
        })
      }`,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.prompt-model', 'server')
    await expect(kernel.callRpc('example.prompt-model.run')).resolves.toEqual({ text: 'done' })
    expect(buildPrompt).toHaveBeenCalledWith(
      { content: [{ targetAnchorId: '@custom', content: 'hello' }], signal: expect.any(AbortSignal) },
      { kind: 'global' },
      'example.prompt-model',
      undefined,
      expect.objectContaining({ moduleId: 'server', instanceId: expect.any(String), parentCallId: expect.any(String), correlationId: expect.any(String) }),
    )
    expect(invokeModel.mock.calls[0]![1]).toMatchObject({
      packageId: 'example.prompt-model', moduleId: 'server',
      parentCallId: buildPrompt.mock.calls[0]![4]!.parentCallId,
    })
    expect(invokeModel.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal)
  })

  it('denies model calls without ai.invoke', async () => {
    const invokeModel = vi.fn()
    const { extensionHost, kernel } = createExtensionHostHarness({ invokeModel })
    const directory = createExtensionFixture('prompt-model-denied', {
      manifest: {
        manifestVersion: 2, id: 'example.prompt-denied', version: '0.0.0', displayName: 'Denied',
        engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          contributes: { rpc: [{ name: 'example.prompt-denied.run' }] } }],
      },
      source: `export async function activate(ctx) {
        ctx.rpc.register('example.prompt-denied.run', () => ctx.ai.invokeModel({
          model: { providerProfileId: 'chosen', modelId: 'm' }, messages: [],
        }))
      }`,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.prompt-denied', 'server')
    await expect(kernel.callRpc('example.prompt-denied.run')).rejects.toThrow('not allowed')
    expect(invokeModel).not.toHaveBeenCalled()
  })

  it('aborts an in-flight model call when its instance is disposed', async () => {
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const invokeModel = vi.fn((input: { signal?: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      input.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      started()
    }))
    const { extensionHost, kernel } = createExtensionHostHarness({ invokeModel })
    const directory = createExtensionFixture('prompt-model-abort', {
      manifest: {
        manifestVersion: 2, id: 'example.prompt-abort', version: '0.0.0', displayName: 'Abort',
        engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          capabilities: { 'ai.invoke': true },
          contributes: { rpc: [{ name: 'example.prompt-abort.run' }] } }],
      },
      source: `export async function activate(ctx) {
        ctx.rpc.register('example.prompt-abort.run', () => ctx.ai.invokeModel({
          model: { providerProfileId: 'chosen', modelId: 'm' }, messages: [],
        }))
      }`,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.prompt-abort', 'server')
    const call = kernel.callRpc('example.prompt-abort.run')
    const failure = expect(call).rejects.toThrow('aborted')
    await entered
    await extensionHost.dispose('example.prompt-abort', 'server')
    await failure
    expect(invokeModel.mock.calls[0]![0].signal?.aborted).toBe(true)
  })
})
