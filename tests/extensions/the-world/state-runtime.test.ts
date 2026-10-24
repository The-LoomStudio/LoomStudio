import { describe, expect, it } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createApplicationRuntime, createStateContributionRegistry, applicationDocumentTypes, type RuntimeRequestContext } from '@loom-studio/application-runtime'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'
import { createWorldRoot } from '../../../extensions/the-world/src/world-state.js'
import { activate } from '../../../extensions/the-world/src/server/index.js'

function setup(legacy = false) {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const stateContributions = createStateContributionRegistry()
  const documents = createSqliteDocumentStore({ engine })
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents,
    narratives: createNarrativeStore({ engine }), promptResources: createPromptResourceStore({ engine }), stateContributions,
  })
  const tools = new Map<string, (...args: any[]) => Promise<any>>()
  const rpcs = new Map<string, (...args: any[]) => Promise<any>>()
  const packageId = 'official.the-world'
  const installationId = extensionInstallationId(packageId, { kind: 'global' })
  const execution = new AsyncLocalStorage<NonNullable<RuntimeRequestContext['extensionLeases']>[number]>()
  const run = (target: any, work: (execution: any) => Promise<any>, signal?: AbortSignal) =>
    runtime.runTimelineExtensionWork({ timelineId: target.timelineId, installationId, packageVersion: '0.1.4', signal },
      scope => execution.run(scope.lease, () => work({ target, signal: scope.signal })))
  activate({
    timeline: { run },
    state: {
      contribute(contribution: any) {
        stateContributions.register({
          target: { kind: 'global' }, packageId: 'official.the-world', packageVersion: '0.1.4',
          moduleId: 'server', instanceId: 'test',
          // Legacy checkpoints accepted only the original world component mount.
          contribution: legacy ? { ...contribution,
            templates: contribution.templates.map((template: any) => ({ ...template, initial: {} })),
            componentMounts: contribution.componentMounts.filter((mount: any) => mount.componentKey === 'world'),
          } : contribution,
        })
      },
      async read(target: any) {
        if (!execution.getStore()) throw new Error('State read requires managed Timeline work')
        return (await runtime.getStateSnapshot({ target })).snapshot
      },
      async write(input: any) {
        if (!execution.getStore()) throw new Error('State write requires managed Timeline work')
        const result = await runtime.applyStateMutation(input, { extensionLeases: [execution.getStore()!] })
        return { snapshot: result.snapshot, changesetId: result.mutation.changesetId }
      },
    },
    rpc: { register(id: string, handler: (...args: any[]) => Promise<any>) { rpcs.set(id, handler) } },
    agentTools: { register(id: string, handler: (...args: any[]) => Promise<any>) {
      tools.set(id, (input, invocation) => invocation.narrativeTarget
        ? run(invocation.narrativeTarget, () => handler(input, invocation), invocation.signal)
        : handler(input, invocation))
    } },
  })
  const read = tools.get('official.the-world/read-world-state')!
  const write = tools.get('official.the-world/update-world-state')!
  const rpc = (name: string, args: any) => rpcs.get(`official.the-world.${name}`)!(args)
  const context = (target?: any, invocationId = createId('invocation')) => ({
    signal: new AbortController().signal, invocationId, ...(target ? { narrativeTarget: target } : {}),
  })
  const weather = (kind: string) => [{ op: 'add', path: '/entities/world/components/weather', value: { kind } }]
  async function timeline(adopt = true) {
    if (!await documents.get(installationId)) {
      await documents.write({
        id: installationId, type: applicationDocumentTypes.extensionInstallation, expectedVersion: 'new',
        actor: { kind: 'kernel', id: 'test' },
        content: { packageId, packageVersion: '0.1.4', participation: 'timeline', target: { kind: 'global' },
          source: { kind: 'git', url: 'https://github.com/The-LoomStudio/LS_The_World.git' },
          createdAt: nowIso(), updatedAt: nowIso() },
      })
    }
    const { card } = await runtime.createCard({ name: 'World', opening: { content: 'Arrival' } })
    if (adopt) await runtime.updateCard({ cardId: card.id, extensionAdoptions: [{ packageId, target: 'global' }] })
    const story = await runtime.createNarrativeTimeline({ cardId: card.id })
    return { story, target: { scope: 'timeline' as const, timelineId: story.timeline.id, branchId: story.branch.id } }
  }
  return { engine, runtime, documents, read, write, rpc, context, weather, timeline, installationId }
}

