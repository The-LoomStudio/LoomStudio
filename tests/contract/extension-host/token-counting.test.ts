import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'
import { countText } from '@loom-studio/tokenizer'
import { createTextTokenCounter } from '@loom-studio/tokenizer/async'

describe('extension text token counting', () => {
  it('exposes arbitrary text counting without provider or resource access', async () => {
    const { extensionHost, kernel } = createExtensionHostHarness()
    const directory = createExtensionFixture('tokens', {
      manifest: {
        manifestVersion: 2, id: 'example.tokens', version: '0.0.0', displayName: 'Tokens',
        engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js',
          contributes: { rpc: [{ name: 'example.tokens.count' }] } }],
      },
      source: `export function activate(ctx) {
        ctx.rpc.register('example.tokens.count', () => ctx.tokens.countText({text: '你好 world', multiplier: 0.6}))
      }`,
    })
    await extensionHost.discover(directory)
    await extensionHost.activate('example.tokens', 'server')
    expect(await kernel.callRpc('example.tokens.count')).toEqual(countText('你好 world', { multiplier: 0.6 }))
    await extensionHost.dispose('example.tokens', 'server')
  })
  it('rejects disposed scopes, oversized inputs and invalid multipliers', async () => {
    const abort = new AbortController()
    const counter = createTextTokenCounter(abort.signal)
    await expect(counter.countText({ text: 'x'.repeat(1_000_001) })).rejects.toThrow('limit')
    await expect(counter.countText({ text: '', multiplier: 0 })).rejects.toThrow('positive')
    abort.abort()
    await expect(counter.countText({ text: 'hello' })).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('bounds the pending queue and rejects tasks cancelled before execution', async () => {
    const abort = new AbortController()
    const counter = createTextTokenCounter(abort.signal)
    const tasks = Array.from({ length: 32 }, () => counter.countText({ text: 'queued' }))
    const results = Promise.allSettled(tasks)
    const overflow = counter.countText({ text: 'overflow' })
    abort.abort()
    await expect(overflow).rejects.toThrow('queue')
    expect((await results).every(result => result.status === 'rejected')).toBe(true)
  })
})
