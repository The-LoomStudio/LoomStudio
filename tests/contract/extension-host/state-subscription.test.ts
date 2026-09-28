import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { EventCapabilityCategory, ExtensionHostOptions } from '@loom-studio/extension-host'
import type { ExtensionInstallationTarget, ExtensionStateChangeEvent } from '@loom-studio/extension-sdk'
import { createEventBus } from '@loom-studio/kernel'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext, createExtensionScope } from '../../../packages/extension-sdk/extension-host/src/instance.js'
import type { ExtensionModuleRecord } from '../../../packages/extension-sdk/extension-host/src/types.js'
import { registerBuiltinEventDefinitions } from '../../../packages/kernel/src/events.js'

const scopes: ReturnType<typeof createExtensionScope>[] = []
const change = {
  target: { scope: 'global' },
  revisionId: 'revision-1',
  changesetId: 'changeset-1',
  paths: ['characters/alice'],
} satisfies ExtensionStateChangeEvent

afterEach(async () => {
  await Promise.all(scopes.splice(0).map(scope => scope.dispose()))
})

function createHarness(
  grantedEventCapabilities: EventCapabilityCategory[] = ['state'],
  access?: { target: ExtensionInstallationTarget; canAccessState: NonNullable<ExtensionHostOptions['canAccessState']> },
) {
  const events = createEventBus()
  registerBuiltinEventDefinitions(events)
  const subscribeEvents = vi.fn<NonNullable<ExtensionHostOptions['subscribeEvents']>>(
    (patterns, handler, subscriber) => events.subscribe(patterns, handler, { subscriber }),
  )
  const scope = createExtensionScope('state-subscription-instance')
  scopes.push(scope)
  const moduleManifest: ExtensionModuleRecord['moduleManifest'] = {
    id: 'server',
    runtime: 'server',
    entry: './index.js',
    capabilities: { 'events.subscribe': ['state'] },
  }
  const context = createContext({
    target: access?.target ?? { kind: 'global' },
    directory: '/unused/state-subscription',
    packageManifest: {
      manifestVersion: 2,
      id: 'example.state',
      version: '1.0.0',
      displayName: 'State Subscription',
      engines: { studio: '^0.1.0' },
      modules: [moduleManifest],
    },
    moduleManifest,
    state: 'active',
  }, {
    instanceId: scope.instanceId,
    state: 'active',
    scope,
    registeredRpcNames: new Set(),
    registeredEventNames: new Set(),
    registeredAiProviderIds: new Set(),
    registeredAgentToolIds: new Set(),
    grantedEventCapabilities,
    grantedAssetCapabilities: [],
  }, {
    documents: createInMemoryDocumentStore(),
    diagnostics: createInMemoryDiagnosticsRegistry(),
    callRpc: vi.fn(),
    registerRpc: vi.fn(),
    subscribeEvents,
    canAccessState: access?.canAccessState,
  })

  return { context, scope, events, subscribeEvents }
}