describe('The World handlers with real State Service', () => {
  it('registers the native world entity and component, and explicitly initializes an older checkpoint', async () => {
    const f = setup()
    try {
      const { story, target } = await f.timeline(false)
      const fork = await f.runtime.forkNarrativeBranch({
        timelineId: target.timelineId, fromBranchId: target.branchId, fromNodeId: story.nodes[0]!.id,
      })
      const input = { timelineId: target.timelineId, branchId: target.branchId, installationId: f.installationId }
      const preview = await f.runtime.previewTimelineExtensionAdoption(input)
      expect(preview.paths).toEqual(['/theWorld/entities/world'])
      await f.runtime.adoptTimelineExtension(preview)
      const expected = createWorldRoot()
      expect((await f.read({ arguments: {} }, f.context(target))).state.theWorld).toEqual(expected)
      const document = await f.documents.get(`timeline-runtime-context:${target.timelineId}`)
      expect(document?.content).toMatchObject({
        stateEntities: [{ typeId: 'official-the-world-entity', entityId: 'world' }],
        stateComponents: expect.arrayContaining([expect.objectContaining({ path: 'theWorld.entities.world.components.world', componentKey: 'world' })]),
        stateBindings: expect.arrayContaining([expect.objectContaining({ path: 'theWorld.entities.world.components.world', installationId: f.installationId })]),
      })
      const oldTarget = { ...target, branchId: fork.branch.id }
      expect((await f.runtime.getStateSnapshot({ target: oldTarget })).snapshot.value).not.toHaveProperty('theWorld')
      const initialization = await f.runtime.previewTimelineExtensionStateInitialization({ ...input, branchId: fork.branch.id })
      await f.runtime.initializeTimelineExtensionState(initialization)
      expect((await f.read({ arguments: {} }, f.context(oldTarget))).state.theWorld).toEqual(expected)
    } finally { f.engine.close() }
  })
  it('starts with null fields, accepts the first known values, and reverts back to unknown', async () => {
    const f = setup()
    try {
      const { target } = await f.timeline()
      const before = await f.read({ arguments: {} }, f.context(target))
      expect(before.state.theWorld).toEqual(createWorldRoot())
      const updated = await f.write({ arguments: { expectedRevisionId: before.revisionId, patch: [
        { op: 'replace', path: '/entities/world/components/calendar', value: {
          id: 'story-calendar', name: '故事历', months: [{ id: '1', name: '一月', days: 30 }],
        } },
        { op: 'replace', path: '/entities/world/components/worldTime/value', value: {
          calendarId: 'story-calendar', year: 1, month: 1, day: 2, hour: 0, minute: 0,
        } },
        { op: 'replace', path: '/entities/world/components/weather', value: { kind: 'clear', label: '晴天' } },
      ] } }, f.context(target))
      expect(updated.state.theWorld.entities.world.components.worldTime.value).toMatchObject({ hour: 0, minute: 0 })
      expect(updated.state.theWorld.entities.world.components.weather.kind).toBe('clear')
      await f.runtime.revertChangeset({ changesetId: updated.changesetId })
      expect((await f.read({ arguments: {} }, f.context(target))).state.theWorld).toEqual(createWorldRoot())
      const partial = await f.read({ arguments: {} }, f.context(target))
      await f.write({ arguments: { expectedRevisionId: partial.revisionId, patch: [
        { op: 'replace', path: '/entities/world/components/worldTime/value/hour', value: 0 },
      ] } }, f.context(target))
      const current = await f.read({ arguments: {} }, f.context(target))
      expect(current.state.theWorld.entities.world.components.worldTime.value).toMatchObject({ hour: 0, year: null })
      await expect(f.write({ arguments: { expectedRevisionId: current.revisionId, patch: [
        { op: 'replace', path: '/entities/world/components/worldTime/value/hour', value: 24 },
      ] } }, f.context(target))).rejects.toThrow()
    } finally { f.engine.close() }
  })

  it('denies unadopted and paused RPCs while preserving another Timeline and existing State', async () => {
    const f = setup()
    try {
      const a = await f.timeline()
      const b = await f.timeline(false)
      const before = await f.rpc('readWorldState', a.target)
      await expect(f.rpc('readWorldState', b.target)).rejects.toThrow()
      expect((await f.runtime.getStateSnapshot({ target: b.target })).snapshot.value).not.toHaveProperty('theWorld')
      const config = await f.runtime.getTimelineExtensionParticipation({ timelineId: a.target.timelineId })
      await f.runtime.updateTimelineExtensionParticipation({
        timelineId: a.target.timelineId, installationId: f.installationId, expectedVersion: config.version, enabled: false,
      })
      await expect(f.rpc('readWorldState', a.target)).rejects.toThrow()
      expect((await f.runtime.getStateSnapshot({ target: a.target })).snapshot.revisionId).toBe(before.revisionId)
      const c = await f.timeline()
      await expect(f.rpc('readWorldState', c.target)).resolves.toMatchObject({ state: { theWorld: { entities: { world: { components: { world: {} } } } } } })
    } finally { f.engine.close() }
  })
  it('rejects unbound or model-supplied targets and cancelled writes', async () => {
    const f = setup()
    try {
      const { target } = await f.timeline()
      await expect(f.read({ arguments: {} }, f.context())).rejects.toThrow('bound Narrative')
      await expect(f.read({ arguments: { branchId: target.branchId } }, f.context(target))).rejects.toThrow('supplied by the Host')
      const before = await f.read({ arguments: {} }, f.context(target))
      const abort = new AbortController()
      abort.abort()
      await expect(f.write({ arguments: { expectedRevisionId: before.revisionId, patch: f.weather('rain') } },
        { ...f.context(target), signal: abort.signal })).rejects.toThrow()
      expect((await f.read({ arguments: {} }, f.context(target))).revisionId).toBe(before.revisionId)
    } finally { f.engine.close() }
  })
  it('replays identical requests after subsequent writes without overwriting the head', async () => {
    const f = setup()
    try {
      const { target } = await f.timeline()
      const before = await f.read({ arguments: {} }, f.context(target))
      const args = { arguments: { expectedRevisionId: before.revisionId, patch: f.weather('rain') } }
      const invocation = f.context(target, 'same-call')
      const first = await f.write(args, invocation)
      const second = await f.write({ arguments: { expectedRevisionId: first.revisionId, patch: f.weather('snow') } }, f.context(target))
      expect(await f.write(args, invocation)).toEqual(first)
      expect((await f.read({ arguments: {} }, f.context(target))).revisionId).toBe(second.revisionId)
      await expect(f.write({ arguments: { ...args.arguments, patch: f.weather('fog') } }, invocation)).rejects.toThrow()
      await expect(f.write(args, f.context(target))).rejects.toMatchObject({ code: 'state.head_conflict' })
      expect((await f.read({ arguments: {} }, f.context(target))).state.theWorld.entities.world.components.weather.kind).toBe('snow')
    } finally { f.engine.close() }
  })
  it('forks without embedded branch identities and isolates subsequent writes', async () => {
    const f = setup()
    try {
      const { target, story } = await f.timeline()
      const fork = await f.runtime.forkNarrativeBranch({
        timelineId: target.timelineId, fromBranchId: target.branchId, fromNodeId: story.nodes[0]!.id, title: 'Fork',
      })
      const other = { ...target, branchId: fork.branch.id }
      const original = await f.read({ arguments: {} }, f.context(target))
      const forkRead = await f.read({ arguments: {} }, f.context(other))
      expect(forkRead.state).toEqual(original.state)
      await f.write({ arguments: { expectedRevisionId: forkRead.revisionId, patch: f.weather('rain') } }, f.context(other))
      expect((await f.read({ arguments: {} }, f.context(target))).state).toEqual(original.state)
      expect((await f.read({ arguments: {} }, f.context(other))).state.theWorld.entities.world.components.weather.kind).toBe('rain')
    } finally { f.engine.close() }
  })
  it('previews v1 without writes and commits only the reviewed revision and content', async () => {
    const f = setup(true)
    try {
      const { target } = await f.timeline()
      const before = await f.read({ arguments: {} }, f.context(target))
      const legacy = { schemaVersion: 1, branch: target, entities: {
        world: { schemaVersion: 1, id: 'world', kind: 'world', createdBy: 'author', components: { world: {} } },
      } }
      const installed = await f.runtime.applyStateMutation({
        target, expectedRevisionId: before.revisionId, operations: [{ op: 'set', path: '/theWorld', value: legacy }],
      })
      await expect(f.read({ arguments: {} }, f.context(target))).rejects.toThrow('explicit upgrade')
      const preview = await f.rpc('previewWorldUpgrade', target)
      expect(preview.revisionId).toBe(installed.snapshot.revisionId)
      expect((await f.runtime.getStateSnapshot({ target })).snapshot.value).toEqual({ theWorld: legacy })
      const request = { ...target, expectedRevisionId: preview.revisionId, state: preview.state, idempotencyKey: 'upgrade' }
      await expect(f.rpc('commitWorldUpgrade', {
        ...request, state: { entities: { world: { components: { world: {}, weather: { kind: 'clear' } } } } },
      })).rejects.toThrow('preview does not match')
      const result = await f.rpc('commitWorldUpgrade', request)
      expect(await f.rpc('commitWorldUpgrade', request)).toEqual(result)
      expect((await f.read({ arguments: {} }, f.context(target))).state.theWorld).toEqual({ entities: { world: { components: { world: {} } } } })
    } finally { f.engine.close() }
  })
})
