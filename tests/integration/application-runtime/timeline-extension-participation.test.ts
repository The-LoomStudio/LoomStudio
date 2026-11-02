import { createApplicationRuntime, createStateContributionRegistry, applicationDocumentTypes } from '@loom-studio/application-runtime'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { describe, expect, it, vi } from 'vitest'
import { createBlobStore } from '@loom-studio/asset-store'
import { createAssetStore } from '@loom-studio/asset-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertTimelineExtensionLease,
  captureTimelineExtensionLease,
} from '../../../packages/application-runtime/src/extensions/timeline-participation.js'
import { readAvailableExtensionInstallations } from '../../../packages/application-runtime/src/runtime/extension-resource-access.js'
import { callApplicationRpc as handleStatesRpc } from '../../support/trpc-caller.js'

const builtinPlayerPaths = [
  { path: '$loom.players.User', kind: 'entity', present: true },
  { path: '$loom.players.User.components.loom_profile', kind: 'component', present: true },
]

async function setup() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-10-07T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const stateContributions = createStateContributionRegistry()
  let initializations = 0
  const registration = stateContributions.register({
    packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'server', instanceId: 'memory-server',
    contribution: {
      id: 'example.memory.state', entityTypes: [], entities: [], componentMounts: [],
      templates: [{ id: 'example.memory.data', templateVersion: 1, schema: { type: 'object' }, initial: { count: 0 } }],
      bindings: [{ path: 'memory', templateId: 'example.memory.data', templateVersion: 1 }],
    },
    initialize() { return { 'example.memory.data': { count: ++initializations } } },
  })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, promptResources, stateContributions })
  const { card } = await runtime.createCard({ name: 'Participation test' })
  const packageId = 'example.memory'
  const installationId = extensionInstallationId(packageId, { kind: 'global' })
  const actor = { kind: 'kernel' as const, id: 'test' }
  await documents.write({
    id: installationId, type: applicationDocumentTypes.extensionInstallation,
    content: { packageId, packageVersion: '1.0.0', participation: 'timeline', target: { kind: 'global' },
      source: { kind: 'git', url: 'https://example.com/memory.git' }, createdAt: now(), updatedAt: now() },
    expectedVersion: 'new', actor,
  })
  await runtime.updateCard({ cardId: card.id, extensionAdoptions: [{ packageId, target: 'global' }] })
  const a = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
  const b = await runtime.createNarrativeTimeline({ cardId: card.id })
  return { engine, documents, narratives, runtime, a, b, card, installationId, actor, stateContributions, registration,
    initializations: () => initializations, context: { documents, narratives, createId } }
}

