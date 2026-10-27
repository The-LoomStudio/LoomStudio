import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host cleanup contract', () => {
  it('cleans partial rpc registrations after activation failure', async () => {
    const { kernel, extensionHost, diagnostics } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('partial-failure-extension', {
      manifest: manifest('example.partialFailure', [{ name: 'example.partialFailure.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.partialFailure.echo', () => ({ ok: true })); throw new Error('boom') }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.partialFailure', 'server')

    expect(summary.state).toBe('disabled')
    expect(summary.instance?.state).toBe('activation_failed')
    expect(extensionHost.list()).toEqual([summary])
    expect(diagnostics.list().some(item => item.code === 'extension.activation_failed')).toBe(true)
    await expect(kernel.callRpc('example.partialFailure.echo', {})).rejects.toThrow('method not found')
    await extensionHost.dispose('example.partialFailure', 'server')
    expect(extensionHost.list()[0]).toEqual(summary)
    await kernel.stop()
  })

  it('can disable a discovered module without fabricating a runtime instance', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    try {
      const [discovered] = await extensionHost.discover(join(process.cwd(), 'tests/fixtures/extensions/echo'))
      expect(discovered.state).toBe('manifestValidated')
      expect(discovered.instance).toBeUndefined()

      await extensionHost.dispose('example.echo', 'server')
      expect(extensionHost.list()[0]).toMatchObject({ state: 'disabled' })
      expect(extensionHost.list()[0].instance).toBeUndefined()
      await expect(kernel.callRpc('example.echo.echo', {})).rejects.toThrow('method not found')
    } finally {
      await kernel.stop()
    }
  })

  it('reactivates a disposed module with a new instance and no duplicate contributions', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    try {
      const directory = createExtensionFixture('lifecycle-contract-extension', {
        manifest: manifest('example.lifecycle', [{ name: 'example.lifecycle.echo' }]),
        source: `export function activate(ctx) { ctx.rpc.register('example.lifecycle.echo', params => params) }`,
      })
      await extensionHost.discover(directory)
      const first = await extensionHost.activate('example.lifecycle', 'server')
      expect(first.state).toBe('active')
      expect(first.instance?.state).toBe('active')

      await extensionHost.dispose('example.lifecycle', 'server')
      expect(extensionHost.list()[0]).toMatchObject({
        state: 'disabled',
        instance: { instanceId: first.instance?.instanceId, state: 'disposed' },
      })
      await expect(kernel.callRpc('example.lifecycle.echo', {})).rejects.toThrow('method not found')

      const second = await extensionHost.activate('example.lifecycle', 'server')
      expect(second.state).toBe('active')
      expect(second.instance?.state).toBe('active')
      expect(second.instance?.instanceId).not.toBe(first.instance?.instanceId)
      await expect(kernel.callRpc('example.lifecycle.echo', { value: 'again' })).resolves.toEqual({ value: 'again' })
      await extensionHost.dispose('example.lifecycle', 'server')
      await expect(kernel.callRpc('example.lifecycle.echo', {})).rejects.toThrow('method not found')
    } finally {
      await extensionHost.disposeAll()
      await kernel.stop()
    }
  })

  it('forget removes the discovered module and allows a later rediscovery', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const directory = join(process.cwd(), 'tests/fixtures/extensions/echo')
    await extensionHost.discover(directory)
    await extensionHost.activate('example.echo', 'server')

    await extensionHost.forget('example.echo', 'server')

    expect(extensionHost.list()).toEqual([])
    await expect(kernel.callRpc('example.echo.echo', {})).rejects.toThrow('method not found')
    await expect(extensionHost.discover(directory)).resolves.toHaveLength(1)
  })
})