describe('Extension State subscription cancellation contract', () => {
  it.each(['handle', 'scope'] as const)('does not deliver a pending Card event after %s cancellation', async owner => {
    let allow!: (value: boolean) => void
    const check = new Promise<boolean>(resolve => { allow = resolve })
    const { context, scope, events } = createHarness(['state'], {
      target: { kind: 'card', cardId: 'A' }, canAccessState: () => check,
    })
    const handler = vi.fn()
    const subscription = context.state.subscribe({}, handler)
    events.emit('state.changed', { ...change, target: { scope: 'timeline', timelineId: 'A-timeline', branchId: 'main' } })
    if (owner === 'handle') subscription.dispose()
    else await scope.dispose()
    allow(true)
    await new Promise(resolve => setImmediate(resolve))
    expect(handler).not.toHaveBeenCalled()
  })

  it.each(['handle', 'scope'] as const)('removes the abort listener when the %s is disposed', async owner => {
    const { context, scope } = createHarness()
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const registration = context.state.subscribe({ signal: controller.signal }, vi.fn())
    const listener = add.mock.calls.find(([type]) => type === 'abort')![1]
    if (owner === 'handle') await registration.dispose()
    else await scope.dispose()
    expect(remove).toHaveBeenCalledWith('abort', listener)
  })

  it('matches semantic targets regardless of property order and isolates other branches', () => {
    const { context, events } = createHarness()
    const handler = vi.fn()
    context.state.subscribe({ target: { branchId: 'branch', timelineId: 'timeline', scope: 'timeline' } }, handler)
    const matching = { ...change, target: { scope: 'timeline' as const, timelineId: 'timeline', branchId: 'branch' } }
    events.emit('state.changed', matching)
    events.emit('state.changed', { ...matching, target: { ...matching.target, branchId: 'other' } })
    events.emit('state.changed', { ...matching, target: { ...matching.target, timelineId: 'other' } })
    events.emit('state.changed', change)
    expect(handler).toHaveBeenCalledExactlyOnceWith(matching)
  })

  it('notifies a watched subtree when its ancestor changes without matching sibling prefixes', () => {
    const { context, events } = createHarness()
    const handler = vi.fn()
    context.state.subscribe({ paths: ['/world/time'] }, handler)
    for (const path of ['/world', '/world/time', '/world/time/hour', '', '/world/timeline', '/world/weather']) {
      events.emit('state.changed', { ...change, paths: [path] })
    }
    expect(handler.mock.calls.map(([event]) => event.paths)).toEqual([
      ['/world'], ['/world/time'], ['/world/time/hour'], [''],
    ])
  })

  it('does not register or deliver for an already aborted signal and returns a disposable handle', async () => {
    const { context, scope, events, subscribeEvents } = createHarness()
    const controller = new AbortController()
    controller.abort()
    const handler = vi.fn()

    const registration = context.state.subscribe({ signal: controller.signal }, handler)
    events.emit('state.changed', change)

    expect(handler).not.toHaveBeenCalled()
    expect(subscribeEvents).not.toHaveBeenCalled()
    await registration.dispose()
    await registration.dispose()
    expect(scope.active).toBe(true)
  })

  it.each(['abort first', 'dispose first'])('keeps other subscriptions active when cancelled: %s', async order => {
    const { context, scope, events } = createHarness()
    const controller = new AbortController()
    const handler = vi.fn()
    const otherHandler = vi.fn()
    const registration = context.state.subscribe({ signal: controller.signal }, handler)
    const otherRegistration = events.subscribe(['state.changed'], otherHandler, {
      subscriber: {
        kind: 'extension',
        packageId: 'example.other',
        moduleId: 'server',
        instanceId: 'other-instance',
        capabilities: ['state'],
      },
    })
    try {
      events.emit('state.changed', change)
      expect(handler).toHaveBeenCalledExactlyOnceWith(change)
      expect(otherHandler).toHaveBeenCalledOnce()

      if (order === 'abort first') {
        controller.abort()
      } else {
        await registration.dispose()
      }
      events.emit('state.changed', change)
      expect(handler).toHaveBeenCalledOnce()
      expect(otherHandler).toHaveBeenCalledTimes(2)

      await registration.dispose()
      await registration.dispose()
      controller.abort()
      await scope.dispose()
      events.emit('state.changed', change)
      expect(handler).toHaveBeenCalledOnce()
      expect(otherHandler).toHaveBeenCalledTimes(3)
    } finally {
      otherRegistration.dispose()
    }
  })

  it('still requires the state grant for an already aborted subscription', () => {
    const { context, subscribeEvents } = createHarness([])
    const controller = new AbortController()
    controller.abort()

    expect(() => context.state.subscribe({ signal: controller.signal }, vi.fn()))
      .toThrow('Extension module is not allowed to subscribe to State changes: example.state/server')
    expect(subscribeEvents).not.toHaveBeenCalled()
  })
})
