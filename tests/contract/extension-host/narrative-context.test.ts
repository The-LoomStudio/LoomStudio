import { describe, expect, it, vi } from 'vitest'
import { createNarrativeContextRegistry } from '@loom-studio/application-runtime'
import { installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { createExtensionFixture, createExtensionHostHarness } from './helpers.js'

function fixture(name: string, capability: boolean, providerId = `${name}.memory`, fail = false) {
  return createExtensionFixture(name, {
    manifest: {
      manifestVersion: 2, id: name, version: '0.0.0', displayName: name,
      engines: { studio: '^0.1.0' },
      modules: [{
        id: 'server', runtime: 'server', entry: './dist/index.js',
        capabilities: { 'narrative.context.provide': capability },
      }],
    },
    source: `let version = 'v1';
    export function activate(ctx) {
      ctx.narrativeContext.register({
        id: ${JSON.stringify(providerId)},
        resolve: async scope => scope.branchId === 'selected'
          ? { version, memory: null, rawThroughNodeId: null } : undefined,
        onSessionHandoff: async scope => { version = scope.summaryEntryId; }
      });
      ${fail ? "throw new Error('activation failed')" : ''}
    }`,
  })
}

describe('Extension Narrative context registration', () => {
  it('isolates private providers and handoffs without changing global conflict semantics', async () => {
    const registry = createNarrativeContextRegistry()
    const { extensionHost } = createExtensionHostHarness({
      registerNarrativeContextProvider: (provider, owner) => registry.register(provider, owner.target),
    })
    const packageId = 'example.private-memory'
    const directory = fixture(packageId, true)
    const a = { kind: 'card' as const, cardId: 'A' }
    const b = { kind: 'card' as const, cardId: 'B' }
    const scopeA = { timelineId: 'timeline-A', branchId: 'selected', cardId: a.cardId }
    const scopeB = { timelineId: 'timeline-B', branchId: 'selected', cardId: b.cardId }
    try {
      for (const target of [a, b]) {
        await extensionHost.discover(directory, target)
        expect((await extensionHost.activate(packageId, 'server', target)).state).toBe('active')
      }
      expect(await registry.resolve(scopeA)).toMatchObject({
        sourceId: installedExtensionContributionId(packageId, a, `${packageId}.memory`), version: 'v1',
      })
      expect(await registry.resolve({ timelineId: 'other', branchId: 'selected', cardId: 'C' })).toBeUndefined()
      expect(await registry.resolve({ timelineId: 'unknown', branchId: 'selected' })).toBeUndefined()
      expect(await registry.notifySessionHandoff({
        ...scopeB, agentSessionId: 'session-B', summaryEntryId: 'handoff-B', rawHeadNodeId: null,
      })).toBe('notified')
      expect(await registry.resolve(scopeB)).toMatchObject({ version: 'handoff-B' })
      expect(await registry.resolve(scopeA)).toMatchObject({ version: 'v1' })
      await expect(registry.resolve({ ...scopeA, branchId: 'unselected' })).rejects.toThrow('No Narrative context source selected')
      await extensionHost.discover(directory)
      await extensionHost.activate(packageId, 'server')
      await expect(registry.resolve(scopeA)).rejects.toThrow('Conflicting Narrative context providers')
      await extensionHost.dispose(packageId, 'server')
      await extensionHost.dispose(packageId, 'server', a)
      expect(await registry.resolve(scopeA)).toBeUndefined()
      expect(await registry.resolve(scopeB)).toMatchObject({ version: 'handoff-B' })
    } finally {
      await extensionHost.disposeAll()
    }
  })

  it('resolves through the real host scope and releases the source on unload', async () => {
    const registry = createNarrativeContextRegistry()
    const register = vi.fn<NonNullable<import('@loom-studio/extension-host').ExtensionHostOptions['registerNarrativeContextProvider']>>(
      (provider, owner) => registry.register(provider, owner.target),
    )
    const { extensionHost } = createExtensionHostHarness({ registerNarrativeContextProvider: register })
    await extensionHost.discover(fixture('example.narrative-context', true))
    await extensionHost.activate('example.narrative-context', 'server')
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'example.narrative-context.memory' }),
      expect.objectContaining({ packageId: 'example.narrative-context', moduleId: 'server', instanceId: expect.any(String) }),
    )
    await expect(registry.resolve({ timelineId: 'story', branchId: 'selected' })).resolves.toMatchObject({ version: 'v1', rawThroughNodeId: null })
    await expect(registry.notifySessionHandoff({
      timelineId: 'story', branchId: 'selected', agentSessionId: 'session',
      summaryEntryId: 'handoff-1', rawHeadNodeId: null,
    })).resolves.toBe('notified')
    await expect(registry.resolve({ timelineId: 'story', branchId: 'selected' })).resolves.toMatchObject({ version: 'handoff-1' })
    await expect(registry.resolve({ timelineId: 'story', branchId: 'other' })).rejects.toThrow(/No Narrative context source selected/)
    await extensionHost.dispose('example.narrative-context', 'server')
    await expect(registry.resolve({ timelineId: 'story', branchId: 'selected' })).resolves.toBeUndefined()
  })

  it.each([
    ['example.context-denied', false, 'example.context-denied.memory'],
    ['example.context-foreign', true, 'another.package.memory'],
  ] as const)('rejects undeclared capability or foreign namespace: %s', async (name, capability, id) => {
    const register = vi.fn(() => ({ dispose() {} }))
    const { extensionHost } = createExtensionHostHarness({ registerNarrativeContextProvider: register })
    await extensionHost.discover(fixture(name, capability, id))
    await expect(extensionHost.activate(name, 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
    expect(register).not.toHaveBeenCalled()
  })

  it('cleans up after activation fails', async () => {
    const dispose = vi.fn()
    const { extensionHost } = createExtensionHostHarness({ registerNarrativeContextProvider: () => ({ dispose }) })
    await extensionHost.discover(fixture('example.context-failed', true, 'example.context-failed.memory', true))
    await expect(extensionHost.activate('example.context-failed', 'server')).resolves.toMatchObject({ instance: { state: 'activation_failed' } })
    expect(dispose).toHaveBeenCalledOnce()
  })
})
