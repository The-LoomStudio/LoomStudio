import { describe, expect, it, vi } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

describe('extension prompt and model entrypoints', () => {
  it('binds prompt identity to the host installation and model calls to the instance signal', async () => {
    const buildPrompt = vi.fn(async () => ({ messages: [{ role: 'user' as const, content: 'built' }] }))
    const invokeModel = vi.fn(async (input: { signal?: AbortSignal }) => {
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
      { content: [{ targetAnchorId: '@custom', content: 'hello' }] },
      { kind: 'global' },
      'example.prompt-model',
    )
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
