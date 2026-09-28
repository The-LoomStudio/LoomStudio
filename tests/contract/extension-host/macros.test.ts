import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import { createMacroProviderRegistry } from '@loom-studio/application-runtime'
import { installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

function fixture(name: string, capability: boolean, providerId = `${name}.tone`, fail = false) {
  return createExtensionFixture(name, {
    manifest: {
      manifestVersion: 2,
      id: name,
      version: '0.0.0',
      displayName: name,
      engines: { studio: '^0.1.0' },
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        capabilities: { 'macros.provide': capability },
      }],
    },
    source: `export function activate(ctx) {
      ctx.macros.register({ id: ${JSON.stringify(providerId)}, name: 'tone', resolve: context => context.global.tone });
      ${fail ? "throw new Error('activation failed')" : ''}
    }`,
  })
}

describe('Extension macro registration', () => {
  it('isolates installed provider invocation and keeps global State out of private provider context', async () => {
    const registry = createMacroProviderRegistry()
    const resolvers = new Map<string, ReturnType<typeof vi.fn>>()
    const packageId = 'example.installedMacros'
    const authoredId = `${packageId}.tone`
    const { extensionHost } = createExtensionHostHarness({
      registerMacroProvider: (provider, owner) => {
        const resolve = vi.fn(provider.resolve)
        resolvers.set(provider.id, resolve)
        return registry.register({ ...provider, sourceLabel: owner.packageId, resolve }, owner.target)
      },
    })
    const directory = createExtensionFixture('installed-macro-context', {
      manifest: {
        manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Macros', engines: { studio: '^0.1.0' },
        modules: [{ id: 'server', runtime: 'server', entry: './dist/index.js', capabilities: { 'macros.provide': true } }],
      },
      source: `export function activate(ctx) {
        ctx.macros.register({ id: '${authoredId}', name: 'tone', resolve: context => JSON.stringify(context) })
      }`,
    })
    const targets = [{ kind: 'global' as const }, { kind: 'card' as const, cardId: 'A' }, { kind: 'card' as const, cardId: 'B' }]
    const ids = targets.map(target => installedExtensionContributionId(packageId, target, authoredId))
    try {
      for (const target of targets) {
        await extensionHost.discover(directory, target)
        expect((await extensionHost.activate(packageId, 'server', target)).state).toBe('active')
      }
      for (const [index, cardId] of [undefined, 'A', 'B'].entries()) {
        for (const resolve of resolvers.values()) resolve.mockClear()
        const context = { global: { secret: 'host' }, ...(cardId ? { cardId, timeline: { own: cardId } } : {}) }
        const result = await registry.inspect({
          snapshot: { ...context, computed: {}, aliases: {} }, context, capturedAt: 'now',
          macroSelections: { tone: ids[index]! },
        })
        const entry = result.entries.find(item => item.name === 'tone')!
        expect(entry.candidates.map(candidate => candidate.sourceId)).toEqual(index === 0 ? [ids[0]] : [ids[0], ids[index]])
        expect(entry.status).toBe('resolved')
        expect(JSON.parse(entry.value!)).toEqual(index === 0 ? context : { ...context, global: {} })
        expect(resolvers.get(ids[0]!)!).toHaveBeenCalledOnce()
        for (const privateIndex of [1, 2]) {
          expect(resolvers.get(ids[privateIndex]!)!).toHaveBeenCalledTimes(index === privateIndex ? 1 : 0)
        }
      }
      await extensionHost.dispose(packageId, 'server', targets[1])
      const removed = await registry.inspect({
        snapshot: { global: {}, computed: {}, aliases: {} }, context: { global: {}, cardId: 'A' },
        macroSelections: { tone: ids[1]! }, capturedAt: 'now',
      })
      expect(removed.entries.find(entry => entry.name === 'tone')).toMatchObject({ status: 'error' })
    } finally {
      await extensionHost.disposeAll()
    }
  })

  it('attributes registration to the host owner and releases it on disable', async () => {
    const dispose = vi.fn()
    const registerMacroProvider = vi.fn<NonNullable<ExtensionHostOptions['registerMacroProvider']>>(() => ({ dispose }))
    const { extensionHost } = createExtensionHostHarness({ registerMacroProvider })
    await extensionHost.discover(fixture('example.macros', true))
    await extensionHost.activate('example.macros', 'server')
    expect(registerMacroProvider).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'example.macros.tone', name: 'tone' }),
      expect.objectContaining({ packageId: 'example.macros', moduleId: 'server', instanceId: expect.any(String) }),
    )
    const provider = registerMacroProvider.mock.calls[0]![0]
    await expect(provider.resolve({ global: { tone: 'quiet' } })).resolves.toBe('quiet')
    await extensionHost.dispose('example.macros', 'server')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([
    ['example.macros-denied', false, 'example.macros-denied.tone'],
    ['example.macros-foreign', true, 'another.package.tone'],
  ] as const)('rejects unauthorized registration: %s', async (name, capability, id) => {
    const registerMacroProvider = vi.fn(() => ({ dispose() {} }))
    const { extensionHost } = createExtensionHostHarness({ registerMacroProvider })
    await extensionHost.discover(fixture(name, capability, id))
    await expect(extensionHost.activate(name, 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
    expect(registerMacroProvider).not.toHaveBeenCalled()
  })

  it('releases registrations after activation failure', async () => {
    const dispose = vi.fn()
    const { extensionHost } = createExtensionHostHarness({ registerMacroProvider: () => ({ dispose }) })
    await extensionHost.discover(fixture('example.macros-failure', true, 'example.macros-failure.tone', true))
    await expect(extensionHost.activate('example.macros-failure', 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
    expect(dispose).toHaveBeenCalledOnce()
  })
})
