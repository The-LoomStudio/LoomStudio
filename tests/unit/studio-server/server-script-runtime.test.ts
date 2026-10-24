import { expect, it, vi } from 'vitest'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import type { ExtensionMacroProvider } from '@loom-studio/extension-sdk'
import { createServerScriptRuntime, type ServerScriptRun } from '../../../apps/studio-server/src/scripts/server-script-runtime.js'

it('cancels obsolete preparations before module evaluation and continues the new scope', async () => {
  const effects: string[] = []
  const marker = '__loom_script_pending_load_test__'
  Object.defineProperty(globalThis, marker, { value: effects, configurable: true })
  const begun = Promise.withResolvers<void>()
  const prepared = Promise.withResolvers<string>()
  let loadSignal: AbortSignal | undefined
  const code = (label: string) => `
    const effects = globalThis[${JSON.stringify(marker)}];
    effects.push('${label}:import');
    export function activate(ctx) {
      effects.push('${label}:activate');
      ctx.lifecycle.onDispose(() => { effects.push('${label}:dispose'); });
    }
  `
  const run = (version: number): ServerScriptRun => ({
    mountId: 'pending', mountVersion: version, grantedCapabilities: ['runtime.server'],
    script: { id: 'pending-doc', version, name: 'Pending', metadataId: 'pending', scriptVersion: '1.0.0',
      runtime: 'server', requestedCapabilities: ['runtime.server'], contributions: [] },
    source: code(`v${version}`),
  })
  const runtime = createServerScriptRuntime({
    hostOptions: {
      documents: createInMemoryDocumentStore(), diagnostics: createInMemoryDiagnosticsRegistry(),
      callRpc: async () => null, registerRpc: () => { throw new Error('Not used') },
    },
    prepareSource: async (input, signal) => {
      if (input.mountVersion !== 1) return input.source
      loadSignal = signal
      begun.resolve()
      // A late completion must be rejected even if an external preparer ignores cancellation.
      return prepared.promise
    },
  })
  try {
    const first = runtime.reconcile([run(1)])
    await begun.promise
    const replacement = runtime.reconcile([run(2)])
    expect(loadSignal?.aborted).toBe(true)
    prepared.resolve(code('obsolete'))
    await first
    expect((await replacement)[0]?.state).toBe('active')
    expect(effects).toEqual(['v2:import', 'v2:activate'])
    await runtime.reconcile([])
    expect(effects).toEqual(['v2:import', 'v2:activate', 'v2:dispose'])
    expect(runtime.list()).toEqual([])
  } finally {
    prepared.resolve(code('obsolete'))
    await runtime.dispose()
    Reflect.deleteProperty(globalThis, marker)
  }
})

it('runs authorized ESM through the host, preserves saved instances, and cleans up refresh, failure and removal', async () => {
  const macros = new Map<string, ExtensionMacroProvider>()
  const subscribers = new Set<unknown>()
  const disposals: string[] = []
  const readState = vi.fn<NonNullable<ExtensionHostOptions['readState']>>(async target => ({
    target, scopeId: 'global', revisionId: 'r1', value: { day: 3 }, createdAt: 'now',
  }))
  const runtime = createServerScriptRuntime({ hostOptions: {
    documents: createInMemoryDocumentStore(), diagnostics: createInMemoryDiagnosticsRegistry(), readState,
    callRpc: async () => null,
    registerRpc: () => { throw new Error('Not used') },
    subscribeEvents: (_patterns, handler) => {
      subscribers.add(handler)
      return { dispose() { subscribers.delete(handler); disposals.push('event') } }
    },
    registerMacroProvider: provider => {
      macros.set(provider.id, provider)
      return { dispose() { macros.delete(provider.id); disposals.push('macro') } }
    },
  } })
  const source = (version: number, fail = false) => `
    export async function activate(ctx) {
      const state = await ctx.state.read({ scope: 'global' });
      ctx.macros.register({ id: ctx.extension.packageId + '.day', name: 'Day', resolve: () => '${version}:' + state.value.day });
      ctx.events.subscribe(['state.changed'], () => {});
      ${fail ? 'throw new Error("activation exploded");' : ''}
    }
  `
  const run: ServerScriptRun = {
    mountId: 'mount1', mountVersion: 1,
    grantedCapabilities: ['runtime.server', 'state.read', 'macros.provide', 'events.subscribe:state'],
    script: {
      id: 'doc1', version: 1, metadataId: 'same-public-id', name: 'Day', scriptVersion: '1.0.0',
      runtime: 'server', requestedCapabilities: ['runtime.server', 'state.read', 'macros.provide', 'events.subscribe:state'],
      contributions: [],
    },
    source: source(1),
  }
  try {
    const denied = await runtime.reconcile([{ ...run, grantedCapabilities: [] }])
    expect(denied[0]?.state).toBe('unavailable')
    expect(readState).not.toHaveBeenCalled()

    const started = (await runtime.reconcile([run]))[0]!
    expect(started.state).toBe('active')
    expect(subscribers.size).toBe(1)
    expect(await macros.get('script.doc1.day')!.resolve({} as never)).toBe('1:3')
    const saved = { ...run, script: { ...run.script, version: 2 }, source: source(2) }
    const unchanged = (await runtime.reconcile([saved]))[0]!
    expect(unchanged.instanceId).toBe(started.instanceId)
    expect(unchanged.runningDocumentVersion).toBe(1)
    expect(readState).toHaveBeenCalledTimes(1)

    const refreshed = await runtime.refresh(run.mountId)
    expect(refreshed?.instanceId).not.toBe(started.instanceId)
    expect(refreshed?.runningDocumentVersion).toBe(2)
    expect(disposals).toEqual(['event', 'macro'])
    expect(subscribers.size).toBe(1)
    expect(await macros.get('script.doc1.day')!.resolve({} as never)).toBe('2:3')

    await runtime.reconcile([{ ...saved, source: source(3, true) }])
    const failed = await runtime.refresh(run.mountId)
    expect(failed?.state).toBe('failed')
    expect(failed?.diagnostics.some(item => item.message === 'activation exploded')).toBe(true)
    expect(subscribers.size).toBe(0)
    expect(macros.size).toBe(0)

    await runtime.reconcile([{ ...saved, mountVersion: 2 }])
    expect(runtime.list()[0]?.state).toBe('active')
    expect(subscribers.size).toBe(1)
    await runtime.reconcile([])
    expect(runtime.list()).toEqual([])
    expect(subscribers.size).toBe(0)
    expect(macros.size).toBe(0)
  } finally {
    await runtime.dispose()
  }
})
