import type { JsonValue } from '@loom-studio/shared'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host rpc registration contract', () => {
  it('activates example.echo and serves extension rpc', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    const summary = await extensionHost.activate('example.echo', 'server')

    const result = await kernel.callRpc<{ packageId: string; moduleId: string; echo: JsonValue }>('example.echo.echo', { message: 'hello' })

    expect(summary.state).toBe('active')
    expect(result).toEqual({ packageId: 'example.echo', moduleId: 'server', echo: { message: 'hello' } })
    expect(extensionHost.list()[0]?.state).toBe('active')
  })

  it('reports extension rpc ownership through system.introspect', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activate('example.echo', 'server')

    const result = await kernel.callRpc<{ methods: Array<{ name: string; owner: string }> }>('system.introspect')

    expect(result.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo/server' })
  })

  it('rejects extension registration into Kernel namespace', async () => {
    const { kernel } = createExtensionHostHarness()
    await kernel.start()

    expect(() => kernel.registerExtensionRpc('system.bad', 'example.bad', 'server', () => null)).toThrow('Kernel namespace')
  })

  it('marks duplicate rpc registration activation as disabled', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    kernel.registerExtensionRpc('example.conflict.echo', 'owner.one', 'server', () => null)
    const dir = createExtensionFixture('conflict-extension', {
      manifest: manifest('example.conflict', [{ name: 'example.conflict.echo' }]),
      source: `export function activate(ctx) { ctx.rpc.register('example.conflict.echo', () => null) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.conflict', 'server')

    expect(summary.state).toBe('disabled')
    expect(extensionHost.diagnostics('example.conflict', 'server').some(diagnostic => diagnostic.code === 'extension.activation_failed')).toBe(true)
  })

  it('marks undeclared runtime rpc registration as degraded with diagnostics', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('undeclared-extension', {
      manifest: manifest('example.undeclared', []),
      source: `export function activate(ctx) { ctx.rpc.register('example.undeclared.echo', () => ({ ok: true })) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.undeclared', 'server')

    expect(summary.state).toBe('degraded')
    expect(extensionHost.diagnostics('example.undeclared', 'server').some(diagnostic => diagnostic.code === 'extension.rpc_not_declared')).toBe(true)
  })

  it('allows Extension RPC calls but rejects Kernel namespace calls', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    kernel.registerExtensionRpc('other.target.ping', 'other.target', 'server', () => ({ ok: true }), 'target-1')
    const dir = createExtensionFixture('rpc-caller-extension', {
      manifest: manifest('example.rpcCaller', [
        { name: 'example.rpcCaller.callTarget' },
        { name: 'example.rpcCaller.callKernel' },
        { name: 'example.rpcCaller.callApplication' },
      ]),
      source: `
export function activate(ctx) {
  ctx.rpc.register('example.rpcCaller.callTarget', () => ctx.rpc.call('other.target.ping'))
  ctx.rpc.register('example.rpcCaller.callKernel', () => ctx.rpc.call('docs.list'))
  ctx.rpc.register('example.rpcCaller.callApplication', () => ctx.rpc.call('application.listCards'))
}
`,
    })

    await extensionHost.discover(dir)
    await extensionHost.activate('example.rpcCaller', 'server')

    await expect(kernel.callRpc('example.rpcCaller.callTarget')).resolves.toEqual({ ok: true })
    await expect(kernel.callRpc('example.rpcCaller.callKernel')).rejects.toThrow('cannot call Kernel namespace RPC')
    await expect(kernel.callRpc('example.rpcCaller.callApplication')).rejects.toThrow('cannot call reserved Studio namespace RPC')
  })

  it('rejects runtime registration outside the package namespace', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const dir = createExtensionFixture('foreign-rpc-extension', {
      manifest: manifest('example.foreignRpc', []),
      source: `export function activate(ctx) { ctx.rpc.register('other.package.call', () => null) }`,
    })

    await extensionHost.discover(dir)
    const summary = await extensionHost.activate('example.foreignRpc', 'server')

    expect(summary.instance?.state).toBe('activation_failed')
    await expect(kernel.callRpc('other.package.call')).rejects.toThrow('method not found')
  })
})
