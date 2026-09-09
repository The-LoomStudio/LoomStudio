import { describe, expect, it, vi } from 'vitest'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
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
