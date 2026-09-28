import { describe, expect, it } from 'vitest'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createEventBus } from '@loom-studio/kernel'
import { createId, nowIso } from '@loom-studio/shared'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import type { ExtensionInstallationTarget, ExtensionStateChangeEvent } from '@loom-studio/extension-sdk'
import { createContext, createExtensionScope } from '../../../packages/extension-sdk/extension-host/src/instance.js'
import { registerBuiltinEventDefinitions } from '../../../packages/kernel/src/events.js'
import { canAccessExtensionState } from '../../../apps/studio-server/src/extensions/extension-state-access.js'

describe('Server extension State installation access', () => {
  it('allows only the owning Card Timeline in reads, writes and both subscription APIs', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const narratives = createNarrativeStore({ engine })
    const events = createEventBus()
    registerBuiltinEventDefinitions(events)
    const runtime = createApplicationRuntime({
      dataEngine: engine, documents, narratives, promptResources: createPromptResourceStore({ engine }),
      onStateChanged: change => { events.emit('state.changed', change) },
    })
    const checks: Promise<boolean>[] = []
    const options: ExtensionHostOptions = {
      documents, diagnostics: createInMemoryDiagnosticsRegistry(),
      callRpc: async () => null, registerRpc: () => { throw new Error('No RPC in this fixture') },
      canAccessState: (target, installation) => {
        const check = canAccessExtensionState(narratives, installation, target)
        checks.push(check)
        return check
      },
      readState: async target => (await runtime.getStateSnapshot({ target })).snapshot,
      writeState: async input => {
        const result = await runtime.applyStateMutation(input)
        return { snapshot: result.snapshot, changesetId: result.mutation.changesetId }
      },
      subscribeEvents: (patterns, handler, subscriber) => events.subscribe(patterns, handler, { subscriber }),
    }
    const scopes: ReturnType<typeof createExtensionScope>[] = []
    const context = (target: ExtensionInstallationTarget) => {
      const scope = createExtensionScope(createId('instance'))
      scopes.push(scope)
      const moduleManifest = {
        id: 'server', runtime: 'server' as const, entry: './unused.js',
        capabilities: { 'state.read': true, 'state.write': true },
      }
      return createContext({
        target, directory: '/unused', moduleManifest, state: 'active',
        packageManifest: {
          manifestVersion: 2, id: 'example.state', version: '1.0.0', displayName: 'State',
          engines: { studio: '^0.1.0' }, modules: [moduleManifest],
        },
      }, {
        instanceId: scope.instanceId, state: 'active', scope,
        registeredRpcNames: new Set(), registeredEventNames: new Set(),
        registeredAiProviderIds: new Set(), registeredAgentToolIds: new Set(),
        grantedEventCapabilities: ['state'], grantedAssetCapabilities: [],
      }, options)
    }
    try {
      await runtime.initialize()
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      const timelineA = await runtime.createNarrativeTimeline({ cardId: a.id, openingNodes: [] })
      const timelineB = await runtime.createNarrativeTimeline({ cardId: b.id, openingNodes: [] })
      const targetA = { scope: 'timeline' as const, timelineId: timelineA.timeline.id, branchId: timelineA.branch.id }
      const targetB = { scope: 'timeline' as const, timelineId: timelineB.timeline.id, branchId: timelineB.branch.id }
      const global = { scope: 'global' as const }
      const local = context({ kind: 'card', cardId: a.id })
      const host = context({ kind: 'global' })
      const allowedSnapshot = await local.state.read(targetA)
      for (const target of [global, targetB]) {
        const before = await host.state.read(target)
        await expect(local.state.read(target)).rejects.toThrow('outside the extension Card installation')
        await expect(local.state.write({
          target, expectedRevisionId: before.revisionId, operations: [{ op: 'set', path: '/denied', value: true }],
        })).rejects.toThrow('outside the extension Card installation')
        expect(await host.state.read(target)).toEqual(before)
      }
      await expect(local.state.read({ ...targetA, timelineId: 'missing' })).rejects.toThrow('outside the extension Card installation')
      const typed: ExtensionStateChangeEvent[] = []
      const generic: unknown[] = []
      const all: ExtensionStateChangeEvent[] = []
      local.state.subscribe({}, change => { typed.push(change) })
      local.events.subscribe(['state.changed'], event => { generic.push(event.payload) })
      host.state.subscribe({}, change => { all.push(change) })
      await local.state.write({
        target: targetA, expectedRevisionId: allowedSnapshot.revisionId, operations: [{ op: 'set', path: '/own', value: 1 }],
      })
      for (const target of [targetB, global]) {
        const snapshot = await host.state.read(target)
        await host.state.write({
          target, expectedRevisionId: snapshot.revisionId, operations: [{ op: 'set', path: '/other', value: 2 }],
        })
      }
      await Promise.all(checks)
      expect(all).toHaveLength(3)
      expect(typed.map(change => change.target)).toEqual([targetA])
      expect(generic).toEqual(typed)
      expect((await local.state.read(targetA)).value).toMatchObject({ own: 1 })
      const validate = options.canAccessState!
      for (const operation of ['read', 'write'] as const) {
        let entered!: () => void
        let release!: () => void
        const started = new Promise<void>(resolve => { entered = resolve })
        const gate = new Promise<void>(resolve => { release = resolve })
        options.canAccessState = async (target, installation) => {
          const allowed = await validate(target, installation)
          entered()
          await gate
          return allowed
        }
        const beforeA = await host.state.read(targetA)
        const beforeB = await host.state.read(targetB)
        const mutableTarget = { ...targetA }
        const input = {
          target: mutableTarget, expectedRevisionId: beforeA.revisionId,
          operations: [{ op: 'set' as const, path: '/captured', value: 'original' }],
        }
        const pending = operation === 'read' ? local.state.read(mutableTarget) : local.state.write(input)
        await started
        mutableTarget.timelineId = targetB.timelineId
        mutableTarget.branchId = targetB.branchId
        input.operations[0]!.value = 'modified'
        release()
        const result = await pending
        if (operation === 'read') expect(result).toEqual(beforeA)
        else expect(result).toMatchObject({ snapshot: { value: { captured: 'original' } } })
        expect(await host.state.read(targetB)).toEqual(beforeB)
        options.canAccessState = validate
      }
    } finally {
      await Promise.all(scopes.map(scope => scope.dispose()))
      await engine.close()
    }
  })
})
