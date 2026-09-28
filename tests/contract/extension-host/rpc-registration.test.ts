import type { JsonValue } from '@loom-studio/shared'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host rpc registration contract', () => {
  it('routes same-name RPCs by Card installation without fallback and allows explicit global service calls', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const packageId = 'example.installedRpc'
    const names = ['identity', 'relay', 'globalRelay', 'missingLocal']
    const directory = createExtensionFixture('installed-rpc', {
      manifest: manifest(packageId, names.map(name => ({ name: `${packageId}.${name}` }))),
      source: `
export function activate(ctx) {
  ctx.rpc.register('example.installedRpc.identity', () => ctx.extension.instanceId)
  ctx.rpc.register('example.installedRpc.relay', () => ctx.rpc.call('example.installedRpc.identity'))
  ctx.rpc.register('example.installedRpc.globalRelay', () => ctx.rpc.call('example.installedRpc.identity', {}, { scope: 'global' }))
  ctx.rpc.register('example.installedRpc.missingLocal', () => ctx.rpc.call('example.installedRpc.globalOnly'))
}
`,
    })
    const targets = [{ kind: 'global' as const }, { kind: 'card' as const, cardId: 'A' }, { kind: 'card' as const, cardId: 'B' }]
    try {
      const instances = []
      for (const target of targets) {
        await extensionHost.discover(directory, target)
        const summary = await extensionHost.activate(packageId, 'server', target)
        expect(summary.state).toBe('active')
        instances.push(summary.instance!.instanceId)
      }
      kernel.registerExtensionRpc(`${packageId}.globalOnly`, packageId, 'server', () => 'global only', 'global-service')
      for (const [index, target] of targets.entries()) {
        expect(await kernel.callRpc('extensions.callPackageRpc', {
          packageId, target, method: `${packageId}.identity`, params: { extensionTarget: targets[2] },
        })).toBe(instances[index])
        expect(await kernel.callRpc(`${packageId}.identity`, {}, { extensionTarget: target })).toBe(instances[index])
        expect(await kernel.callRpc(`${packageId}.relay`, { extensionTarget: targets[2] }, { extensionTarget: target })).toBe(instances[index])
        expect(await kernel.callRpc(`${packageId}.globalRelay`, {}, { extensionTarget: target })).toBe(instances[0])
      }
      await expect(kernel.callRpc('extensions.callPackageRpc', {
        packageId, target: targets[1], method: `${packageId}.globalOnly`,
      })).rejects.toThrow('method not found')
      await expect(kernel.callRpc('extensions.callPackageRpc', {
        packageId: 'system', target: targets[0], method: 'system.ping',
      })).rejects.toThrow('not owned by extension')
      await expect(kernel.callRpc('extensions.callPackageRpc', {
        packageId, target: targets[0], method: 'system.ping',
      })).rejects.toThrow('package namespace')
      await expect(kernel.callRpc(`${packageId}.missingLocal`, {}, { extensionTarget: targets[1] })).rejects.toThrow('method not found')
      expect(kernel.getPublicSurface().methods.filter(method => method.name.startsWith(packageId))).toHaveLength(5)
      await extensionHost.dispose(packageId, 'server', targets[1])
      await expect(kernel.callRpc(`${packageId}.identity`, {}, { extensionTarget: targets[1] })).rejects.toThrow('method not found')
      expect(await kernel.callRpc(`${packageId}.identity`)).toBe(instances[0])
      expect(await kernel.callRpc(`${packageId}.identity`, {}, { extensionTarget: targets[2] })).toBe(instances[2])
    } finally {
      await kernel.stop()
    }
  })

  it('activates example.echo and serves extension rpc', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness({
      registerStateContribution: () => ({ dispose() {} }),
      registerMacroProvider: () => ({ dispose() {} }),
    })
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'tests/fixtures/extensions/echo'))
    const summary = await extensionHost.activate('example.echo', 'server')

    expect(summary.state, JSON.stringify(extensionHost.diagnostics('example.echo', 'server'))).toBe('active')
    const result = await kernel.callRpc<{ packageId: string; moduleId: string; echo: JsonValue }>('example.echo.echo', { message: 'hello' })

    expect(summary.state).toBe('active')
    expect(result).toEqual({ packageId: 'example.echo', moduleId: 'server', echo: { message: 'hello' } })
    expect(extensionHost.list()[0]?.state).toBe('active')
  })

  it('reports extension rpc ownership through system.introspect', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness({
      registerStateContribution: () => ({ dispose() {} }),
      registerMacroProvider: () => ({ dispose() {} }),
    })
    await kernel.start()
    await extensionHost.discover(join(process.cwd(), 'tests/fixtures/extensions/echo'))
    const summary = await extensionHost.activate('example.echo', 'server')
    expect(summary.state, JSON.stringify(extensionHost.diagnostics('example.echo', 'server'))).toBe('active')

    const result = await kernel.callRpc<{ methods: Array<{ name: string; owner: string }> }>('system.introspect')

    expect(result.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo/server' })
  })

  it('rejects extension registration into Kernel namespace', async () => {
    const { kernel } = createExtensionHostHarness()
    await kernel.start()

    expect(() => kernel.registerExtensionRpc('system.bad', 'example.bad', 'server', () => null, 'bad-1')).toThrow('Kernel namespace')
  })

  it('marks duplicate rpc registration activation as disabled', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    kernel.registerExtensionRpc('example.conflict.echo', 'owner.one', 'server', () => null, 'owner-1')
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
