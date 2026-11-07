import { createApplicationRuntime, createStateContributionRegistry, applicationDocumentTypes } from '@loom-studio/application-runtime'
import { createAgentStore, createNarrativeStore, createPromptResourceStore, createStateStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { describe, expect, it } from 'vitest'
import { captureTimelineExtensionLease } from '../../../packages/application-runtime/src/extensions/timeline-participation.js'
import type { StateDefinitionMigrationInput } from '../../../packages/application-runtime/src/runtime/state-migration.js'

async function setup() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-11-07T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, createId, now })
  const states = createStateStore({ engine, createId, now })
  const stateContributions = createStateContributionRegistry()
  const packageId = 'example.fog-harbor'
  const installationId = extensionInstallationId(packageId, { kind: 'global' })
  stateContributions.register({ packageId, packageVersion: '1.0.0', moduleId: 'server', instanceId: 'fog-server', contribution: {
    id: 'example.fog-harbor.state', entityTypes: [], entities: [], componentMounts: [],
    templates: [{ id: 'example.fog-harbor.wallet', templateVersion: 1, schema: { type: 'object', properties: { money: { type: 'integer', minimum: 0 } }, required: ['money'], additionalProperties: false }, initial: { money: 100 } }],
    bindings: [{ path: 'wallet', templateId: 'example.fog-harbor.wallet', templateVersion: 1 }],
  } })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, states, promptResources: createPromptResourceStore({ engine, createId, now }), agents: createAgentStore({ engine }), stateContributions })
  const { card } = await runtime.createCard({ name: '雾港纪事' })
  await documents.write({ id: installationId, type: applicationDocumentTypes.extensionInstallation, expectedVersion: 'new', actor: { kind: 'kernel', id: 'test' }, content: {
    packageId, packageVersion: '1.0.0', participation: 'timeline', target: { kind: 'global' }, source: { kind: 'git', url: 'https://example.com/fog.git' }, createdAt: now(), updatedAt: now(),
  } })
  await runtime.updateCard({ cardId: card.id, extensionAdoptions: [{ packageId, target: 'global' }] })
  const a = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: '第十二天，雾港尚未发现灯塔。' })
  const b = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: '第三天。' })
  const oldBranch = await runtime.forkNarrativeBranch({ timelineId: a.timeline.id, fromBranchId: a.branch.id, fromNodeId: a.nodes[0]!.id })
  const target = { scope: 'timeline' as const, timelineId: a.timeline.id, branchId: a.branch.id }
  const oldTarget = { ...target, branchId: oldBranch.branch.id }
  const bTarget = { scope: 'timeline' as const, timelineId: b.timeline.id, branchId: b.branch.id }
  const snapshot = (await runtime.getStateSnapshot({ target })).snapshot
  await runtime.applyStateMutation({ target, expectedRevisionId: snapshot.revisionId, operations: [{ op: 'set', path: '/wallet/money', value: 850 }] })
  const owner = { packageId, lease: await captureTimelineExtensionLease({ documents, narratives }, target.timelineId, installationId) }
  const definitions = await runtime.getExtensionStateDefinitions(target, owner)
  const before = (await runtime.getStateSnapshot({ target })).snapshot
  const input: StateDefinitionMigrationInput = {
    target, expectedRevisionId: before.revisionId, expectedDefinitionVersion: definitions.version, idempotencyKey: 'wallet-v2',
    bindings: [{ path: 'wallet', schema: { type: 'object', properties: { coins: { type: 'integer', minimum: 0 } }, required: ['coins'], additionalProperties: false }, value: { coins: 850 } }],
  }
  return { engine, documents, narratives, states, runtime, target, oldTarget, bTarget, owner, before, definitions, input, installationId }
}

