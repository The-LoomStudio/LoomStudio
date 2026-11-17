import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/kernel/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/kernel/document-store'
import { applicationDocumentTypes, createApplicationRuntime, extensionInstallationId } from '@loom-studio/application-runtime'
import { createAgentStore, createNarrativeStore, createPromptResourceStore, createStateStore } from '@loom-studio/application-runtime/data'
import type { DataCommitFact } from '@loom-studio/kernel/data-engine'
import { createId, nowIso, type JsonObject } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'
import { compactCommitPayload } from '../../../packages/kernel/src/commit-notifications.js'
import { summarizeDataCommit } from '../../../packages/kernel/src/handlers.js'
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
      for (const name of ['diagnostics.updated', 'extensions.data.changed', 'directories.media.changed']) {
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
        const input = event('data.changed', { ...summarizeDataCommit(created.commit) as JsonObject, chunk: { index: 1, count: 3 } })
        const result = await projectExtensionEvent({ documents }, input, target)
        expect(result!.payload).not.toHaveProperty('chunk')
        const operations = (result!.payload as JsonObject).operations as JsonObject[]
        expect(operations).toHaveLength(resourceTypes.length)
        expect(operations.every(operation => {
          const id = operation.entityId
          return id === extensionInstallationId(packageId, target.target) || (typeof id === 'string' && id.startsWith(`${target.target.cardId}:airp.`))
        })).toBe(true)
      }
      const deletion = event('data.changed', summarizeDataCommit(deleted.commit))
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
        actor, id: 'lore', resourceKind: 'lore',
        rootNode: { id: 'lore-root', kind: 'module', label: 'Setting', children: [] },
      })
      const mount = await promptResources.addLoreMount({
        actor, source: { kind: 'preset', id: preset.resource.id }, loreResourceId: setting.resource.id, orderIndex: 0,
      })
      const tool = await promptResources.addPresetToolMount({
        actor, presetResourceId: preset.resource.id, toolId: 'example/tool', orderIndex: 0, defaultEnabled: true,
      })
      const manual = await promptResources.addLoreMount({
        actor, source: { kind: 'manual' }, loreResourceId: setting.resource.id, orderIndex: 0,
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
      const timeline = await runtime.createNarrativeTimeline({ cardId: cardA.id, openingContent: 'Opening' })
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
      const dataEvent = event('data.changed', summarizeDataCommit(created.commit))
      const result = await projectExtensionEvent({ documents }, dataEvent, a)
      expect(result).toMatchObject({ payload: { changesetId: created.commit.changesetId, operations: [expect.any(Object)] } })
      expect(JSON.stringify(result)).toContain('A-owned')
      for (const foreign of ['B-owned', 'global-owned', 'other-package']) expect(JSON.stringify(result)).not.toContain(foreign)
      expect((result!.payload as { operations: unknown[] }).operations).toHaveLength(1)
      expect(await projectExtensionEvent({ documents }, dataEvent, { ...a, target: { kind: 'global' } })).toEqual(dataEvent)
      const moved = await documents.write({
        id: 'A-owned', type: 'test.note', content: {}, expectedVersion: 1,
        meta: { ownerInstallationId: extensionInstallationId(packageId, b.target) },
      })
      expect(await projectExtensionEvent({ documents }, dataEvent, a)).toBeDefined()
      const movedEvent = event('data.changed', summarizeDataCommit(moved.commit))
      expect(await projectExtensionEvent({ documents }, movedEvent, a)).toBeUndefined()
      expect((await projectExtensionEvent({ documents }, movedEvent, b))!.payload).toMatchObject({
        operations: [expect.objectContaining({ kind: 'update', entityId: 'A-owned', fromVersion: 1, toVersion: 2 })],
      })
      const deleted = await documents.delete({ id: 'A-owned', expectedVersion: 2 })
      const deletion = event('data.changed', summarizeDataCommit(deleted.commit))
      expect(await projectExtensionEvent({ documents }, deletion, a)).toBeUndefined()
      expect((await projectExtensionEvent({ documents }, deletion, b))!.payload).toMatchObject({
        operations: [expect.objectContaining({ kind: 'delete', entityId: 'A-owned', fromVersion: 2, toVersion: 3 })],
      })
      const restored = await documents.revertChangeset({
        changesetId: deleted.changesetId, actor: { kind: 'system', id: 'test' },
      })
      const revertedEvent = event('data.changed', summarizeDataCommit(restored.commit))
      expect(await projectExtensionEvent({ documents }, revertedEvent, a)).toBeUndefined()
      expect((await projectExtensionEvent({ documents }, revertedEvent, b))!.payload).toMatchObject({
        operations: [expect.objectContaining({ kind: 'restore', entityId: 'A-owned', fromVersion: 3, toVersion: 4 })],
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

  it('uses upfront scope tags and preserves overflow=true on compacted data.changed events', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const installationA = extensionInstallationId(packageId, a.target)
    const installationB = extensionInstallationId(packageId, b.target)
    try {
      const scoped = event('data.changed', {
        changesetId: 'scoped-changeset',
        operations: [
          {
            store: 'documents', kind: 'update', entityId: 'unpersisted-id', entityType: 'test.note', toVersion: 1,
            scope: { installationId: installationA, cardId: 'A' },
          },
          {
            store: 'narrative', kind: 'create', entityId: 'node-a', entityType: 'narrative.node',
            scope: { cardId: 'A' },
          },
          {
            store: 'documents', kind: 'update', entityId: 'b-id', entityType: 'test.note', toVersion: 1,
            scope: { installationId: installationB, cardId: 'B' },
          },
          {
            store: 'documents', kind: 'update', entityId: 'mismatch-id', entityType: 'test.note', toVersion: 1,
            scope: { installationId: installationA, cardId: 'B' },
          },
        ],
      })
      expect(await projectExtensionEvent({ documents }, scoped, a)).toMatchObject({
        payload: {
          changesetId: 'scoped-changeset',
          operations: [
            expect.objectContaining({ entityId: 'unpersisted-id', scope: { installationId: installationA, cardId: 'A' } }),
            expect.objectContaining({ entityId: 'node-a', scope: { cardId: 'A' } }),
          ],
        },
      })
      expect(await projectExtensionEvent({ documents }, scoped, { ...a, packageId: 'other.package' })).toMatchObject({
        payload: {
          changesetId: 'scoped-changeset',
          operations: [expect.objectContaining({ entityId: 'node-a', scope: { cardId: 'A' } })],
        },
      })

      const compacted = compactCommitPayload({
        changesetId: 'overflow-changeset',
        operations: [
          ...Array.from({ length: 40 }, (_, index) => ({
            store: 'documents', kind: 'create', entityId: `a-${index}`, entityType: 'test.note', toVersion: 1,
            scope: { installationId: installationA, cardId: 'A' },
          })),
          ...Array.from({ length: 40 }, (_, index) => ({
            store: 'narrative', kind: 'create', entityId: `b-${index}`, entityType: 'narrative.node',
            scope: { cardId: 'B' },
          })),
        ],
      }, 64 * 1024) as JsonObject
      expect(compacted.overflow).toBe(true)

      const overflowEvent = event('data.changed', compacted)
      const projectedA = await projectExtensionEvent({ documents }, overflowEvent, a)
      expect(projectedA?.payload).toMatchObject({
        changesetId: 'overflow-changeset',
        overflow: true,
        operations: [expect.objectContaining({ count: 40, scope: { installationId: installationA, cardId: 'A' } })],
      })
      expect(await projectExtensionEvent({ documents }, overflowEvent, b)).toMatchObject({
        payload: {
          changesetId: 'overflow-changeset',
          overflow: true,
          operations: [expect.objectContaining({ count: 40, scope: { cardId: 'B' } })],
        },
      })

      const unscopedDocOverflow = event('data.changed', {
        changesetId: 'unscoped-doc-overflow',
        overflow: true,
        operations: [{ store: 'documents', kind: 'update', entityId: '*', entityType: '*' }],
      })
      expect(await projectExtensionEvent({ documents }, unscopedDocOverflow, a)).toBeUndefined()
    } finally {
      await engine.close()
    }
  })

  it('preserves card/installation attribution scope and projects >32 KiB real document commits with distinct entityIds', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const installationA = extensionInstallationId(packageId, a.target)
    const installationB = extensionInstallationId(packageId, b.target)
    try {
      const committed = await documents.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        for (let index = 0; index < 140; index++) {
          await tx.write({
            id: `card-a-distinct-document-identifier-${String(index).padStart(4, '0')}`,
            type: 'test.note',
            content: { index },
            expectedVersion: 'new',
            meta: { ownerExtensionId: packageId, ownerInstallationId: installationA },
          })
          await tx.write({
            id: `card-b-distinct-document-identifier-${String(index).padStart(4, '0')}`,
            type: 'test.note',
            content: { index },
            expectedVersion: 'new',
            meta: { ownerExtensionId: packageId, ownerInstallationId: installationB },
          })
        }
        await tx.write({
          id: 'unscoped-doc-1',
          type: 'test.note',
          content: {},
          expectedVersion: 'new',
        })
      })

      const rawSummary = summarizeDataCommit(committed.commit)
      expect(Buffer.byteLength(JSON.stringify(rawSummary), 'utf8')).toBeGreaterThan(32 * 1024)

      const compacted = compactCommitPayload(rawSummary, 64 * 1024) as JsonObject
      expect(compacted.overflow).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(compacted), 'utf8')).toBeLessThanOrEqual(64 * 1024)
      expect(compacted.operations).toEqual(expect.arrayContaining([
        {
          store: 'documents',
          kind: 'create',
          entityType: 'test.note',
          entityId: '*',
          scope: { cardId: 'A', installationId: installationA },
          count: 140,
        },
        {
          store: 'documents',
          kind: 'create',
          entityType: 'test.note',
          entityId: '*',
          scope: { cardId: 'B', installationId: installationB },
          count: 140,
        },
        {
          store: 'documents',
          kind: 'create',
          entityType: 'test.note',
          entityId: '*',
          count: 1,
        },
      ]))

      const overflowEvent = event('data.changed', compacted)
      expect(await projectExtensionEvent({ documents }, overflowEvent, a)).toMatchObject({
        payload: {
          changesetId: committed.commit.changesetId,
          overflow: true,
          operations: [{
            store: 'documents',
            kind: 'create',
            entityType: 'test.note',
            entityId: '*',
            scope: { cardId: 'A', installationId: installationA },
            count: 140,
          }],
        },
      })
      expect(await projectExtensionEvent({ documents }, overflowEvent, b)).toMatchObject({
        payload: {
          changesetId: committed.commit.changesetId,
          overflow: true,
          operations: [{
            store: 'documents',
            kind: 'create',
            entityType: 'test.note',
            entityId: '*',
            scope: { cardId: 'B', installationId: installationB },
            count: 140,
          }],
        },
      })
      expect(await projectExtensionEvent({ documents }, overflowEvent, { ...a, packageId: 'other.package' })).toBeUndefined()
    } finally {
      await engine.close()
    }
  })
})
