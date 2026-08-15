import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host cleanup contract', () => {
  it('cleans partial rpc registrations after activation failure', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('partial-failure-extension', {
      manifest: manifest('example.partialFailure', [{ name: 'example.partialFailure.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.partialFailure.echo', () => ({ ok: true })); throw new Error('boom') }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.partialFailure', 'server')

    expect(summary.state).toBe('disabled')
    await expect(kernel.callRpc('example.partialFailure.echo', {})).rejects.toThrow('method not found')
  })

  it('dispose cleans extension rpc registrations', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activate('example.echo', 'server')

    await extensionHost.dispose('example.echo', 'server')

    await expect(kernel.callRpc('example.echo.echo', {})).rejects.toThrow('method not found')
  })
})
