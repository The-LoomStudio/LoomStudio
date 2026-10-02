import { createAgentStore } from '@loom-studio/application-data'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createAgentToolRegistry, createApplicationRuntime, createDocumentBackedAiGateway, type ToolDefinition, type ToolRuntimeRegistration } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/application-data'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'

function createTestRuntime(agentTools = createAgentToolRegistry([])) {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const logs = createMemoryLogSink({ capacity: 100 })
  const logger = createRootLogger({ service: 'test', instanceId: 'test', sinks: [logs] })
  const runtime = createApplicationRuntime({ agents, agentTools, dataEngine: engine, documents, narratives, promptResources, runtimeLogger: logger.child('runtime') })
  return { engine, documents, runtime, narratives, logs }
}

async function createProfile(runtime: ReturnType<typeof createTestRuntime>['runtime'], instructions = 'Help the user.') {
  const provider = await runtime.createProviderProfile({
    providerExtensionId: 'official.fake',
    displayName: 'Test Provider',
    config: {},
    enabledModelIds: [officialFakeModelId],
  })
  const preset = await createPreset(runtime, 'Test Agent', instructions)
  const profile = (await runtime.updateAgentPreset({
    name: 'Test Agent Preset',
    agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
    model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
  })).agentPreset
  return { preset, profile }
}

async function createPreset(
  runtime: ReturnType<typeof createTestRuntime>['runtime'],
  name: string,
  instructions: string,
) {
  const created = await runtime.createPromptResource({ resourceKind: 'preset', name })
  return (await runtime.createPromptResourceAsset({
    resourceId: created.resource.id,
    targetAssetId: created.resource.rootNode.children!.find(node => node.kind === 'message' && node.capabilities?.roleHint === 'system')!.id,
    position: 'inside',
    asset: { id: `${created.resource.id}.instructions`, label: 'Agent Instructions', category: 'preset', kind: 'entry', body: instructions },
  })).resource
}