describe('Timeline extension participation', () => {
  it('notifies target invalidation and rejects an Asset prepared before its story was paused', async () => {
    const f = await setup()
    const root = await mkdtemp(join(tmpdir(), 'timeline-assets-'))
    const blobs = createBlobStore({ engine: f.engine, rootDirectory: root, createId: f.context.createId, now: () => 'now' })
    const assets = createAssetStore({ engine: f.engine, blobs, createId: f.context.createId, now: () => 'now' })
    const changed = vi.fn()
    const subscription = f.runtime.subscribeTimelineExtensionTargets({ installationId: f.installationId }, changed)
    let release!: () => void
    let ready!: () => void
    const prepared = new Promise<void>(resolve => { ready = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    const prepareWrite = blobs.prepareWrite.bind(blobs)
    vi.spyOn(blobs, 'prepareWrite').mockImplementation(async input => {
      const result = await prepareWrite(input)
      ready()
      await pending
      return result
    })
    try {
      const work = f.runtime.runTimelineExtensionWork({ timelineId: f.a.timeline.id, installationId: f.installationId },
        () => assets.createMediaAsset({ source: new Uint8Array([1, 2]), kind: 'image', actor: f.actor }))
      await prepared
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: f.a.timeline.id, installationId: f.installationId, expectedVersion: 1, enabled: false,
      })
      release()
      await expect(work).rejects.toThrow('no longer active')
      expect(changed).toHaveBeenCalledOnce()
      expect(f.engine.database.prepare('SELECT id FROM media_assets').all()).toEqual([])
      subscription.dispose()
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: f.a.timeline.id, installationId: f.installationId, expectedVersion: 2, enabled: true,
      })
      expect(changed).toHaveBeenCalledOnce()
    } finally {
      subscription.dispose()
      release?.()
      await f.engine.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects late document and portable payload commits from paused or finished work while preserving global editing', async () => {
    const f = await setup()
    const write = () => f.documents.write({
      id: 'late', type: 'example.memory.result', content: {}, expectedVersion: 'new', actor: f.actor,
    })
    const payload = () => f.runtime.createPortableExtensionPayload({
      payload: { packageId: 'example.memory', fileName: 'memory.json', format: 'memory', mediaType: 'application/json', content: '{}' },
    })
    try {
      const work = await f.runtime.beginTimelineExtensionWork({ timelineId: f.a.timeline.id, installationId: f.installationId })
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: f.a.timeline.id, installationId: f.installationId, expectedVersion: 1, enabled: false,
      })
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: f.a.timeline.id, installationId: f.installationId, expectedVersion: 2, enabled: true,
      })
      await expect(work.run(write)).rejects.toThrow()
      await expect(work.run(payload)).rejects.toThrow()
      expect(await f.documents.get('late')).toBeNull()
      expect((await f.runtime.listPortableExtensionPayloads()).payloads).toEqual([])
      work.dispose()
      const finished = await f.runtime.beginTimelineExtensionWork({ timelineId: f.a.timeline.id, installationId: f.installationId })
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      const detached = finished.run(async () => { await pending; return write() })
      finished.dispose()
      release()
      await expect(detached).rejects.toThrow('finished')
      await write()
      await payload()
      expect(await f.documents.get('late')).not.toBeNull()
      expect((await f.runtime.listPortableExtensionPayloads()).payloads).toHaveLength(1)
    } finally { await f.engine.close() }
  })

  it('inspects accepted sources independently of current declarations, Card defaults and installation availability', async () => {
    const f = await setup()
    try {
      const target = { scope: 'timeline' as const, timelineId: f.a.timeline.id, branchId: f.a.branch.id }
      const snapshot = await f.runtime.getStateSnapshot({ target })
      await f.runtime.updateCard({ cardId: f.card.id, extensionAdoptions: [] })
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: target.timelineId, installationId: f.installationId, expectedVersion: 1, enabled: false,
      })
      const source = f.stateContributions.list()[0]!
      f.registration.dispose()
      source.contribution.templates[0]!.initial = { count: 999 }
      const current = f.stateContributions.register({
        ...source, instanceId: 'changed',
        initialize() { throw new Error('Inspection must never initialize') },
      })
      let commits = 0
      const subscription = f.engine.subscribeCommits(() => { commits++ })
      const inspected = await f.runtime.inspectStateSources({ target })
      subscription.dispose()
      expect(commits).toBe(0)
      expect(inspected.extensions[0]).toMatchObject({
        cardDefault: false, eligible: false, adoption: { enabled: false },
        registered: [{ declaration: { templates: [{ initial: { count: 999 } }] } }],
        accepted: [{ declaration: { templates: [{ initial: { count: 0 } }] } }],
      })
      expect(inspected.timeline).toMatchObject({
        revisionId: snapshot.snapshot.revisionId,
        paths: [...builtinPlayerPaths,
          { path: 'memory', kind: 'binding', installationId: f.installationId, present: true },
        ],
      })
      expect(inspected.card!.version).toBeGreaterThan(inspected.timeline!.context!.sourceCardVersion)
      current.dispose()
      await f.documents.delete({ id: f.installationId, expectedVersion: 1, actor: f.actor })
      const cardDocument = await f.documents.get(f.card.id)
      await f.documents.delete({ id: f.card.id, expectedVersion: cardDocument!.version, actor: f.actor })
      const unavailable = await f.runtime.inspectStateSources({ target })
      expect(unavailable.card).toBeNull()
      expect(unavailable.extensions[0]).toMatchObject({
        installation: null, target: { kind: 'global' }, registered: [], eligible: false,
        accepted: inspected.extensions[0]!.accepted,
      })
      expect(unavailable.timeline).toEqual(inspected.timeline)
      expect(await f.runtime.getStateSnapshot({ target })).toEqual(snapshot)
      expect(f.initializations()).toBe(2)
    } finally { f.engine.close() }
  })

  it('inspects native entities and components in an old checkpoint without initializing their missing data', async () => {
    const f = await setup()
    try {
      f.stateContributions.register({
        packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'server', instanceId: 'world',
        contribution: {
          id: 'example.memory.world',
          entityTypes: [{ id: 'world', collectionPath: 'worlds' }],
          entities: [{ typeId: 'world', entityId: 'main' }],
          templates: [{ id: 'example.memory.clock', templateVersion: 1, componentKey: 'clock',
            targetEntityTypeIds: ['world'], schema: { type: 'object' }, initial: { time: 'day' } }],
          componentMounts: [{ templateId: 'example.memory.clock', templateVersion: 1, componentKey: 'clock',
            target: { kind: 'entity', entity: { typeId: 'world', entityId: 'main' } } }],
          bindings: [],
        },
      })
      const { card } = await f.runtime.createCard({ name: 'Checkpoint source inspection' })
      const story = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
      const checkpoint = await f.runtime.forkNarrativeBranch({
        timelineId: story.timeline.id, fromBranchId: story.branch.id, fromNodeId: story.nodes[0]!.id,
      })
      const target = { scope: 'timeline' as const, timelineId: story.timeline.id, branchId: story.branch.id }
      await f.runtime.updateCard({ cardId: card.id, extensionAdoptions: [{ packageId: 'example.memory', target: 'global' }] })
      const notAdopted = await f.runtime.inspectStateSources({ target })
      expect(notAdopted.extensions[0]).toMatchObject({ cardDefault: true, adoption: null, eligible: false, accepted: [] })
      expect(notAdopted.extensions[0]!.registered).toHaveLength(2)
      expect(notAdopted.timeline!.paths).toEqual(builtinPlayerPaths)
      await f.runtime.adoptTimelineExtension(await f.runtime.previewTimelineExtensionAdoption({
        timelineId: target.timelineId, branchId: target.branchId, installationId: f.installationId,
      }))
      const oldTarget = { ...target, branchId: checkpoint.branch.id }
      const before = await f.runtime.getStateSnapshot({ target: oldTarget })
      const old = await f.runtime.inspectStateSources({ target: oldTarget })
      const current = await f.runtime.inspectStateSources({ target })
      expect(old.extensions[0]).toMatchObject({ eligible: true, adoption: { enabled: true } })
      expect(old.extensions[0]!.accepted).toHaveLength(2)
      expect(old.timeline!.paths).toEqual(expect.arrayContaining([
        { path: 'worlds.main', kind: 'entity', installationId: f.installationId, present: false },
        { path: 'worlds.main.components.clock', kind: 'component', installationId: f.installationId, present: false },
      ]))
      expect(old.timeline!.paths.filter(path => path.installationId === f.installationId).every(path => !path.present)).toBe(true)
      expect(old.timeline!.paths.filter(path => !path.installationId)).toEqual(builtinPlayerPaths)
      expect(current.timeline!.paths.every(path => path.present)).toBe(true)
      expect(current.extensions[0]!.adoption).toEqual(old.extensions[0]!.adoption)
      expect(await f.runtime.getStateSnapshot({ target: oldTarget })).toEqual(before)
      expect(f.initializations()).toBe(3)
    } finally { f.engine.close() }
  })

  it('scopes inspection to the Timeline Card, preserves workspace definitions and rejects mismatched targets', async () => {
    const f = await setup()
    try {
      const other = await f.runtime.createCard({ name: 'Private source' })
      const global = f.stateContributions.list()[0]!
      for (const cardId of [f.card.id, other.card.id]) {
        f.stateContributions.register({ ...global, target: { kind: 'card', cardId }, instanceId: cardId })
      }
      await f.runtime.upsertStateDefinition({
        definitionId: 'workspace.clock', definition: { kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {} },
      })
      const target = { scope: 'timeline' as const, timelineId: f.a.timeline.id, branchId: f.a.branch.id }
      const inspection = await handleStatesRpc(f.runtime, 'application.inspectStateSources', { target })
      expect(inspection).toEqual(await f.runtime.inspectStateSources({ target }))
      const forCard = await f.runtime.inspectStateSources({ cardId: f.card.id })
      expect(forCard.extensions.map(source => source.target)).toEqual(expect.arrayContaining([
        { kind: 'global' }, { kind: 'card', cardId: f.card.id },
      ]))
      expect(forCard.extensions).toHaveLength(2)
      expect(forCard.timeline).toBeNull()
      expect(forCard.definitions).toMatchObject([{ id: 'workspace.clock' }])
      expect((await f.runtime.inspectStateSources({})).extensions).toHaveLength(1)
      await expect(f.runtime.inspectStateSources({ target, cardId: other.card.id })).rejects.toThrow('does not belong')
      await expect(f.runtime.inspectStateSources({ target: { ...target, branchId: f.b.branch.id } })).rejects.toThrow('not initialized')
      await expect(handleStatesRpc(f.runtime, 'application.inspectStateSources', { target: { scope: 'global' } })).rejects.toThrow('Timeline target')
      await expect(handleStatesRpc(f.runtime, 'application.inspectStateSources', { target: { scope: 'timeline' } })).rejects.toThrow('target.timelineId')
    } finally { f.engine.close() }
  })

  it('records initial State ownership by the declaring mount, including batch mounts and wildcard bindings', async () => {
    const f = await setup()
    try {
      f.stateContributions.register({
        packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'server', instanceId: 'ec-owner',
        contribution: {
          id: 'example.memory.ec',
          entityTypes: [{ id: 'world', collectionPath: 'worlds' }],
          entities: [{ typeId: 'world', entityId: 'main' }],
          templates: [
            { id: 'example.memory.flag', templateVersion: 1, componentKey: 'flag', schema: { type: 'object' }, initial: {} },
            { id: 'example.memory.notes', templateVersion: 1, schema: { type: 'object' }, initial: {} },
          ],
          componentMounts: [
            { templateId: 'card.clock', templateVersion: 1, componentKey: 'clock',
              target: { kind: 'entity', entity: { typeId: 'world', entityId: 'main' } } },
            { templateId: 'example.memory.flag', templateVersion: 1, componentKey: 'flag', target: { kind: 'entity-type', typeId: 'person' } },
          ],
          bindings: [{ path: 'people.*.components.notes', templateId: 'example.memory.notes', templateVersion: 1 }],
        },
      })
      const { card } = await f.runtime.createCard({ name: 'Shared template ownership' })
      await f.runtime.updateCard({
        cardId: card.id, extensionAdoptions: [{ packageId: 'example.memory', target: 'global' }],
        stateTemplates: [{ id: 'card.clock', templateVersion: 1, componentKey: 'clock', schema: { type: 'object' }, initial: {} }],
        stateEntityTypes: [{ id: 'person', collectionPath: 'people' }],
        timelineStateEntities: [{ typeId: 'person', entityId: 'alice' }, { typeId: 'person', entityId: 'bob' }],
        timelineComponentMounts: [{ templateId: 'card.clock', templateVersion: 1, componentKey: 'clock',
          target: { kind: 'entity', entity: { typeId: 'person', entityId: 'alice' } } }],
      })
      const story = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const inspection = await f.runtime.inspectStateSources({
        target: { scope: 'timeline', timelineId: story.timeline.id, branchId: story.branch.id },
      })
      const paths = inspection.timeline!.paths
      const extensionPaths = paths.filter(path => path.installationId === f.installationId).map(path => path.path)
      expect(extensionPaths.sort()).toEqual([
        'memory', 'people.alice.components.flag', 'people.alice.components.notes',
        'people.bob.components.flag', 'people.bob.components.notes', 'worlds.main', 'worlds.main.components.clock',
      ].sort())
      expect(paths.find(path => path.path === 'people.alice.components.clock')).toMatchObject({ present: true, installationId: undefined })
      expect(paths.find(path => path.path === 'people.alice')).toMatchObject({ present: true, installationId: undefined })
    } finally { f.engine.close() }
  })

  it('holds an explicit work scope until disposal or Timeline cancellation without cancelling another story', async () => {
    const f = await setup()
    try {
      const a = await f.runtime.beginTimelineExtensionWork({ timelineId: f.a.timeline.id, installationId: f.installationId })
      const b = await f.runtime.beginTimelineExtensionWork({ timelineId: f.b.timeline.id, installationId: f.installationId })
      expect(a.signal.aborted).toBe(false)
      await f.runtime.assertTimelineExtensionWork(a.lease)
      const cancelled = new Promise<void>(resolve => a.signal.addEventListener('abort', () => resolve(), { once: true }))
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: f.a.timeline.id, installationId: f.installationId, expectedVersion: 1, enabled: false,
      })
      await cancelled
      expect(b.signal.aborted).toBe(false)
      await f.runtime.assertTimelineExtensionWork(b.lease)
      a.dispose()
      a.dispose()
      b.dispose()
      expect(b.signal.aborted).toBe(true)
    } finally { f.engine.close() }
  })

  it('previews without initializing, then adopts into one checkpoint without resetting other branches', async () => {
    const { engine, runtime, installationId, initializations } = await setup()
    try {
      const { card } = await runtime.createCard({ name: 'Late adoption' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
      const checkpoint = await runtime.forkNarrativeBranch({
        timelineId: story.timeline.id, fromBranchId: story.branch.id, fromNodeId: story.nodes[0]!.id,
      })
      const input = { timelineId: story.timeline.id, branchId: story.branch.id, installationId }
      const preview = await runtime.previewTimelineExtensionAdoption(input)
      expect(preview.paths).toEqual(['/memory'])
      expect(initializations()).toBe(2)
      expect((await runtime.getTimelineExtensionParticipation(input)).entries).toEqual([])
      await runtime.adoptTimelineExtension(preview)
      expect(initializations()).toBe(3)
      const current = await runtime.getStateSnapshot({ target: { scope: 'timeline', timelineId: input.timelineId, branchId: input.branchId } })
      expect(current.snapshot.value).toMatchObject({ memory: { count: 3 } })
      const oldTarget = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: checkpoint.branch.id }
      const old = await runtime.getStateSnapshot({ target: oldTarget })
      expect(old.snapshot.value).not.toHaveProperty('memory')
      const edited = await runtime.applyStateMutation({
        target: oldTarget, expectedRevisionId: old.snapshot.revisionId,
        operations: [{ op: 'set', path: '/note', value: 'Checkpoint data' }],
      })
      expect(edited.snapshot.value).not.toHaveProperty('memory')
      await expect(runtime.applyStateMutation({
        target: current.snapshot.target, expectedRevisionId: current.snapshot.revisionId,
        operations: [{ op: 'remove', path: '/memory' }],
      })).rejects.toThrow('missing')
      await expect(runtime.adoptTimelineExtension(preview)).rejects.toThrow('already been adopted')
      const checkpointInput = { ...input, branchId: checkpoint.branch.id }
      const config = await runtime.getTimelineExtensionParticipation(input)
      const initialization = await runtime.previewTimelineExtensionStateInitialization(checkpointInput)
      expect(initialization.paths).toEqual(['/memory'])
      expect(initializations()).toBe(3)
      await runtime.initializeTimelineExtensionState(initialization)
      expect(initializations()).toBe(4)
      expect((await runtime.getStateSnapshot({ target: oldTarget })).snapshot.value)
        .toMatchObject({ memory: { count: 4 }, note: 'Checkpoint data' })
      expect((await runtime.getStateSnapshot({ target: current.snapshot.target })).snapshot).toEqual(current.snapshot)
      expect(await runtime.getTimelineExtensionParticipation(input)).toEqual(config)
      const complete = await runtime.previewTimelineExtensionStateInitialization(checkpointInput)
      expect(complete.paths).toEqual([])
      await expect(runtime.initializeTimelineExtensionState(complete)).rejects.toThrow('no missing data')
      expect(initializations()).toBe(4)
    } finally { engine.close() }
  })

  it.each(['pause', 'failure', 'stale'] as const)('keeps checkpoint data unchanged when explicit initialization encounters %s', async reason => {
    const f = await setup()
    try {
      const { card } = await f.runtime.createCard({ name: 'Checkpoint initialization' })
      const story = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
      const checkpoint = await f.runtime.forkNarrativeBranch({
        timelineId: story.timeline.id, fromBranchId: story.branch.id, fromNodeId: story.nodes[0]!.id,
      })
      const input = { timelineId: story.timeline.id, branchId: story.branch.id, installationId: f.installationId }
      await f.runtime.adoptTimelineExtension(await f.runtime.previewTimelineExtensionAdoption(input))
      const config = await f.runtime.getTimelineExtensionParticipation(input)
      const source = f.stateContributions.list()[0]!
      f.registration.dispose()
      let calls = 0
      f.stateContributions.register({
        ...source, instanceId: 'replacement',
        async initialize({ signal }) {
          calls++
          if (reason === 'failure') throw new Error('Checkpoint initializer failed')
          await f.runtime.updateTimelineExtensionParticipation({
            timelineId: input.timelineId, installationId: input.installationId, expectedVersion: config.version, enabled: false,
          })
          signal.throwIfAborted()
          return { 'example.memory.data': { count: 99 } }
        },
      })
      const checkpointInput = { ...input, branchId: checkpoint.branch.id }
      const target = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: checkpoint.branch.id }
      const preview = await f.runtime.previewTimelineExtensionStateInitialization(checkpointInput)
      if (reason === 'stale') {
        await f.runtime.applyStateMutation({
          target, expectedRevisionId: preview.expectedStateRevisionId, operations: [{ op: 'set', path: '/note', value: 'Keep' }],
        })
      }
      const before = await f.runtime.getStateSnapshot({ target })
      await expect(f.runtime.initializeTimelineExtensionState(preview)).rejects.toThrow(
        reason === 'failure' ? 'Checkpoint initializer failed' : reason === 'stale' ? 'stale' : /no longer active/,
      )
      expect(calls).toBe(reason === 'stale' ? 0 : 1)
      expect((await f.runtime.getStateSnapshot({ target })).snapshot).toEqual(before.snapshot)
      if (reason === 'pause') {
        await expect(f.runtime.previewTimelineExtensionStateInitialization(checkpointInput)).rejects.toThrow('not active')
      }
    } finally { f.engine.close() }
  })

  it('initializes missing entity components without replacing existing components or unrelated entity values', async () => {
    const f = await setup()
    try {
      f.stateContributions.register({
        packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'server', instanceId: 'world-server',
        contribution: {
          id: 'example.memory.world',
          entityTypes: [{ id: 'world', collectionPath: 'worlds' }],
          entities: [{ typeId: 'world', entityId: 'main' }],
          templates: ['clock', 'weather'].map(componentKey => ({
            id: `example.memory.${componentKey}`, templateVersion: 1, componentKey, targetEntityTypeIds: ['world'],
            schema: { type: 'object' }, initial: { value: 'default' },
          })),
          componentMounts: ['clock', 'weather'].map(componentKey => ({
            templateId: `example.memory.${componentKey}`, templateVersion: 1, componentKey,
            target: { kind: 'entity' as const, entity: { typeId: 'world', entityId: 'main' } },
          })),
          bindings: [],
        },
      })
      const { card } = await f.runtime.createCard({ name: 'Entity checkpoint' })
      const story = await f.runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'Opening' })
      const checkpoint = await f.runtime.forkNarrativeBranch({
        timelineId: story.timeline.id, fromBranchId: story.branch.id, fromNodeId: story.nodes[0]!.id,
      })
      const input = { timelineId: story.timeline.id, branchId: story.branch.id, installationId: f.installationId }
      await f.runtime.adoptTimelineExtension(await f.runtime.previewTimelineExtensionAdoption(input))
      const target = { scope: 'timeline' as const, timelineId: input.timelineId, branchId: checkpoint.branch.id }
      const checkpointInput = { ...input, branchId: checkpoint.branch.id }
      const empty = await f.runtime.previewTimelineExtensionStateInitialization(checkpointInput)
      expect(empty.paths).toEqual(expect.arrayContaining(['/memory', '/worlds/main']))
      await f.runtime.applyStateMutation({
        target, expectedRevisionId: empty.expectedStateRevisionId,
        operations: [{ op: 'set', path: '/worlds/main', value: { label: 'Keep this', components: { clock: { value: 'custom' } } } }],
      })
      const partial = await f.runtime.previewTimelineExtensionStateInitialization(checkpointInput)
      expect([...partial.paths].sort()).toEqual(['/memory', '/worlds/main/components/weather'])
      await f.runtime.initializeTimelineExtensionState(partial)
      expect((await f.runtime.getStateSnapshot({ target })).snapshot.value).toMatchObject({
        worlds: { main: { label: 'Keep this', components: { clock: { value: 'custom' }, weather: { value: 'default' } } } },
      })
      expect((await f.runtime.previewTimelineExtensionStateInitialization(checkpointInput)).paths).toEqual([])
    } finally { f.engine.close() }
  })

  it('rejects occupied State paths and stale adoption previews before running initialization', async () => {
    const { engine, runtime, installationId, initializations } = await setup()
    try {
      const { card } = await runtime.createCard({ name: 'Conflict' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id })
      const input = { timelineId: story.timeline.id, branchId: story.branch.id, installationId }
      const preview = await runtime.previewTimelineExtensionAdoption(input)
      await runtime.applyStateMutation({
        target: { scope: 'timeline', timelineId: input.timelineId, branchId: input.branchId },
        expectedRevisionId: preview.expectedStateRevisionId,
        operations: [{ op: 'set', path: '/note', value: 'Changed' }],
      })
      await expect(runtime.adoptTimelineExtension(preview)).rejects.toThrow('stale')
      const updated = await runtime.previewTimelineExtensionAdoption(input)
      await runtime.applyStateMutation({
        target: { scope: 'timeline', timelineId: input.timelineId, branchId: input.branchId },
        expectedRevisionId: updated.expectedStateRevisionId,
        operations: [{ op: 'set', path: '/memory', value: { custom: true } }],
      })
      await expect(runtime.previewTimelineExtensionAdoption(input)).rejects.toThrow('overwrite')
      expect(initializations()).toBe(2)
      expect((await runtime.getTimelineExtensionParticipation(input)).entries).toEqual([])
    } finally { engine.close() }
  })

  it('does not commit adoption or partial State when a late initializer fails', async () => {
    const { engine, runtime, installationId, stateContributions } = await setup()
    try {
      const { card } = await runtime.createCard({ name: 'Failed late adoption' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id })
      stateContributions.register({
        packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'extra', instanceId: 'late-failure',
        contribution: {
          id: 'example.memory.extra', entityTypes: [], entities: [], componentMounts: [],
          templates: [{ id: 'example.memory.extra', templateVersion: 1, schema: { type: 'object' }, initial: {} }],
          bindings: [{ path: 'extra', templateId: 'example.memory.extra', templateVersion: 1 }],
        },
        initialize() { throw new Error('Late initialization failed') },
      })
      const input = { timelineId: story.timeline.id, branchId: story.branch.id, installationId }
      const before = await runtime.getStateSnapshot({ target: { scope: 'timeline', timelineId: input.timelineId, branchId: input.branchId } })
      const preview = await runtime.previewTimelineExtensionAdoption(input)
      await expect(runtime.adoptTimelineExtension(preview)).rejects.toThrow('Late initialization failed')
      expect(await runtime.getStateSnapshot({ target: before.snapshot.target })).toEqual(before)
      expect((await runtime.getTimelineExtensionParticipation(input)).entries).toEqual([])
    } finally { engine.close() }
  })

  it('cancels adopted work on pause and keeps another Timeline task running', async () => {
    const { engine, runtime, a, b, installationId } = await setup()
    try {
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      let finishOther!: () => void
      let otherSignal!: AbortSignal
      const other = runtime.runTimelineExtensionWork({
        timelineId: b.timeline.id, installationId,
      }, async ({ signal }) => {
        otherSignal = signal
        await new Promise<void>(resolve => { finishOther = resolve })
        return 'B finished'
      })
      const work = runtime.runTimelineExtensionWork({
        timelineId: a.timeline.id, installationId,
      }, async ({ signal }) => {
        started()
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
        return 'must not finish'
      })
      const rejected = expect(work).rejects.toThrow('no longer active')
      await ready
      await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled: false,
      })
      await rejected
      expect(otherSignal.aborted).toBe(false)
      finishOther()
      await expect(other).resolves.toBe('B finished')
      let called = false
      await expect(runtime.runTimelineExtensionWork({
        timelineId: a.timeline.id, installationId,
      }, async () => { called = true })).rejects.toThrow('not active')
      expect(called).toBe(false)
      await expect(runtime.runTimelineExtensionWork({
        timelineId: b.timeline.id, installationId, packageVersion: '2.0.0',
      }, async () => { called = true })).rejects.toThrow('Running extension version')
      expect(called).toBe(false)
    } finally { engine.close() }
  })

  it('uses Card defaults only for new stories and keeps unadopted State absent', async () => {
    const { engine, runtime, a, card, initializations } = await setup()
    try {
      await runtime.updateCard({ cardId: card.id, extensionAdoptions: [] })
      const newStory = await runtime.createNarrativeTimeline({ cardId: card.id })
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: newStory.timeline.id })).entries).toEqual([])
      expect((await runtime.getStateSnapshot({
        target: { scope: 'timeline', timelineId: newStory.timeline.id, branchId: newStory.branch.id },
      })).snapshot.value).not.toHaveProperty('memory')
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })).entries[0]!.enabled).toBe(true)
      expect(initializations()).toBe(2)
    } finally { engine.close() }
  })

  it('applies per-story extension selection atomically without changing Card defaults', async () => {
    const { engine, runtime, card, initializations } = await setup()
    try {
      const before = (await runtime.getCard({ cardId: card.id })).card
      const excluded = await runtime.createNarrativeTimeline({ cardId: card.id, extensionAdoptions: [] })
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: excluded.timeline.id })).entries).toEqual([])
      expect(initializations()).toBe(2)
      await runtime.updateCard({ cardId: card.id, extensionAdoptions: [] })
      const included = await runtime.createNarrativeTimeline({ cardId: card.id,
        extensionAdoptions: [{ packageId: 'example.memory', target: 'global' }],
      })
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: included.timeline.id })).entries[0]!.enabled).toBe(true)
      expect((await runtime.getStateSnapshot({ target: {
        scope: 'timeline', timelineId: included.timeline.id, branchId: included.branch.id,
      } })).snapshot.value).toMatchObject({ memory: { count: 3 } })
      expect((await runtime.getCard({ cardId: card.id })).card.extensionAdoptions).toEqual([])
      expect(before.extensionAdoptions).toEqual([{ packageId: 'example.memory', target: 'global' }])
    } finally { engine.close() }
  })

  it('leaves neither a Timeline nor adoption metadata when initialization fails', async () => {
    const { engine, documents, runtime, card, stateContributions } = await setup()
    try {
      stateContributions.register({
        packageId: 'example.memory', packageVersion: '1.0.0', moduleId: 'extra', instanceId: 'failing',
        contribution: {
          id: 'example.memory.extra', entityTypes: [], entities: [], componentMounts: [],
          templates: [{ id: 'example.memory.extra', templateVersion: 1, schema: { type: 'object' }, initial: {} }],
          bindings: [{ path: 'extra', templateId: 'example.memory.extra', templateVersion: 1 }],
        },
        initialize() { throw new Error('Initialization failed') },
      })
      const before = await runtime.listNarrativeTimelines()
      const configsBefore = await documents.list({ type: applicationDocumentTypes.timelineExtensionParticipation })
      await expect(runtime.createNarrativeTimeline({ cardId: card.id })).rejects.toThrow('Initialization failed')
      expect(await runtime.listNarrativeTimelines()).toEqual(before)
      expect(await documents.list({ type: applicationDocumentTypes.timelineExtensionParticipation })).toEqual(configsBefore)
    } finally { engine.close() }
  })

  it('pauses one Timeline, preserves State, and does not resurrect an old lease after resume', async () => {
    const fixture = await setup()
    const { engine, documents, runtime, a, b, installationId, context } = fixture
    try {
      const aLease = await captureTimelineExtensionLease(context, a.timeline.id, installationId)
      const bLease = await captureTimelineExtensionLease(context, b.timeline.id, installationId)
      const target = { scope: 'timeline' as const, timelineId: a.timeline.id, branchId: a.branch.id }
      const before = await runtime.getStateSnapshot({ target })
      expect(before.snapshot.value).toMatchObject({ memory: { count: 1 } })
      const mutationInput = {
        target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set' as const, path: '/summary', value: 'Late summary' }],
      }
      const paused = await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled: false,
      })
      await expect(assertTimelineExtensionLease(context, documents, aLease)).rejects.toThrow('no longer active')
      await expect(runtime.applyStateMutation(mutationInput, { extensionLeases: [aLease] })).rejects.toThrow('no longer active')
      await expect(captureTimelineExtensionLease(context, a.timeline.id, installationId)).rejects.toThrow('not active')
      await expect(assertTimelineExtensionLease(context, documents, bLease)).resolves.toBeUndefined()
      await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: paused.participation.version, enabled: true,
      })
      await expect(assertTimelineExtensionLease(context, documents, aLease)).rejects.toThrow('no longer active')
      await expect(runtime.applyStateMutation(mutationInput, { extensionLeases: [aLease] })).rejects.toThrow('no longer active')
      const fresh = await captureTimelineExtensionLease(context, a.timeline.id, installationId)
      await expect(assertTimelineExtensionLease(context, documents, fresh)).resolves.toBeUndefined()
      await expect(runtime.applyStateMutation(mutationInput, { extensionLeases: [fresh, aLease] })).rejects.toThrow('no longer active')
      expect(await runtime.getStateSnapshot({ target })).toEqual(before)
      expect(fixture.initializations()).toBe(2)
      await expect(runtime.applyStateMutation(mutationInput, { extensionLeases: [fresh] })).resolves.toMatchObject({
        snapshot: { value: { summary: 'Late summary' } },
      })
    } finally { engine.close() }
  })

  it('keeps resources discoverable while excluding paused or unadopted Timeline owners at runtime', async () => {
    const { engine, runtime, documents, a, b, installationId } = await setup()
    try {
      expect((await readAvailableExtensionInstallations(documents)).has(installationId)).toBe(true)
      expect((await readAvailableExtensionInstallations(documents, undefined, null)).has(installationId)).toBe(false)
      const { card } = await runtime.createCard({ name: 'Unadopted' })
      const c = await runtime.createNarrativeTimeline({ cardId: card.id })
      expect((await readAvailableExtensionInstallations(documents, card.id, c.timeline.id)).has(installationId)).toBe(false)
      await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled: false,
      })
      expect((await readAvailableExtensionInstallations(documents)).has(installationId)).toBe(true)
      expect((await readAvailableExtensionInstallations(documents, undefined, a.timeline.id)).has(installationId)).toBe(false)
      expect((await readAvailableExtensionInstallations(documents, undefined, b.timeline.id)).has(installationId)).toBe(true)
    } finally { engine.close() }
  })

  it('rejects concurrent configuration changes and never implicitly adopts a missing extension', async () => {
    const { engine, runtime, a, installationId } = await setup()
    try {
      const results = await Promise.allSettled([false, false].map(enabled => runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled,
      })))
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toContain('version conflict')
      await expect(runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId: 'other', expectedVersion: 2, enabled: true,
      })).rejects.toThrow('has not been adopted')
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })).version).toBe(2)
    } finally { engine.close() }
  })

  it('shares adoption across Branch checkpoints without changing another Timeline', async () => {
    const { engine, runtime, a, b, installationId } = await setup()
    try {
      const before = await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })
      await runtime.forkNarrativeBranch({
        timelineId: a.timeline.id, fromBranchId: a.branch.id, fromNodeId: a.nodes[0]!.id,
      })
      expect(await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })).toEqual(before)
      await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled: false,
      })
      await runtime.switchNarrativeBranch({ timelineId: a.timeline.id, branchId: a.branch.id })
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })).entries[0]!.enabled).toBe(false)
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: b.timeline.id })).entries[0]!.enabled).toBe(true)
    } finally { engine.close() }
  })

  it('requires explicit recovery after installation replacement even when package and version match', async () => {
    const { engine, documents, runtime, a, installationId, context, actor, stateContributions, registration } = await setup()
    try {
      const lease = await captureTimelineExtensionLease(context, a.timeline.id, installationId)
      const installation = (await documents.get(installationId))!
      await documents.delete({ id: installationId, expectedVersion: installation.version, actor })
      await expect(assertTimelineExtensionLease(context, documents, lease)).rejects.toThrow()
      const deleted = (await documents.get(installationId, { includeTombstone: true }))!
      await documents.write({
        id: installationId, type: installation.type, content: installation.content,
        expectedVersion: deleted.version, actor,
      })
      await expect(assertTimelineExtensionLease(context, documents, lease)).rejects.toThrow('explicit recovery')
      const paused = await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: 1, enabled: false,
      })
      await expect(runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: paused.participation.version, enabled: true,
      })).rejects.toThrow('explicit recovery')
      const target = { scope: 'timeline' as const, timelineId: a.timeline.id, branchId: a.branch.id }
      const before = await runtime.getStateSnapshot({ target })
      const source = stateContributions.list()[0]!
      registration.dispose()
      stateContributions.register({
        ...source, instanceId: 'reinstalled',
        contribution: { ...source.contribution, templates: source.contribution.templates.map(template => ({ ...template, label: undefined })) },
      })
      const preview = await runtime.previewTimelineExtensionRecovery({ timelineId: a.timeline.id, installationId })
      expect(preview.sourceChanged).toBe(false)
      await runtime.recoverTimelineExtension(preview)
      expect(await runtime.getStateSnapshot({ target })).toEqual(before)
      await expect(captureTimelineExtensionLease(context, a.timeline.id, installationId)).resolves.toMatchObject({
        installationVersion: preview.expectedInstallationVersion,
      })
      await expect(assertTimelineExtensionLease(context, documents, lease)).rejects.toThrow('no longer active')
    } finally { engine.close() }
  })

  it('requires explicit source confirmation and rejects a stale recovery preview without changing State', async () => {
    const { engine, documents, runtime, a, installationId, actor } = await setup()
    try {
      const installation = (await documents.get(installationId))!
      await documents.write({
        id: installationId, type: installation.type, expectedVersion: installation.version, actor,
        content: { ...(installation.content as object), source: { kind: 'git', url: 'https://example.com/fork.git' } },
      })
      const preview = await runtime.previewTimelineExtensionRecovery({ timelineId: a.timeline.id, installationId })
      expect(preview.sourceChanged).toBe(true)
      await expect(runtime.recoverTimelineExtension(preview)).rejects.toThrow('explicit source replacement')
      expect((await runtime.getTimelineExtensionParticipation({ timelineId: a.timeline.id })).version).toBe(preview.expectedVersion)
      await runtime.updateTimelineExtensionParticipation({
        timelineId: a.timeline.id, installationId, expectedVersion: preview.expectedVersion, enabled: false,
      })
      await expect(runtime.recoverTimelineExtension({ ...preview, acceptSourceChange: true })).rejects.toThrow('stale')
      const current = await runtime.previewTimelineExtensionRecovery({ timelineId: a.timeline.id, installationId })
      await expect(runtime.recoverTimelineExtension({ ...current, acceptSourceChange: true })).resolves.toMatchObject({
        participation: { entries: [{ enabled: true, source: { kind: 'git', url: 'https://example.com/fork.git' } }] },
      })
    } finally { engine.close() }
  })

  it.each(['missing', 'changed'] as const)('rejects same-version recovery when accepted State declarations are %s', async mode => {
    const f = await setup()
    try {
      const installation = (await f.documents.get(f.installationId))!
      await f.documents.write({
        id: installation.id, type: installation.type, content: installation.content,
        expectedVersion: installation.version, actor: f.actor,
      })
      const input = { timelineId: f.a.timeline.id, installationId: f.installationId }
      const preview = await f.runtime.previewTimelineExtensionRecovery(input)
      const source = f.stateContributions.list()[0]!
      f.registration.dispose()
      if (mode === 'changed') {
        source.contribution.templates[0]!.schema = { type: 'object', required: ['newField'] }
        source.contribution.templates[0]!.initial = { newField: true }
        f.stateContributions.register(source)
      }
      const target = { scope: 'timeline' as const, timelineId: f.a.timeline.id, branchId: f.a.branch.id }
      const before = await f.runtime.getStateSnapshot({ target })
      await expect(f.runtime.previewTimelineExtensionRecovery(input)).rejects.toThrow('State declarations')
      await expect(f.runtime.recoverTimelineExtension(preview)).rejects.toThrow('State declarations')
      expect((await f.runtime.getTimelineExtensionParticipation(input)).version).toBe(preview.expectedVersion)
      expect(await f.runtime.getStateSnapshot({ target })).toEqual(before)
    } finally { f.engine.close() }
  })
})
