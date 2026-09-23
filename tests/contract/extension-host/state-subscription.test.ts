import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { EventCapabilityCategory, ExtensionHostOptions } from '@loom-studio/extension-host'
import type { ExtensionStateChangeEvent } from '@loom-studio/extension-sdk'
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

function createHarness(grantedEventCapabilities: EventCapabilityCategory[] = ['state']) {
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
  })

  return { context, scope, events, subscribeEvents }
}

describe('Extension State subscription cancellation contract', () => {
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
