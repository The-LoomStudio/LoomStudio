import { describe, expect, it } from 'vitest'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { StudioEvent } from '@loom-studio/transport'
import { createEventBus } from '@loom-studio/kernel'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('Installed Extension events', () => {
  it('does not let one subscriber rewrite the event delivered to another', () => {
    const bus = createEventBus()
    const owner = { kind: 'extension' as const, packageId: 'example.copy', moduleId: 'server', instanceId: 'one' }
    bus.registerDefinition({
      name: 'example.copy.changed', owner, version: 1,
      visibility: 'public', summary: 'Changed', stability: 'experimental',
    }, owner)
    const observed: StudioEvent[] = []
    bus.subscribe(['example.copy.changed'], event => {
      event.payload = { private: 'rewritten' }
      event.meta.source = 'rewritten'
    })
    bus.subscribe(['example.copy.changed'], event => { observed.push(event) })
    const published = bus.emit('example.copy.changed', { original: true }, { publisher: owner })
    expect(observed[0]).toEqual(published)
    expect(published.payload).toEqual({ original: true })
    expect(published.meta.source).not.toBe('rewritten')
  })

  it('checks capabilities against only the matching installation, including late definitions', () => {
    const bus = createEventBus()
    const packageId = 'example.scoped'
    const name = `${packageId}.changed`
    const a = { kind: 'extension' as const, packageId, moduleId: 'server', instanceId: 'A', target: { kind: 'card' as const, cardId: 'A' } }
    const b = { ...a, instanceId: 'B', target: { kind: 'card' as const, cardId: 'B' } }
    const received: string[] = []
    bus.subscribe([name], () => { received.push('late-denied') }, { subscriber: { ...b, capabilities: [] } })
    const definition = {
      name, owner: { kind: 'extension' as const, packageId, moduleId: 'server' },
      version: 1, summary: 'Changed', stability: 'experimental' as const,
    }
    bus.registerDefinition({ ...definition, visibility: 'public' }, a)
    bus.registerDefinition({ ...definition, visibility: 'protected', capability: 'extension:example.scoped' }, b)
    bus.subscribe([name], () => { received.push('A') }, { subscriber: { ...a, capabilities: [] } })
    expect(() => bus.subscribe([name], () => {}, { subscriber: { ...b, capabilities: [] } })).toThrow('not allowed')
    bus.subscribe([name], () => { received.push('B') }, { subscriber: { ...b, capabilities: ['extension:example.scoped'] } })
    bus.emit(name, {}, { publisher: a })
    bus.emit(name, {}, { publisher: b })
    expect(received).toEqual(['A', 'B'])
  })

  it('isolates same-name definitions, publishing, subscriptions and disposal by installation', async () => {
    const { kernel, extensionHost } = createExtensionHostHarness()
    await kernel.start()
    const packageId = 'example.installedEvents'
    const name = `${packageId}.changed`
    const definition = manifest(packageId, [{ name: `${packageId}.emit` }, { name: `${packageId}.read` }])
    const directory = createExtensionFixture('installed-events', {
      manifest: {
        ...definition, modules: definition.modules.map(module => ({
          ...module, contributes: {
            ...module.contributes, events: [{ name, version: 1, visibility: 'public' }],
          },
        })),
      },
      source: `
export function activate(ctx) {
  const received = []
  ctx.events.define({ name: '${name}', version: 1, visibility: 'public', summary: 'Changed', stability: 'experimental' })
  ctx.events.subscribe(['${name}'], event => { received.push(event.payload) })
  ctx.rpc.register('${packageId}.emit', input => ctx.events.emit('${name}', input))
  ctx.rpc.register('${packageId}.read', () => received)
}
`,
    })
    const targets = [{ kind: 'global' as const }, { kind: 'card' as const, cardId: 'A' }, { kind: 'card' as const, cardId: 'B' }]
    const observed: StudioEvent[] = []
    const subscription = kernel.getEventBus().subscribe([name], event => { observed.push(event) })
    try {
      for (const target of targets) {
        await extensionHost.discover(directory, target)
        expect((await extensionHost.activate(packageId, 'server', target)).state).toBe('active')
      }
      for (const [index, target] of targets.entries()) {
        await kernel.callRpc(`${packageId}.emit`, { index }, { extensionTarget: target })
      }
      for (const [index, target] of targets.entries()) {
        expect(await kernel.callRpc(`${packageId}.read`, {}, { extensionTarget: target })).toEqual([{ index }])
      }
      expect(observed.map(event => event.name)).toEqual([name, name, name])
      expect(observed.map(event => event.meta.installationId)).toEqual([
        undefined, extensionInstallationId(packageId, targets[1]!), extensionInstallationId(packageId, targets[2]!),
      ])
      expect(kernel.getEventBus().eventNames().filter(event => event === name)).toEqual([name])
      await extensionHost.dispose(packageId, 'server', targets[1])
      expect(() => kernel.getEventBus().emit(name, {}, { publisher: {
        kind: 'extension', packageId, moduleId: 'server', instanceId: 'stopped', target: targets[1],
      } })).toThrow('Event definition not registered')
      await kernel.callRpc(`${packageId}.emit`, { index: 3 }, { extensionTarget: targets[2] })
      expect(await kernel.callRpc(`${packageId}.read`, {}, { extensionTarget: targets[2] })).toEqual([{ index: 2 }, { index: 3 }])
      expect(await kernel.callRpc(`${packageId}.read`)).toEqual([{ index: 0 }])
    } finally {
      subscription.dispose()
      await kernel.stop()
    }
  })
})