describe('author-provided State definition migration', () => {
  it('changes the accepted definition and current branch together, preserving old revisions and other branches', async () => {
    const f = await setup()
    try {
      const old = (await f.runtime.getStateSnapshot({ target: f.oldTarget })).snapshot
      const b = (await f.runtime.getStateSnapshot({ target: f.bTarget })).snapshot
      const historical = await f.states.getRevision(f.before.revisionId)
      const result = await f.runtime.migrateExtensionState(f.input, f.owner)
      expect(result.snapshot.value.wallet).toEqual({ coins: 850 })
      expect(result.snapshot.revisionId).not.toBe(f.before.revisionId)
      expect((await f.runtime.getStateSnapshot({ target: f.target })).snapshot).toEqual(result.snapshot)
      const definitions = await f.runtime.getExtensionStateDefinitions(f.target, f.owner)
      expect(definitions.version).toBe(f.definitions.version + 1)
      expect(definitions.bindings.find(binding => binding.path === 'wallet')?.schema).toEqual(f.input.bindings[0]!.schema)
      expect(await f.states.getRevision(f.before.revisionId)).toEqual(historical)
      expect((await f.runtime.getStateSnapshot({ target: f.oldTarget })).snapshot).toEqual(old)
      expect((await f.runtime.getStateSnapshot({ target: f.bTarget })).snapshot).toEqual(b)
      // Definitions are Timeline-wide. Old data remains readable; compatibility is the author's responsibility.
      await expect(f.runtime.applyStateMutation({ target: f.oldTarget, expectedRevisionId: old.revisionId, operations: [{ op: 'set', path: '/wallet/money', value: 420 }] })).rejects.toThrow()
      const repeat = await f.runtime.migrateExtensionState(f.input, f.owner)
      expect(repeat).toEqual(result)
      expect((await f.runtime.getExtensionStateDefinitions(f.target, f.owner)).version).toBe(definitions.version)
    } finally { await f.engine.close() }
  })

  it('rejects an invalid converted value without changing the definition, branch head or history', async () => {
    const f = await setup()
    try {
      const revisionCount = f.engine.database.prepare('SELECT count(*) AS count FROM state_revisions').get()
      await expect(f.runtime.migrateExtensionState({ ...f.input, bindings: [{ ...f.input.bindings[0]!, value: { coins: 'eight hundred' } }] }, f.owner)).rejects.toThrow('Expected integer')
      expect((await f.runtime.getStateSnapshot({ target: f.target })).snapshot).toEqual(f.before)
      expect(await f.runtime.getExtensionStateDefinitions(f.target, f.owner)).toEqual(f.definitions)
      expect(f.engine.database.prepare('SELECT count(*) AS count FROM state_revisions').get()).toEqual(revisionCount)
    } finally { await f.engine.close() }
  })

  it('rejects unowned paths, wrong Timeline leases and stale definitions or state', async () => {
    const f = await setup()
    try {
      await expect(f.runtime.migrateExtensionState({ ...f.input, bindings: [{ path: '$loom.players.User.components.loom_profile', schema: { type: 'object' }, value: {} }] }, f.owner)).rejects.toThrow('unowned')
      await expect(f.runtime.migrateExtensionState({ ...f.input, target: f.bTarget }, f.owner)).rejects.toThrow('outside')
      await expect(f.runtime.migrateExtensionState({ ...f.input, expectedDefinitionVersion: f.definitions.version + 1 }, f.owner)).rejects.toThrow('changed')
      const newer = await f.runtime.applyStateMutation({ target: f.target, expectedRevisionId: f.before.revisionId, operations: [{ op: 'set', path: '/wallet/money', value: 900 }] })
      await expect(f.runtime.migrateExtensionState(f.input, f.owner)).rejects.toThrow('changed')
      expect((await f.runtime.getStateSnapshot({ target: f.target })).snapshot).toEqual(newer.snapshot)
      expect(await f.runtime.getExtensionStateDefinitions(f.target, f.owner)).toEqual(f.definitions)
    } finally { await f.engine.close() }
  })

  it('rejects different inputs under the same migration key and a revoked execution lease', async () => {
    const f = await setup()
    try {
      await f.runtime.migrateExtensionState(f.input, f.owner)
      await expect(f.runtime.migrateExtensionState({ ...f.input, bindings: [{ ...f.input.bindings[0]!, value: { coins: 1 } }] }, f.owner)).rejects.toThrow('idempotency')
      await f.runtime.updateTimelineExtensionParticipation({ timelineId: f.target.timelineId, installationId: f.installationId, expectedVersion: 1, enabled: false })
      await expect(f.runtime.migrateExtensionState(f.input, f.owner)).rejects.toThrow('no longer active')
    } finally { await f.engine.close() }
  })
})
