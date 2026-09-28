import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes, createApplicationRuntime, extensionInstallationId } from '@loom-studio/application-runtime'
import { createAgentStore, createNarrativeStore, createPromptResourceStore, createStateStore } from '@loom-studio/application-data'
import type { DataCommitFact } from '@loom-studio/data-engine'
import { createId, nowIso, type JsonObject } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import { summarizeDataCommit, summarizeDocumentCommit } from '../../../packages/kernel/src/handlers.js'
import { projectExtensionEvent } from '../../../apps/studio-server/src/extensions/extension-event-projection.js'

const packageId = 'example.events'
const subscriber = (cardId: string) => ({
  kind: 'extension' as const, packageId, moduleId: 'server', instanceId: `instance-${cardId}`,
  target: { kind: 'card' as const, cardId }, capabilities: ['documents' as const, 'platform-data' as const],
})
const a = subscriber('A')
const b = subscriber('B')
const event = (name: string, payload: StudioEvent['payload']): StudioEvent => ({
  name, payload, meta: { eventId: 'event', definitionVersion: 1, emittedAt: 'now', source: 'kernel' },
})

describe('Card extension platform event projection', () => {
  it('delivers installation lifecycle notices without broadcasting workspace aggregates', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const stores = { documents: createSqliteDocumentStore({ engine }) }
    try {
      const own = event('extensions.changed', { packageId, target: a.target, moduleId: 'server', action: 'enabled' })
      expect(await projectExtensionEvent(stores, own, a)).toEqual(own)
      expect(await projectExtensionEvent(stores, own, b)).toBeUndefined()
      expect(await projectExtensionEvent(stores, own, { ...a, packageId: 'other.package' })).toBeUndefined()
      expect(await projectExtensionEvent(stores, event('extensions.changed', { packageId, action: 'enabled' }), a)).toBeUndefined()
      for (const name of ['diagnostics.updated', 'docs.rollback.failed', 'extensions.data.changed', 'directories.media.changed']) {
        const input = event(name, { changesetId: 'workspace', count: 9 })
        expect(await projectExtensionEvent(stores, input, a)).toBeUndefined()
        expect(await projectExtensionEvent(stores, input, { ...a, target: { kind: 'global' } })).toEqual(input)
      }
    } finally {
      await engine.close()
    }
  })

  it('recognizes runtime resource ownership without treating arbitrary origin fields as ownership', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const actor = { kind: 'system' as const, id: 'test' }
    const resourceTypes = [
      applicationDocumentTypes.agentTool, applicationDocumentTypes.textTransformRule, applicationDocumentTypes.textExtractor,
      applicationDocumentTypes.portableExtensionPayload, applicationDocumentTypes.extensionInstallation,
    ]
    try {
      const created = await documents.transact({ actor }, async tx => {
        for (const target of [a.target, b.target]) {
          const installationId = extensionInstallationId(packageId, target)
          const origin = { kind: 'extension-package', packageId, installationId }
          for (const type of resourceTypes) await tx.write({
            id: type === applicationDocumentTypes.extensionInstallation ? installationId : `${target.cardId}:${type}`,
            type, expectedVersion: 'new', content: { origin, packageId, ownerInstallationId: installationId, target },
          })
          await tx.write({ id: `${target.cardId}:not-a-resource`, type: 'test.note', expectedVersion: 'new', content: { origin } })
          await tx.write({
            id: `${target.cardId}:conflicting-meta`, type: applicationDocumentTypes.agentTool, expectedVersion: 'new',
            content: { origin }, meta: { ownerExtensionId: 'other.package' },
          })
        }
      })
      const deleted = await documents.delete({ id: `A:${applicationDocumentTypes.textTransformRule}`, expectedVersion: 1, actor })
      for (const target of [a, b]) {
        for (const input of [event('docs.changed', summarizeDocumentCommit(created.commit)), event('data.changed', summarizeDataCommit(created.commit))]) {
          const result = await projectExtensionEvent({ documents }, input, target)
          const operations = (result!.payload as JsonObject).operations as JsonObject[]
          expect(operations).toHaveLength(resourceTypes.length)
          expect(operations.every(operation => {
            const id = operation.documentId ?? operation.entityId
            return id === extensionInstallationId(packageId, target.target) || (typeof id === 'string' && id.startsWith(`${target.target.cardId}:airp.`))
          })).toBe(true)
        }
      }
      const deletion = event('docs.changed', summarizeDocumentCommit(deleted.commit))
      expect(await projectExtensionEvent({ documents }, deletion, a)).toBeDefined()
      expect(await projectExtensionEvent({ documents }, deletion, b)).toBeUndefined()
    } finally {
      await engine.close()
    }
  })

  it('projects Prompt resources and removed mounts using their committed ownership versions', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine })
    const stores = { documents, promptResources }
    const actor = { kind: 'system' as const, id: 'test' }
    const metadata = (target: typeof a.target) => ({
      origin: { kind: 'extension-package', packageId, installationId: extensionInstallationId(packageId, target) },
    })
    try {
      const preset = await promptResources.createResource({
        actor, id: 'preset', resourceKind: 'preset', metadata: metadata(a.target),
        rootNode: { id: 'preset-root', kind: 'module', label: 'Preset', children: [] },
      })
      const setting = await promptResources.createResource({
        actor, id: 'setting', resourceKind: 'setting',
        rootNode: { id: 'setting-root', kind: 'module', label: 'Setting', children: [] },
      })
      const mount = await promptResources.addSettingMount({
        actor, source: { kind: 'preset', id: preset.resource.id }, settingResourceId: setting.resource.id, orderIndex: 0,
      })
      const tool = await promptResources.addPresetToolMount({
        actor, presetResourceId: preset.resource.id, toolId: 'example/tool', orderIndex: 0, defaultEnabled: true,
      })
      const manual = await promptResources.addSettingMount({
        actor, source: { kind: 'manual' }, settingResourceId: setting.resource.id, orderIndex: 0,
      })
      const moved = await promptResources.mutateResource({
        actor, resourceId: preset.resource.id, expectedVersion: 1,
        mutations: [{ kind: 'resource.update', patch: { metadata: metadata(b.target) } }],
      })
      const deleted = await promptResources.deleteResource({ actor, resourceId: preset.resource.id, expectedVersion: 2 })
      expect(await promptResources.getResource(preset.resource.id)).toBeNull()
      expect(await promptResources.listPresetToolMounts({ presetResourceId: preset.resource.id })).toEqual([])
      for (const commit of [preset.commit, mount.commit, tool.commit]) {
        const input = event('data.changed', summarizeDataCommit(commit))
        expect((await projectExtensionEvent(stores, input, a))?.payload).toEqual(input.payload)
        expect(await projectExtensionEvent(stores, input, b)).toBeUndefined()
        expect(await projectExtensionEvent(stores, input, { ...a, packageId: 'other.package' })).toBeUndefined()
      }
      expect(await projectExtensionEvent(stores, event('data.changed', summarizeDataCommit(manual.commit)), a)).toBeUndefined()
      for (const commit of [moved.commit, deleted.commit]) {
        const input = event('data.changed', summarizeDataCommit(commit))
        expect((await projectExtensionEvent(stores, input, b))?.payload).toEqual(input.payload)
        expect(await projectExtensionEvent(stores, input, a)).toBeUndefined()
      }
      expect(deleted.commit.operations).toHaveLength(3)
    } finally {
      await engine.close()
    }
  })

  it('resolves Narrative, Agent and State scopes after deletion without attributing new detached messages to the old Card', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const narratives = createNarrativeStore({ engine })
    const agents = createAgentStore({ engine })
    const states = createStateStore({ engine, createId, now: nowIso })
    const stores = { documents, narratives, states }
    const commits: DataCommitFact[] = []
    const subscription = engine.subscribeCommits(commit => { commits.push(commit) })
    const runtime = createApplicationRuntime({
      dataEngine: engine, documents, narratives, agents, states, promptResources: createPromptResourceStore({ engine }),
    })
    try {
      await runtime.initialize()
      const { card: cardA } = await runtime.createCard({ name: 'A' })
      const { card: cardB } = await runtime.createCard({ name: 'B' })
      const own = subscriber(cardA.id)
      const foreign = subscriber(cardB.id)
      const timeline = await runtime.createNarrativeTimeline({ cardId: cardA.id, openingNodes: [{ content: 'Opening' }] })
      const created = commits.find(commit => commit.changesetId === timeline.mutation.changesetId)!
      const creationEvent = event('data.changed', summarizeDataCommit(created))
      const projected = await projectExtensionEvent(stores, creationEvent, own)
      expect((projected!.payload as JsonObject).operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ entityType: 'narrative.timeline', entityId: timeline.timeline.id }),
        expect.objectContaining({ entityType: 'narrative.branch', entityId: timeline.branch.id }),
        expect.objectContaining({ entityType: 'narrative.node', entityId: timeline.nodes[0]!.id }),
        expect.objectContaining({ entityType: 'state.scope' }),
        expect.objectContaining({ entityType: 'state.revision' }),
      ]))
      expect(await projectExtensionEvent(stores, creationEvent, foreign)).toBeUndefined()
      const { agentPreset } = await runtime.createAgentPreset({ name: 'Writer' })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: timeline.timeline.id })
      const actor = { kind: 'system' as const, id: 'test' }
      const attached = await agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'user', content: 'Attached' } }],
      })
      const detached = await agents.updateSession({ actor, agentSessionId: session.id, timelineId: null })
      const standalone = await agents.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 1,
        entries: [{ entry: { kind: 'message', role: 'user', content: 'Standalone' } }],
      })
      for (const commit of [attached.commit, detached.commit]) {
        const input = event('data.changed', summarizeDataCommit(commit))
        expect(await projectExtensionEvent(stores, input, own)).toBeDefined()
        expect(await projectExtensionEvent(stores, input, foreign)).toBeUndefined()
      }
      expect(await projectExtensionEvent(stores, event('data.changed', summarizeDataCommit(standalone.commit)), own)).toBeUndefined()
      const deletion = await runtime.deleteNarrativeTimeline({ timelineId: timeline.timeline.id })
      expect(await narratives.getTimeline(timeline.timeline.id)).toBeNull()
      expect(await narratives.getNode(timeline.nodes[0]!.id)).toBeNull()
      expect(await narratives.getBranch(timeline.branch.id)).toBeNull()
      expect(await projectExtensionEvent(stores, creationEvent, own)).toEqual(projected)
      const deleted = commits.find(commit => commit.changesetId === deletion.mutation.changesetId)!
      const deletedEvent = event('data.changed', summarizeDataCommit(deleted))
      expect((await projectExtensionEvent(stores, deletedEvent, own))!.payload).toMatchObject({
        operations: expect.arrayContaining([
          expect.objectContaining({ kind: 'delete', entityType: 'narrative.timeline' }),
          expect.objectContaining({ kind: 'delete', entityType: 'state.scope' }),
        ]),
      })
      expect(await projectExtensionEvent(stores, deletedEvent, foreign)).toBeUndefined()
    } finally {
      subscription.dispose()
      await engine.close()
    }
  })

  it('filters mixed commits by committed document ownership, including transfers and tombstones', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    try {
      const created = await documents.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        for (const [id, ownerPackage, target] of [
          ['A-owned', packageId, a.target], ['B-owned', packageId, b.target],
          ['global-owned', packageId, undefined], ['other-package', 'other.package', a.target],
        ] as const) {
          await tx.write({
            id, type: 'test.note', content: {}, expectedVersion: 'new',
            meta: {
              ownerExtensionId: ownerPackage,
              ...(target ? { ownerInstallationId: extensionInstallationId(ownerPackage, target) } : {}),
            },
          })
        }
      })
      const documentEvent = event('docs.changed', summarizeDocumentCommit(created.commit))
      const dataEvent = event('data.changed', summarizeDataCommit(created.commit))
      for (const input of [documentEvent, dataEvent]) {
        const result = await projectExtensionEvent({ documents }, input, a)
        expect(result).toMatchObject({ payload: { changesetId: created.commit.changesetId, operations: [expect.any(Object)] } })
        expect(JSON.stringify(result)).toContain('A-owned')
        for (const foreign of ['B-owned', 'global-owned', 'other-package']) expect(JSON.stringify(result)).not.toContain(foreign)
        expect((result!.payload as { operations: unknown[] }).operations).toHaveLength(1)
        expect(await projectExtensionEvent({ documents }, input, { ...a, target: { kind: 'global' } })).toEqual(input)
      }
      expect((await projectExtensionEvent({ documents }, documentEvent, a))!.payload).toMatchObject({
        documents: [{ id: 'A-owned', type: 'test.note', version: 1, tombstoned: false }],
      })
      const moved = await documents.write({
        id: 'A-owned', type: 'test.note', content: {}, expectedVersion: 1,
        meta: { ownerInstallationId: extensionInstallationId(packageId, b.target) },
      })
      expect(await projectExtensionEvent({ documents }, documentEvent, a)).toBeDefined()
      const movedEvent = event('docs.changed', summarizeDocumentCommit(moved.commit))
      expect(await projectExtensionEvent({ documents }, movedEvent, a)).toBeUndefined()
      expect(await projectExtensionEvent({ documents }, movedEvent, b)).toBeDefined()
      const deleted = await documents.delete({ id: 'A-owned', expectedVersion: 2 })
      const deletion = event('docs.changed', summarizeDocumentCommit(deleted.commit))
      expect(await projectExtensionEvent({ documents }, deletion, a)).toBeUndefined()
      expect((await projectExtensionEvent({ documents }, deletion, b))!.payload).toMatchObject({
        documents: [{ id: 'A-owned', version: 3, tombstoned: true }],
      })
      const restored = await documents.revertChangeset({
        changesetId: deleted.changesetId, actor: { kind: 'system', id: 'test' },
      })
      const rollback = event('docs.rollback.completed', {
        ...summarizeDocumentCommit(restored.commit) as JsonObject, targetChangesetId: deleted.changesetId,
      })
      expect(await projectExtensionEvent({ documents }, rollback, a)).toBeUndefined()
      expect((await projectExtensionEvent({ documents }, rollback, b))!.payload).toMatchObject({
        targetChangesetId: deleted.changesetId,
        documents: [{ id: 'A-owned', version: 4, tombstoned: false }],
      })
      expect(await projectExtensionEvent({ documents }, event('data.changed', {
        changesetId: 'non-document-commit',
        operations: [{ store: 'state', kind: 'create', entityId: 'foreign-state', entityType: 'revision', toVersion: 1 }],
      }), a)).toBeUndefined()
      expect(await projectExtensionEvent({ documents }, event('entity.lifecycle.changed', {
        root: { kind: 'card', id: 'B' }, operation: 'tombstoned',
      }), a)).toBeUndefined()
      expect(await projectExtensionEvent({ documents }, event('diagnostics.updated', { count: 10 }), a)).toBeUndefined()
    } finally {
      await engine.close()
    }
  })
})
