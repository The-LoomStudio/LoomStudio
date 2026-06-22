import type { JsonValue } from '@loom-studio/shared'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host rpc registration contract', () => {
  it('activates example.echo and serves extension rpc', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    const summary = await extensionHost.activate('example.echo')

    const result = await kernel.callRpc<{ extensionId: string; echo: JsonValue }>('example.echo.echo', { message: 'hello' })

    expect(summary.state).toBe('active')
    expect(result).toEqual({ extensionId: 'example.echo', echo: { message: 'hello' } })
    expect(extensionHost.list()[0]?.state).toBe('active')
  })

  it('reports extension rpc ownership through system.introspect', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activate('example.echo')

    const result = await kernel.callRpc<{ methods: Array<{ name: string; owner: string }> }>('system.introspect')

    expect(result.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo' })
  })

  it('rejects extension registration into Kernel namespace', async () => {
    const { kernel } = createExtensionHostHarness()
    await kernel.start()

    expect(() => kernel.registerExtensionRpc('system.bad', 'example.bad', () => null)).toThrow('Kernel namespace')
  })

  it('marks duplicate rpc registration activation as disabled', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    kernel.registerExtensionRpc('example.conflict.echo', 'owner.one', () => null)
    const dir = createExtensionFixture('conflict-extension', {
      manifest: manifest('example.conflict', [{ name: 'example.conflict.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.conflict.echo', () => null) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.conflict')

    expect(summary.state).toBe('disabled')
    expect(extensionHost.diagnostics('example.conflict').some(diagnostic => diagnostic.code === 'extension.activation_failed')).toBe(true)
  })

  it('marks undeclared runtime rpc registration as degraded with diagnostics', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('undeclared-extension', {
      manifest: manifest('example.undeclared', []),
      source: `export function activate(ctx) { ctx.rpc.register('example.undeclared.echo', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.undeclared')

    expect(summary.state).toBe('degraded')
    expect(extensionHost.diagnostics('example.undeclared').some(diagnostic => diagnostic.code === 'extension.rpc_not_declared')).toBe(true)
  })
})