describe('application agent session lifecycle', () => {
  it.each(['timeline', 'card', 'batch'] as const)('deletes all Timeline-bound sessions across pages via %s and their storage, preserving other sessions', async mode => {
    const { engine, documents, runtime } = createTestRuntime()
    try {
      const { profile } = await createProfile(runtime)
      const { card } = await runtime.createCard({ name: 'Cascade' })
      const first = await runtime.createNarrativeTimeline({ cardId: card.id })
      const otherCard = await runtime.createCard({ name: 'Retained' })
      const other = await runtime.createNarrativeTimeline({ cardId: otherCard.card.id })
      const secondCard = mode === 'batch' ? await runtime.createCard({ name: 'Second' }) : undefined
      const secondTimeline = secondCard ? await runtime.createNarrativeTimeline({ cardId: secondCard.card.id }) : undefined
      const secondSession = secondTimeline ? await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: secondTimeline.timeline.id }) : undefined
      const standalone = await runtime.createAgentSession({ agentPresetId: profile.id })
      const otherSession = await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: other.timeline.id })
      const boundIds: string[] = []
      for (let index = 0; index < 101; index++) {
        boundIds.push((await runtime.createAgentSession({
          agentPresetId: profile.id, timelineId: first.timeline.id,
        })).session.id)
      }
      for (const [id, type, agentSessionId] of [
        ['bound-config', 'airp.extensionConfig', boundIds[0]!],
        ['bound-record', 'airp.extensionRecord', boundIds[100]!],
        ['standalone-config', 'airp.extensionConfig', standalone.session.id],
        ['other-record', 'airp.extensionRecord', otherSession.session.id],
      ] as const) {
        await documents.write({
          id, type, content: { scope: { kind: 'agent-session', agentSessionId } },
          expectedVersion: 'new', actor: { kind: 'extension', id: 'example.cascade' },
        })
      }
      const removed = mode === 'timeline'
        ? await runtime.deleteNarrativeTimeline({ timelineId: first.timeline.id })
        : mode === 'card'
          ? await runtime.deleteCard({ cardId: card.id, includePlayData: true })
          : await runtime.deleteCards({ cardIds: [card.id, secondCard!.card.id], includePlayData: true })
      if (secondSession) await expect(runtime.getAgentSession({ agentSessionId: secondSession.session.id })).rejects.toThrow('Agent session not found')
      expect((await runtime.listAgentSessions({ timelineId: first.timeline.id })).sessions).toEqual([])
      expect((await runtime.listAgentSessions()).sessions.map(session => session.id).sort())
        .toEqual([standalone.session.id, otherSession.session.id].sort())
      await expect(runtime.getAgentSession({ agentSessionId: boundIds[0]! })).rejects.toThrow('Agent session not found')
      await expect(runtime.getAgentTranscriptPage({ agentSessionId: boundIds[100]! })).rejects.toThrow('Agent session not found')
      const changeset = await documents.getChangeset(removed.mutation.changesetId)
      expect(changeset?.operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'delete', documentId: 'bound-config' }),
        expect.objectContaining({ kind: 'delete', documentId: 'bound-record' }),
      ]))
      expect(await documents.get('bound-config')).toBeNull()
      expect(await documents.get('bound-record')).toBeNull()
      expect(await documents.get('standalone-config')).not.toBeNull()
      expect(await documents.get('other-record')).not.toBeNull()
      expect((await runtime.getNarrativeTimeline({ timelineId: other.timeline.id })).timeline.id).toBe(other.timeline.id)
    } finally { engine.close() }
  })

  it.each(['timeline', 'card', 'batch'] as const)('rolls back Timeline and earlier Session deletions via %s when one bound Session cannot be deleted', async mode => {
    const { engine, documents, runtime } = createTestRuntime()
    try {
      const { profile } = await createProfile(runtime)
      const { card } = await runtime.createCard({ name: 'Rollback' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const blocked = await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: timeline.id, title: 'blocked' })
      const earlierDeletion = await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: timeline.id })
      const secondCard = mode === 'batch' ? await runtime.createCard({ name: 'Second' }) : undefined
      await documents.write({
        id: 'rollback-session-storage', type: 'airp.extensionRecord',
        content: { scope: { kind: 'agent-session', agentSessionId: earlierDeletion.session.id } },
        expectedVersion: 'new', actor: { kind: 'system', id: 'test' },
      })
      await engine.read(database => database.exec(`
        CREATE TRIGGER reject_bound_session_deletion
        BEFORE UPDATE OF tombstoned ON agent_sessions
        WHEN OLD.title = 'blocked' AND NEW.tombstoned = 1
        BEGIN SELECT RAISE(ABORT, 'session deletion refused'); END;
      `))
      const deletion = mode === 'timeline'
        ? runtime.deleteNarrativeTimeline({ timelineId: timeline.id })
        : mode === 'card'
          ? runtime.deleteCard({ cardId: card.id, includePlayData: true })
          : runtime.deleteCards({ cardIds: [card.id, secondCard!.card.id], includePlayData: true })
      await expect(deletion).rejects.toThrow('session deletion refused')
      expect(await documents.get(card.id)).not.toBeNull()
      if (secondCard) expect(await documents.get(secondCard.card.id)).not.toBeNull()
      expect(await documents.get('rollback-session-storage')).not.toBeNull()
      expect((await runtime.getNarrativeTimeline({ timelineId: timeline.id })).timeline.id).toBe(timeline.id)
      for (const session of [blocked.session, earlierDeletion.session]) {
        expect((await runtime.getAgentSession({ agentSessionId: session.id })).session.id).toBe(session.id)
      }
    } finally { engine.close() }
  })

  it('adds per-turn settings and anchored content without leaking to concurrent or later turns', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const { profile } = await createProfile(runtime)
      const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Temporary' })
      await runtime.createPromptResourceAsset({
        resourceId: setting.resource.id, targetAssetId: setting.resource.rootNode.id, position: 'inside',
        asset: { id: 'temporary-setting', label: 'Temporary', kind: 'entry', body: 'ONLY_THIS_SETTING' },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id })
      const addition = {
        settingResourceIds: [setting.resource.id],
        content: [{ targetAnchorId: '@chat.input', content: 'ONLY_THIS_ANCHOR' }],
      }
      const [preview, other] = await Promise.all([
        runtime.previewAgentTurn({ agentSessionId: session.id, input: 'hello', promptAddition: addition }),
        runtime.previewAgentTurn({ agentSessionId: session.id, input: 'hello' }),
      ])
      expect(JSON.stringify(preview.messages)).toContain('ONLY_THIS_ANCHOR')
      expect(JSON.stringify(preview.messages)).toContain('ONLY_THIS_SETTING')
      expect(JSON.stringify(other.messages)).not.toContain('ONLY_THIS_ANCHOR')
      expect(JSON.stringify(other.messages)).not.toContain('ONLY_THIS_SETTING')
      const run = await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'hello', promptAddition: addition })
      expect(run.projection.messages).toEqual(preview.projection.messages)
      const next = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'next' })
      expect(next.messages.at(-1)?.content).toBe('next')
      expect(next.projection.messages.flatMap(message => message.fragmentIds))
        .not.toContain('runtime.prompt-addition.content.0')
      expect((await runtime.listSettingMounts({ source: { kind: 'preset', id: profile.id } })).mounts)
        .toEqual([])
    } finally { engine.close() }
  })

  it('builds independently without a Session/model and rejects unowned resources', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const built = await runtime.buildExtensionPrompt({
        content: [{ targetAnchorId: '@custom', content: 'standalone' }],
      }, { kind: 'global' }, 'example.ext')
      expect(JSON.stringify(built.messages)).toContain('standalone')
      const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Private' })
      await expect(runtime.buildExtensionPrompt({
        settingResourceIds: [setting.resource.id],
      }, { kind: 'global' }, 'example.ext')).rejects.toThrow('not owned')
    } finally { engine.close() }
  })
  it('does not turn a fake model completion into streamed token deltas', async () => {
    const { engine, documents, runtime } = createTestRuntime()
    try {
      const provider = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Fake', config: {},
        enabledModelIds: [officialFakeModelId],
      })
      const events: unknown[] = []
      const result = await createDocumentBackedAiGateway({ documents }).invokeChat({
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
        request: { messages: [{ role: 'user', content: 'hello' }] },
        runId: 'direct', sessionId: 'extension-direct', branchId: 'extension-direct',
        delivery: 'stream', onEvent: event => events.push(event),
      })
      expect(result.text).toContain('hello')
      expect(events).toEqual([])
    } finally { engine.close() }
  })
  it('keeps the preset binding fixed while allowing title updates', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const first = await createProfile(runtime, 'FIRST_PRESET_MARKER')
      const { session } = await runtime.createAgentSession({ agentPresetId: first.profile.id, title: 'Keep this title' })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Remember this conversation.' })
      const before = await runtime.getAgentTranscriptPage({ agentSessionId: session.id })
      await expect(runtime.updateAgentSession({ agentSessionId: session.id, agentPresetId: first.profile.id } as any))
        .rejects.toThrow('immutable')
      const updated = await runtime.updateAgentSession({ agentSessionId: session.id, title: 'Renamed' })
      expect(updated.session).toMatchObject({ id: session.id, title: 'Renamed', agentPresetId: first.profile.id, entryCount: before.session.entryCount })
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual(before.entries)
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue.' })
      const text = JSON.stringify(preview.messages)
      expect(text).toContain('FIRST_PRESET_MARKER')
      expect(text).toContain('Remember this conversation.')
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).session.agentPresetId).toBe(first.profile.id)
    } finally { engine.close() }
  })

  it.each(['running', 'suspended'] as const)('rejects binding changes while the session is %s', async state => {
    const { engine, runtime } = createTestRuntime()
    try {
      const first = await createProfile(runtime)
      const { session } = await runtime.createAgentSession({ agentPresetId: first.profile.id })
      const store = createAgentStore({ engine })
      await store.appendEntries({
        agentSessionId: session.id, actor: { kind: 'system', id: 'test' },
        expectedEntryCount: 0,
        entries: [{ runId: 'active-run', entry: { kind: 'run-state', state } }],
      })
      await expect(runtime.updateAgentSession({ agentSessionId: session.id, timelineId: null } as any))
        .rejects.toMatchObject({ code: 'agent.session_binding_active_run' })
    } finally { engine.close() }
  })
  it.each(['user-cancel', 'user-pause'])('logs %s as a non-error terminal state', async reason => {
    const { engine, runtime, logs } = createTestRuntime()
    try {
      const { profile } = await createProfile(runtime)
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id })
      const controller = new AbortController()
      controller.abort(reason)
      await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'private-input' }, {
        abortSignal: controller.signal,
        agentRun: { runId: 'test-run', onEvent: () => undefined, onSuspended: () => undefined },
      })).rejects.toThrow()
      const outcome = reason === 'user-pause' ? 'suspended' : 'cancelled'
      expect(logs.list().at(-1)).toMatchObject({ event: `run.${outcome}`, level: 'info', data: { runId: 'test-run', outcome } })
      expect(logs.list().some(record => record.event === 'run.completed')).toBe(false)
      expect(JSON.stringify(logs.list())).not.toContain('private')
    } finally { engine.close() }
  })
  it('logs preparation failures before a session can be resolved', async () => {
    const { engine, runtime, logs } = createTestRuntime()
    try {
      await expect(runtime.invokeAgentTurn({ agentSessionId: 'missing', input: 'private-input' })).rejects.toThrow('not found')
      expect(logs.list().map(log => log.event)).toEqual(['run.started', 'run.failed'])
      expect(logs.list()[1]?.data).toMatchObject({ stage: 'preparation', outcome: 'failed', providerStep: 0 })
      expect(logs.list()[0]?.data?.runId).toBe(logs.list()[1]?.data?.runId)
      expect(JSON.stringify(logs.list())).not.toContain('private')
    } finally { engine.close() }
  })

  it('does not create Session input when the initial Narrative append fails', async () => {
    const { engine, runtime, narratives, logs } = createTestRuntime()
    try {
      const { profile } = await createProfile(runtime)
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id })
      const card = await runtime.createCard({ name: 'private-name' })
      const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const before = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
      engine.database.exec(`CREATE TRIGGER fail_input_append BEFORE INSERT ON narrative_nodes
        BEGIN SELECT RAISE(ABORT, 'private-commit-error'); END`)
      await expect(runtime.appendNarrativeInput({
        timelineId: timeline.timeline.id, branchId: timeline.branch.id,
        nodeId: 'failed-input', expectedHeadNodeId: timeline.branch.headNodeId ?? null, content: 'private-input',
      })).rejects.toThrow('private-commit-error')
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(before)
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual([])
      expect(await narratives.getNode('failed-input')).toBeNull()
      expect(logs.list().some(log => log.event === 'run.started')).toBe(false)
      expect(JSON.stringify(logs.list())).not.toContain('private')
    } finally { engine.close() }
  })

  it('returns the original append receipt on concurrent and later explicit retries', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'test' })
      const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const input = {
        timelineId: timeline.timeline.id, branchId: timeline.branch.id,
        nodeId: 'stable-input', expectedHeadNodeId: null, content: 'test',
      }
      const commits: string[] = []
      const subscription = engine.subscribeCommits(commit => commits.push(commit.changesetId))
      const [first, second] = await Promise.all([runtime.appendNarrativeInput(input), runtime.appendNarrativeInput(input)])
      expect(second).toEqual(first)
      expect(commits).toEqual([first.mutation.changesetId])
      await runtime.appendNarrativeInput({ ...input, nodeId: 'later-input', expectedHeadNodeId: first.node.id, content: 'later' })
      const count = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
      expect((await runtime.appendNarrativeInput(input)).mutation).toEqual(first.mutation)
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(count)
      expect((await runtime.getNarrativePage({ timelineId: timeline.timeline.id })).nodes.map(node => node.id)).toEqual(['stable-input', 'later-input'])
      await runtime.editNarrativeNode({
        timelineId: input.timelineId, branchId: input.branchId, nodeId: input.nodeId,
        expectedHeadNodeId: 'later-input', expectedRaw: 'test', raw: 'edited branch copy',
      })
      const afterEdit = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
      const retried = await runtime.appendNarrativeInput(input)
      expect(retried.node).toEqual(first.node)
      expect(retried.mutation).toEqual(first.mutation)
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(afterEdit)
      subscription.dispose()
    } finally { engine.close() }
  })

  it('rejects conflicting IDs, parents, branches and stale heads without writing', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Conflict' })
      const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const input = { timelineId: timeline.timeline.id, branchId: timeline.branch.id, nodeId: 'input', expectedHeadNodeId: null, content: 'original' }
      await runtime.appendNarrativeInput(input)
      const fork = await runtime.forkNarrativeBranch({ timelineId: timeline.timeline.id, fromBranchId: timeline.branch.id, fromNodeId: input.nodeId })
      const count = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
      for (const change of [{ content: 'different' }, { expectedHeadNodeId: 'different' }, { branchId: fork.branch.id }, { timelineId: 'other' }]) {
        await expect(runtime.appendNarrativeInput({ ...input, ...change })).rejects.toMatchObject({ code: 'narrative.input_conflict' })
      }
      await expect(runtime.appendNarrativeInput({ ...input, nodeId: 'stale-head' })).rejects.toMatchObject({ code: 'narrative.head_conflict' })
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(count)
    } finally { await engine.close() }
  })
  it('exports and imports a Timeline archive with State history', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Archive Story', opening: 'Opening.' })
      const created = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const exportResult = await runtime.exportTimelineArchive({ timelineId: created.timeline.id })
      expect(exportResult.archive.format).toBe('loom-timeline-archive.v1')
      expect(exportResult.archive.branches).toHaveLength(1)
      expect(exportResult.archive.nodes.length).toBeGreaterThan(0)
      expect(exportResult.archive.state.revisions).toHaveLength(1)
      const imported = await runtime.importTimelineArchive({ source: JSON.stringify(exportResult.archive) })
      expect(imported.timelineId).not.toBe(created.timeline.id)
      expect(imported.unknownParticipantNamespaces).toEqual([])
      const importedPage = await runtime.getNarrativePage({ timelineId: imported.timelineId })
      expect(importedPage.nodes.map(node => node.body.raw)).toEqual(exportResult.archive.nodes.map(node => node.body.raw))
      expect(importedPage.branch.stateHeadRevisionId).toBe(imported.idMap.stateRevisionIds[exportResult.archive.branches[0]!.stateHeadRevisionId])
      expect((await runtime.listNarrativeTimelines()).timelines).toHaveLength(2)
    } finally {
      engine.close()
    }
  })

  it('rejects a malformed archive without creating partial Timeline data', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Atomic Story', opening: 'Opening.' })
      await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const before = engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_timelines').get()
      await expect(runtime.importTimelineArchive({ source: JSON.stringify({
        format: 'loom-timeline-archive.v1',
        exportedAt: '2026-08-12T00:00:00.000Z',
        timeline: { id: 'bad-timeline', title: 'Bad', promptResourceIds: [], activeBranchId: 'missing', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' },
        branches: [],
        nodes: [],
        state: { scope: { id: 'bad-scope', kind: 'timeline', ownerId: 'bad-timeline', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' }, revisions: [] },
        participants: [],
      }) })).rejects.toThrow()
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_timelines').get()).toEqual(before)
    } finally {
      engine.close()
    }
  })

  it('restores a forked branch and its independent active branch selection', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Branch Story', opening: 'Opening.' })
      const created = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const exported = (await runtime.exportTimelineArchive({ timelineId: created.timeline.id })).archive
      const root = exported.branches.find(branch => !branch.parentBranchId)!
      const forkNodeId = root.headNodeId!
      const child = {
        ...root,
        id: 'branch-import-child',
        title: 'Alternative',
        parentBranchId: root.id,
        forkedFromNodeId: forkNodeId,
        headNodeId: undefined,
      }
      const source = { ...exported, timeline: { ...exported.timeline, activeBranchId: child.id }, branches: [...exported.branches, child] }
      const imported = await runtime.importTimelineArchive({ source: JSON.stringify(source) })
      const result = await runtime.getNarrativeTimeline({ timelineId: imported.timelineId })
      expect(result.branches).toHaveLength(2)
      expect(result.timeline.activeBranchId).toBe(imported.idMap.branchIds[child.id])
      expect(result.branches.find(branch => branch.id === imported.idMap.branchIds[child.id])?.parentBranchId)
        .toBe(imported.idMap.branchIds[root.id])
    } finally {
      engine.close()
    }
  })

  it('persists unknown participant blocks for later handling', async () => {
    const { engine, documents, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Participant Story', opening: 'Opening.' })
      const created = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const archive = (await runtime.exportTimelineArchive({ timelineId: created.timeline.id })).archive
      archive.participants = [{ namespace: 'memory.future', version: 1, payload: { note: 'keep me' } }]
      const imported = await runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      const pending = await documents.get(`timeline-archive-pending:${imported.timelineId}`)
      expect(pending?.type).toBe('airp.timelineArchivePending')
      expect((pending?.content as { blocks: Array<{ namespace: string }> }).blocks[0]?.namespace).toBe('memory.future')
    } finally {
      engine.close()
    }
  })

  it('uses a bound timeline as default context without automatically committing narrative', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Bound Story', opening: 'BOUND_OPENING' })
      const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const { profile } = await createProfile(runtime)
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: timeline.timeline.id })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Read context.' })
      expect(JSON.stringify(preview.projection.messages)).toContain('BOUND_OPENING')
      const result = await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Read context.' })
      expect(result).not.toHaveProperty('narrative')
      expect(result.agentSession.timelineId).toBe(timeline.timeline.id)
      expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 1 })
      const standalone = await runtime.createAgentSession({ agentPresetId: profile.id })
      const workspacePreview = await runtime.previewAgentTurn({ agentSessionId: standalone.session.id, input: 'Read context.' })
      expect(JSON.stringify(workspacePreview.projection.messages)).not.toContain('BOUND_OPENING')
      await runtime.previewAgentTurn({ agentSessionId: standalone.session.id, input: 'Read context.',
        narrativeTarget: { timelineId: timeline.timeline.id },
      })
      expect((await runtime.getAgentSession({ agentSessionId: standalone.session.id })).session.timelineId).toBeUndefined()
    } finally {
      engine.close()
    }
  })

  it('rejects a bound session targeting another timeline before writing history', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Story', opening: 'Opening.' })
      const first = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const second = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const { profile } = await createProfile(runtime)
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id, timelineId: first.timeline.id })
      const input = { agentSessionId: session.id, input: 'Continue.', narrativeTarget: { timelineId: second.timeline.id } }
      await expect(runtime.previewAgentTurn(input)).rejects.toThrow('timeline binding')
      await expect(runtime.invokeAgentTurn(input)).rejects.toThrow('timeline binding')
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual([])
    } finally {
      engine.close()
    }
  })

  it('persists editable Agent Tool entries and reloads them into the registry', async () => {
    const tool: ToolDefinition = {
      id: 'official/read_context',
      owner: { namespace: 'official' },
      name: 'read_context',
      description: 'Read context for {{User}}.',
      input: { kind: 'structured', schema: { type: 'object' } },
      prompt: {
        provider: { order: 10 },
      },
    }
    let nextId = 0
    let nextTime = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId, now })
    const narratives = createNarrativeStore({ engine, createId, now })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const providerRequests: Array<{ tools?: unknown[] }> = []
    const registration: ToolRuntimeRegistration = {
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed' as const,
        content: [],
      }),
    }
    const firstRegistry = createAgentToolRegistry([tool], [registration])
    const firstRuntime = createApplicationRuntime({
      agents,
      agentTools: firstRegistry,
      dataEngine: engine,
      documents,
      gateway: {
        invokeChat: async input => {
          providerRequests.push({ tools: input.request.tools })
          return {
            provider: 'test',
            model: 'test-model',
            text: 'Done.',
            finishReason: 'stop',
            message: { role: 'assistant', content: 'Done.' },
          }
        },
      },
      narratives,
      promptResources,
    })
    await firstRuntime.initialize()

    const initial = (await firstRuntime.listAgentTools()).tools[0]!
    const definition: ToolDefinition = {
      ...tool,
      name: 'read_workspace_context',
      description: 'Read the active workspace for {{User}}.',
      prompt: {
        guidance: 'Return only relevant context.',
        provider: { order: 3 },
      },
    }
    const updated = await firstRuntime.updateAgentTool({
      toolId: tool.id,
      expectedVersion: initial.version,
      definition,
    })

    expect(updated.tool).toMatchObject({
      ...definition,
      version: initial.version + 1,
      createdAt: initial.createdAt,
    })
    expect(firstRegistry.resolve([tool.id]).tools).toEqual([definition])

    const provider = await firstRuntime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'Tool Provider',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: [officialFakeModelId],
    })
    const preset = await createPreset(firstRuntime, 'Tool Prompt', 'Use available tools.')
    await firstRuntime.replacePresetToolMounts({
      presetId: preset.id,
      mounts: [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true, provider: { order: 3 } }],
    })
    const profile = await firstRuntime.updateAgentPreset({
      name: 'Tool Agent',
      agentPresetId: preset.id, expectedVersion: (await firstRuntime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: {
        providerProfileId: provider.providerProfile.id,
        modelId: officialFakeModelId,
      },
    })
    const session = await firstRuntime.createAgentSession({
      agentPresetId: profile.agentPreset.id,
    })
    const turn = await firstRuntime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: 'Read the workspace.',
    })
    expect(turn.toolPromptBuildTrace.orders).toEqual([
      expect.objectContaining({ toolId: tool.id, providerOrder: 3, projection: 'provider-tools' }),
    ])
    expect(providerRequests[0]?.tools).toEqual([
      expect.objectContaining({
        name: definition.name,
        description: expect.stringContaining('Read the active workspace for User.'),
      }),
    ])
    expect(providerRequests[0]?.tools?.[0]).toEqual(
      expect.objectContaining({
        description: expect.stringContaining('Return only relevant context.'),
      }),
    )

    const secondRegistry = createAgentToolRegistry([tool], [registration])
    const secondRuntime = createApplicationRuntime({
      agents,
      agentTools: secondRegistry,
      dataEngine: engine,
      documents,
      narratives,
      promptResources,
    })
    await secondRuntime.initialize()

    expect((await secondRuntime.listAgentTools()).tools).toEqual([updated.tool])
    expect(secondRegistry.resolve([tool.id]).tools).toEqual([definition])
    expect(await secondRuntime.listPresetToolMounts({ presetId: preset.id })).toEqual({
      mounts: [expect.objectContaining({
        presetResourceId: preset.id,
        toolId: tool.id,
        defaultEnabled: true,
        provider: { order: 3 },
      })],
    })
    engine.close()
  })

  it('stores Agent Preset tool selection and previews active tools without executing them', async () => {
    const tool: ToolDefinition = {
      id: 'official/read_context',
      owner: { namespace: 'official' },
      name: 'read_context',
      description: 'Read context.',
      input: {
        kind: 'hybrid',
        metadataSchema: { type: 'object' },
        rawField: 'content',
        mediaType: 'text/plain',
      },
    }
    const { engine, runtime } = createTestRuntime(createAgentToolRegistry([tool], [{
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [],
      }),
    }]))
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake', displayName: 'Fake', config: {}, enabledModelIds: [officialFakeModelId],
    })
    const preset = await createPreset(runtime, 'Tool Agent', 'Use tools when available.')
    await runtime.replacePresetToolMounts({
      presetId: preset.id,
      mounts: [{
        toolId: tool.id,
        orderIndex: 0,
        defaultEnabled: true,
        activation: { kind: 'keyword', keywords: ['context'] },
        content: { targetAnchorId: '@chat.tools', localDepth: 5 },
      }],
    })
    const profile = (await runtime.updateAgentPreset({
      name: 'Tool Agent', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
    })).agentPreset

    expect((await runtime.listPresetToolMounts({ presetId: profile.id })).mounts[0]?.defaultEnabled).toBe(true)
    expect((await runtime.listAgentTools()).tools).toEqual([
      expect.objectContaining(tool),
    ])
    const session = await runtime.createAgentSession({ agentPresetId: profile.id })
    const inactive = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Hello.' })
    const active = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Read context.' })
    expect(inactive.toolExposures).toEqual([])
    expect(active.toolExposures).toEqual([expect.objectContaining({ toolId: tool.id, transport: 'content' })])
    expect(active.projection.messages.some((msg: any) => msg.fragmentIds.some((id: string) => id.includes('agent-tools')))).toBe(true)
    await expect(runtime.replacePresetToolMounts({
      presetId: profile.id, mounts: [{ toolId: 'missing/tool', orderIndex: 0, defaultEnabled: true }],
    }))
      .rejects.toThrow('not registered')
    engine.close()
  })

  it('creates, appends internally, pages, and deletes an independent Agent Session', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime)
    const created = await runtime.createAgentSession({
      agentPresetId: profile.id,
      title: 'Guide',
    }, {
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    const appended = await runtime.appendAgentTranscriptEntries({
      agentSessionId: created.session.id,
      expectedEntryCount: 0,
      entries: [
        { runId: 'run-1', entry: { kind: 'message', role: 'user', content: 'Help me' } },
        { runId: 'run-1', entry: { kind: 'message', role: 'assistant', content: 'Ready' } },
      ],
    })
    const page = await runtime.getAgentTranscriptPage({ agentSessionId: created.session.id })
    const commit = engine.database.prepare('SELECT created_by_json, correlation_id, call_id FROM changesets WHERE id = ?')
      .get(created.mutation.changesetId)

    expect(await runtime.getAgentSession({ agentSessionId: created.session.id })).toMatchObject({
      session: { agentPresetId: profile.id, entryCount: 2 },
    })
    expect(appended.entries.map(entry => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'Help me' },
      { kind: 'message', role: 'assistant', content: 'Ready' },
    ])
    expect(page.entries).toHaveLength(2)
    expect(commit).toEqual({
      created_by_json: JSON.stringify({ kind: 'client', id: 'client-1' }),
      correlation_id: 'corr-1',
      call_id: 'call-1',
    })

    await expect(runtime.deleteAgentPreset({ agentPresetId: profile.id })).resolves.toMatchObject({ deleted: true })
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: created.session.id })).entries).toEqual(page.entries)
    await runtime.deleteAgentSession({ agentSessionId: created.session.id })
    await expect(runtime.getAgentSession({ agentSessionId: created.session.id })).rejects.toThrow('Agent session not found')
    engine.close()
  })

  it('requires the shared Prompt Resource Store and Data Engine', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    expect(() => Reflect.apply(createApplicationRuntime, undefined, [{ documents: createInMemoryDocumentStore() }])).toThrow('Prompt Resource Store is required')
  })

  it('runs an Agent-only turn without creating Narrative data', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime, 'Discuss without committing narrative.')
    const created = await runtime.createAgentSession({ agentPresetId: profile.id })
    const result = await runtime.invokeAgentTurn({
      agentSessionId: created.session.id,
      input: 'Discuss the next scene without writing it.',
    })

    expect(result.entries).toMatchObject({
      user: { entry: { kind: 'message', role: 'user', content: 'Discuss the next scene without writing it.' } },
      assistant: { entry: { kind: 'message', role: 'assistant', content: 'Agent draft: Discuss the next scene without writing it.' } },
    })
    expect(result).not.toHaveProperty('narrative')
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: created.session.id })).entries).toHaveLength(5)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('loads Settings linked by the selected Preset without a Narrative Timeline', async () => {
    const { engine, runtime } = createTestRuntime()
    const preset = await createPreset(runtime, 'Official Assistant', 'Loom Studio 是面向 AI 角色扮演的工作台。')
    const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Assistant Knowledge' })
    await runtime.createPromptResourceAsset({
      resourceId: setting.resource.id,
      targetAssetId: setting.resource.rootNode.id,
      position: 'inside',
      asset: { id: 'assistant-knowledge', label: 'Knowledge', kind: 'entry', body: 'Loom Studio 是面向 AI 角色扮演的工作台。' },
    })
    await runtime.replaceSettingMounts({
      source: { kind: 'preset', id: preset.id },
      settingResourceIds: [setting.resource.id],
    })
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Official Test Provider',
      config: {},
      enabledModelIds: [officialFakeModelId],
    })
    const profile = await runtime.updateAgentPreset({
      name: 'Official Assistant',
      agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
    })
    const session = await runtime.createAgentSession({ agentPresetId: profile.agentPreset.id })
    const preview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'What is Loom Studio?' })

    expect(preview.messages.some(message => typeof message.content === 'string' && message.content.includes('Loom Studio 是面向 AI 角色扮演'))).toBe(true)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_timelines').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('uses the same Preset projection for preview and invocation', async () => {
    const calls: Array<{ messages: unknown[] }> = []
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-projection-${++nextAgentId}`, now: () => '2026-08-12T02:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-projection`, now: () => '2026-08-12T02:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      promptResources,
      gateway: {
        invokeChat: async input => {
          calls.push({ messages: input.request.messages })
          return {
            provider: 'fake',
            model: 'projection-model',
            message: { role: 'assistant', content: 'Done.' },
            text: 'Done.',
          }
        },
      },
    })
    const preset = await createPreset(runtime, 'Projection Agent', 'Follow the preset instructions for {{User}}.')
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Projection Provider',
      config: {},
      enabledModelIds: [officialFakeModelId],
    })
    const profile = await runtime.updateAgentPreset({
      name: 'Projection Profile',
      agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
    })
    const session = await runtime.createAgentSession({ agentPresetId: profile.agentPreset.id })
    const preview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Act.' })
    const result = await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'Act.' })

    expect(preview.messages).toEqual(calls[0]?.messages)
    expect(preview.messages[0]).toMatchObject({
      role: 'system', content: expect.stringContaining('Follow the preset instructions for User.'),
    })
    expect(preview.messages.at(-1)).toMatchObject({ role: 'user', content: 'Act.' })
    expect(result.projection).toEqual(preview.projection)
    engine.close()
  })

  it('isolates Narrative prompt rules by the consuming Agent Preset', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Shared Narrative', opening: 'NARRATIVE_MARKER' })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const first = await createProfile(runtime, 'First instructions.')
    const second = await createProfile(runtime, 'Second instructions.')
    await runtime.upsertTextTransformRule({
      ruleId: 'preset-rule-first',
      rule: {
        name: 'First narrative projection',
        owner: { kind: 'preset', presetId: first.preset.id },
        enabled: true,
        orderIndex: 0,
        matcher: { kind: 'regex', pattern: 'NARRATIVE_MARKER', flags: 'g' },
        effect: { kind: 'replace', replacement: 'FIRST_MARKER' },
        targets: ['narrative'],
        phases: ['prompt'],
      },
    })
    await runtime.upsertTextTransformRule({
      ruleId: 'preset-rule-second',
      rule: {
        name: 'Second narrative projection',
        owner: { kind: 'preset', presetId: second.preset.id },
        enabled: true,
        orderIndex: 0,
        matcher: { kind: 'regex', pattern: 'NARRATIVE_MARKER', flags: 'g' },
        effect: { kind: 'replace', replacement: 'SECOND_MARKER' },
        targets: ['narrative'],
        phases: ['prompt'],
      },
    })
    const firstSession = await runtime.createAgentSession({ agentPresetId: first.profile.id })
    const secondSession = await runtime.createAgentSession({ agentPresetId: second.profile.id })

    const firstPreview = await runtime.previewAgentTurn({
      agentSessionId: firstSession.session.id,
      input: 'Continue.',
      narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id },
    })
    const secondPreview = await runtime.previewAgentTurn({
      agentSessionId: secondSession.session.id,
      input: 'Continue.',
      narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id },
    })

    expect(JSON.stringify(firstPreview.projection.messages)).toContain('FIRST_MARKER')
    expect(JSON.stringify(firstPreview.projection.messages)).not.toContain('SECOND_MARKER')
    expect(JSON.stringify(secondPreview.projection.messages)).toContain('SECOND_MARKER')
    expect(JSON.stringify(secondPreview.projection.messages)).not.toContain('FIRST_MARKER')
    engine.close()
  })

  it('lets two presets independently override one shared rule without changing its definition', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const first = await createProfile(runtime)
      const second = await createProfile(runtime)
      const ruleId = 'shared-session-rule'
      await runtime.upsertTextTransformRule({
        ruleId,
        rule: {
          name: 'Shared rule', owner: { kind: 'workspace' }, enabled: false, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'ORIGINAL', flags: 'g' },
          effect: { kind: 'replace', replacement: 'CHANGED' },
          targets: ['agent-session'], phases: ['display'],
        },
      })
      await runtime.updateAgentPreset({
        agentPresetId: first.preset.id, expectedVersion: (await runtime.getAgentPreset({ agentPresetId: first.preset.id })).agentPreset.version,
        textUses: [{ kind: 'rule', id: ruleId, enabled: true }],
      })
      const firstSession = await runtime.createAgentSession({ agentPresetId: first.preset.id })
      const secondSession = await runtime.createAgentSession({ agentPresetId: second.preset.id })
      for (const session of [firstSession.session, secondSession.session]) {
        await runtime.appendAgentTranscriptEntries({
          agentSessionId: session.id, expectedEntryCount: 0,
          entries: [{ entry: { kind: 'message', role: 'assistant', content: 'ORIGINAL' } }],
        })
      }
      expect((await runtime.projectHistory({ source: { kind: 'agent-session', sessionId: firstSession.session.id }, phase: 'display' })).snapshot.entries[0]?.text).toBe('CHANGED')
      expect((await runtime.projectHistory({ source: { kind: 'agent-session', sessionId: secondSession.session.id }, phase: 'display' })).snapshot.entries[0]?.text).toBe('ORIGINAL')
      expect((await runtime.getTextTransformRule({ ruleId })).rule.enabled).toBe(false)
    } finally { engine.close() }
  })

  it('collects a preset Setting identically for Preview and Run without leaking it to another preset', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const first = await createProfile(runtime, 'A instructions')
      const second = await createProfile(runtime, 'B instructions')
      const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'A Setting' })
      await runtime.createPromptResourceAsset({
        resourceId: setting.resource.id, targetAssetId: setting.resource.rootNode.id, position: 'inside',
        asset: { id: 'only-a-setting', kind: 'entry', label: 'Only A', body: 'ONLY_A_SETTING', capabilities: { targetAnchorId: '@chat.system' } },
      })
      await runtime.replaceSettingMounts({ source: { kind: 'preset', id: first.profile.id }, settingResourceIds: [setting.resource.id] })
      const a = await runtime.createAgentSession({ agentPresetId: first.profile.id })
      const b = await runtime.createAgentSession({ agentPresetId: second.profile.id })
      const preview = await runtime.previewAgentTurn({ agentSessionId: a.session.id, input: 'hello' })
      const other = await runtime.previewAgentTurn({ agentSessionId: b.session.id, input: 'hello' })
      expect(JSON.stringify(preview.messages)).toContain('ONLY_A_SETTING')
      expect(JSON.stringify(other.messages)).not.toContain('ONLY_A_SETTING')
      const run = await runtime.invokeAgentTurn({ agentSessionId: a.session.id, input: 'hello' })
      expect(run.projection.messages).toEqual(preview.projection.messages)
    } finally { engine.close() }
  })

  it('applies persisted Text Pipeline order overrides and appends new rules by default order', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime)
    const session = await runtime.createAgentSession({ agentPresetId: profile.id })
    const appended = await runtime.appendAgentTranscriptEntries({
      agentSessionId: session.session.id,
      expectedEntryCount: 0,
      entries: [{ runId: 'run-override', entry: { kind: 'message', role: 'assistant', content: 'A' } }],
    })
    const baseRule = {
      owner: { kind: 'workspace' as const },
      enabled: true,
      targets: ['agent-session' as const],
      phases: ['display' as const],
    }
    await runtime.upsertTextTransformRule({
      ruleId: 'rule-a-to-b',
      rule: { ...baseRule, name: 'A to B', orderIndex: 0, matcher: { kind: 'regex', pattern: 'A', flags: 'g' }, effect: { kind: 'replace', replacement: 'B' } },
    })
    await runtime.upsertTextTransformRule({
      ruleId: 'rule-b-to-c',
      rule: { ...baseRule, name: 'B to C', orderIndex: 1, matcher: { kind: 'regex', pattern: 'B', flags: 'g' }, effect: { kind: 'replace', replacement: 'C' } },
    })
    const source = { kind: 'agent-session' as const, sessionId: session.session.id }
    const override = await runtime.upsertTextPipelineOverride({
      source,
      phase: 'display',
      disabledRuleIds: [],
      orderedRuleIds: ['rule-b-to-c', 'rule-a-to-b'],
    })

    expect((await runtime.projectHistory({ source, phase: 'display' })).snapshot.entries[0]?.text).toBe('B')
    await runtime.upsertTextTransformRule({
      ruleId: 'rule-b-to-d',
      rule: { ...baseRule, name: 'B to D', orderIndex: 2, matcher: { kind: 'regex', pattern: 'B', flags: 'g' }, effect: { kind: 'replace', replacement: 'D' } },
    })
    expect((await runtime.projectHistory({ source, phase: 'display' })).snapshot.entries[0]?.text).toBe('D')
    await runtime.upsertTextExtractor({
      extractorId: 'extract-final-letter',
      extractor: {
        name: 'Final letter',
        owner: { kind: 'workspace' },
        enabled: true,
        orderIndex: 0,
        targets: ['agent-session'],
        matcher: { kind: 'regex', pattern: '(D)', flags: 'g', contentGroup: 1 },
        strategy: 'all-matches',
        parser: 'text',
        artifactType: 'loom/test-letter',
      },
    })
    const inspection = await runtime.inspectTextPipeline({
      source,
      phase: 'display',
      traceEntryId: appended.entries[0]!.id,
    })
    expect(inspection.snapshot.trace).toMatchObject({ entryId: appended.entries[0]!.id, finalText: 'D' })
    expect(inspection.artifacts).toMatchObject([{
      artifactType: 'loom/test-letter',
      values: [{ value: 'D', sourceEntryId: appended.entries[0]!.id }],
    }])

    await runtime.upsertTextPipelineOverride({
      source,
      phase: 'display',
      expectedVersion: override.override.version,
      disabledRuleIds: ['rule-a-to-b'],
      orderedRuleIds: ['rule-b-to-c'],
    })
    expect((await runtime.projectHistory({ source, phase: 'display' })).snapshot.entries[0]?.text).toBe('A')
    engine.close()
  })

  it('includes persisted Agent Session history in the next provider request', async () => {
    const calls: Array<{ messages: unknown[] }> = []
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-history-${++nextAgentId}`, now: () => '2026-08-12T03:00:00.000Z' })
    const narratives = createNarrativeStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      narratives,
      promptResources,
      gateway: {
        invokeChat: async input => {
          calls.push({ messages: input.request.messages })
          const reply = calls.length === 1 ? 'First reply.' : 'Second reply.'
          return {
            provider: 'fake',
            model: 'history-model',
            message: { role: 'assistant', content: reply },
            text: reply,
          }
        },
      },
    })
    const { profile } = await createProfile(runtime, 'Keep the conversation context.')
    const session = await runtime.createAgentSession({ agentPresetId: profile.id })

    await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'First.' })
    const second = await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'Second.' })

    expect(calls[1]?.messages[0]).toMatchObject({
      role: 'system', content: expect.stringContaining('Keep the conversation context.'),
    })
    expect(calls[1]?.messages.slice(-3)).toMatchObject([
      { role: 'user', content: 'First.' },
      { role: 'assistant', content: 'First reply.' },
      { role: 'user', content: 'Second.' },
    ])
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.session.id })).entries).toHaveLength(10)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('delivers committed raw input to new Sessions without automatically appending assistant output', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Story', opening: 'Opening.' })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const { profile } = await createProfile(runtime, 'Continue the accepted narrative.')
    const agent = await runtime.createAgentSession({ agentPresetId: profile.id })
    const appended = await runtime.appendNarrativeInput({
      timelineId: timeline.timeline.id, branchId: timeline.branch.id, nodeId: 'accepted-input',
      expectedHeadNodeId: timeline.branch.headNodeId!, content: 'Continue.',
    })
    const target = { timelineId: timeline.timeline.id, branchId: timeline.branch.id, inputNodeId: appended.node.id }
    const preview = await runtime.previewAgentTurn({
      agentSessionId: agent.session.id, input: 'Untrusted duplicate.', narrativeTarget: target,
    })
    expect(preview.messages.at(-1)).toMatchObject({ role: 'user', content: 'Continue.' })
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: agent.session.id })).entries).toEqual([])
    expect((await runtime.getNarrativePage({ timelineId: timeline.timeline.id })).nodes).toHaveLength(2)
    const result = await runtime.invokeAgentTurn({
      agentSessionId: agent.session.id,
      input: 'Untrusted duplicate.',
      narrativeTarget: target,
    })
    const commit = engine.database.prepare('SELECT operations_json FROM changesets WHERE id = ?')
      .get(result.mutation.changesetId) as { operations_json: string }

    expect(result).not.toHaveProperty('narrative')
    expect(result.entries.user.entry).toMatchObject({ kind: 'message', role: 'user', content: 'Continue.' })
    expect(result.mutation.scope).toBe('agent-session-transcript')

    expect(result.projection.messages[0]).toMatchObject({
      role: 'system', content: expect.stringContaining('Continue the accepted narrative.'),
    })
    expect(result.projection.messages.at(-1)).toMatchObject({ role: 'user', content: 'Continue.' })
    expect(JSON.parse(commit.operations_json).some((operation: { entityType: string }) => operation.entityType.startsWith('narrative.'))).toBe(false)
    const nextSession = await runtime.createAgentSession({ agentPresetId: profile.id })
    const redelivered = await runtime.invokeAgentTurn({ agentSessionId: nextSession.session.id, input: '', narrativeTarget: target })
    expect(redelivered.entries.user.entry).toMatchObject({ content: 'Continue.' })
    expect((await runtime.getNarrativePage({ timelineId: timeline.timeline.id })).nodes.map(node => node.body.raw)).toEqual(['Opening.', 'Continue.'])
    engine.close()
  })

  it('rejects missing and off-path inputs before Session preparation and retains input after delivery failure', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      const card = await runtime.createCard({ name: 'Story', opening: 'Opening.' })
      const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
      const { profile, preset } = await createProfile(runtime)
      const agent = await runtime.createAgentSession({ agentPresetId: profile.id })
      const fork = await runtime.forkNarrativeBranch({ timelineId: timeline.timeline.id, fromBranchId: timeline.branch.id, fromNodeId: timeline.nodes[0]!.id })
      const appended = await runtime.appendNarrativeInput({
        timelineId: timeline.timeline.id, branchId: timeline.branch.id, nodeId: 'main-input',
        expectedHeadNodeId: timeline.branch.headNodeId!, content: 'Persisted.',
      })
      for (const inputNodeId of ['missing', appended.node.id]) {
        await expect(runtime.invokeAgentTurn({
          agentSessionId: agent.session.id, input: 'forged',
          narrativeTarget: { timelineId: timeline.timeline.id, branchId: fork.branch.id, inputNodeId },
        })).rejects.toThrow()
      }
      await runtime.deletePromptResource({ resourceId: preset.id })
      await expect(runtime.invokeAgentTurn({
        agentSessionId: agent.session.id, input: 'forged',
        narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id, inputNodeId: appended.node.id },
      })).rejects.toThrow('Prompt resource not found')
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: agent.session.id })).entries).toEqual([])
      expect((await runtime.getNarrativePage({ timelineId: timeline.timeline.id })).nodes.at(-1)).toEqual(appended.node)
    } finally { await engine.close() }
  })

  it('persists a failed Run boundary when the provider fails', async () => {
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-failure-${++nextAgentId}`, now: () => '2026-08-12T01:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-failure`, now: () => '2026-08-12T01:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      promptResources,
      gateway: { invokeChat: async () => { throw new Error('provider failed') } },
    })
    const preset = await createPreset(runtime, 'Failure Agent', 'Fail safely.')
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Failure Provider',
      config: {},
      enabledModelIds: [officialFakeModelId],
    })
    const profile = await runtime.updateAgentPreset({
      name: 'Failure Profile',
      agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
    })
    const session = await runtime.createAgentSession({ agentPresetId: profile.agentPreset.id })

    await expect(runtime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: 'Fail.',
    })).rejects.toThrow('provider failed')
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.session.id })).entries.map(entry => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'Fail.' },
      { kind: 'run-state', state: 'running' },
      { kind: 'run-state', state: 'failed', reason: 'provider failed' },
    ])
    engine.close()
  })
})
