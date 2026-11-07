import { createAgentStore, type AgentTranscriptEntryData } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import { describe, expect, it, vi } from 'vitest'
import { getAgentRunService, setAgentRunListChangeListener } from '../../../apps/studio-server/src/agents/agent-run-service.js'
import { createAgentsRuntimeMethods } from '../../../packages/application-runtime/src/runtime/agents-runtime.js'
import { callApplicationRpc } from '../../support/trpc-caller.js'

function fixture() {
  let time = 0
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => new Date(Date.UTC(2026, 0, 1) + time++).toISOString()
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createAgentStore({ engine, createId, now })
  const actor = { kind: 'system' as const, id: 'test' }
  const methods = createAgentsRuntimeMethods({ agents: store } as Parameters<typeof createAgentsRuntimeMethods>[0])
  const recover = vi.fn(async () => { throw new Error('Unknown tool outcome; refusing replay') })
  const runtime = { getAgentTranscriptPage: methods.getAgentTranscriptPage, listAgentRunStates: methods.listAgentRunStates, inspectAgentRunState: methods.inspectAgentRunState, prepareAgentRunRecovery: recover } as unknown as ApplicationRuntime
  async function seed(id: string, state?: Extract<AgentTranscriptEntryData, { kind: 'run-state' }>['state']) {
    await store.createSession({ id, actor, agentPresetId: 'preset', title: `Title ${id}`, timelineId: 'story' })
    if (state) await append(id, `${id}-run`, { kind: 'run-state', state })
  }
  async function append(agentSessionId: string, runId: string, entry: AgentTranscriptEntryData) {
    const session = (await store.getSession(agentSessionId))!
    return store.appendEntries({ actor, agentSessionId, expectedEntryCount: session.entryCount, entries: [{ runId, entry }] })
  }
  return { engine, store, actor, runtime, recover, seed, append, service: getAgentRunService(runtime) }
}

describe('Agent task list', () => {
  it('filters the current Timeline before applying the completed task limit', async () => {
    const f = fixture()
    try {
      await f.seed('current', 'completed')
      for (let i = 0; i < 35; i++) {
        const id = `other-${i}`
        await f.store.createSession({ id, actor: f.actor, agentPresetId: 'preset', timelineId: 'other-story' })
        await f.append(id, `${id}-run`, { kind: 'run-state', state: 'completed' })
      }
      const result = await callApplicationRpc(f.runtime, 'application.agent.run.list', { timelineId: 'story' }) as Awaited<ReturnType<typeof f.service.list>>
      expect(result.tasks.map(task => task.agentSessionId)).toEqual(['current'])
      expect((await f.service.list({ timelineId: 'missing' })).tasks).toEqual([])
      expect((await f.service.list()).tasks).toHaveLength(30)
    } finally { f.engine.close() }
  })

  it('queries only each live Session latest run-state and excludes private transcript contents', async () => {
    const f = fixture()
    try {
      await f.seed('empty')
      await f.seed('deleted', 'completed')
      await f.store.deleteSession({ actor: f.actor, agentSessionId: 'deleted' })
      await f.seed('writing', 'suspended')
      const saved = await f.append('writing', 'new-run', {
        kind: 'run-state', state: 'failed', reason: 'Provider unavailable', sourceRunId: 'writing-run',
        recovery: { prompt: 'PRIVATE RECOVERY' },
      })
      await f.append('writing', 'new-run', { kind: 'message', role: 'assistant', content: 'PRIVATE BODY' })
      const rows = await f.store.listRunStates()
      expect(rows.map(row => row.agentSessionId).sort()).toEqual(['empty', 'writing'])
      expect(rows.find(row => row.agentSessionId === 'empty')?.run).toBeUndefined()
      expect(rows.find(row => row.agentSessionId === 'writing')?.run).toEqual({
        runId: 'new-run', state: 'failed', reason: 'Provider unavailable', updatedAt: saved.entries[0]!.createdAt,
      })
      expect(JSON.stringify(rows)).not.toContain('PRIVATE')
      expect(JSON.stringify(rows)).not.toContain('sourceRunId')
    } finally { f.engine.close() }
  })

  it('maps cold running to interrupted and exposes only tentative recovery operations without reading checkpoints', async () => {
    const f = fixture()
    try {
      for (const state of ['running', 'created', 'suspended', 'completed', 'failed', 'aborted', 'discarded'] as const)
        await f.seed(state, state)
      const result = await callApplicationRpc(f.runtime, 'application.agent.run.list', undefined) as Awaited<ReturnType<typeof f.service.list>>
      const byId = new Map(result.tasks.map(task => [task.agentSessionId, task]))
      expect(byId.get('running')).toMatchObject({ state: 'interrupted', canPause: false, canResume: true, canAbandon: true })
      expect(byId.get('created')).toMatchObject({ state: 'interrupted', canPause: false })
      expect(byId.get('suspended')).toMatchObject({ state: 'suspended', canResume: true, canAbandon: true })
      expect(byId.get('aborted')?.state).toBe('cancelled')
      for (const id of ['completed', 'failed', 'aborted', 'discarded'])
        expect(byId.get(id)).toMatchObject({ canPause: false, canResume: false, canAbandon: false })
      expect(f.recover).not.toHaveBeenCalled()
      await expect(f.service.resume({ runId: 'running-run', agentSessionId: 'running' })).rejects.toThrow('Unknown tool outcome')
      expect(f.recover).toHaveBeenCalledOnce()
    } finally { f.engine.close() }
  })

  it('retains every unfinished Session in addition to the newest thirty terminal Sessions', async () => {
    const f = fixture()
    try {
      for (let i = 0; i < 5; i++) await f.seed(`unfinished-${i}`, 'suspended')
      for (let i = 0; i < 35; i++) await f.seed(`ended-${i}`, 'completed')
      const { tasks } = await f.service.list()
      expect(tasks).toHaveLength(35)
      expect(tasks.filter(task => task.state === 'suspended')).toHaveLength(5)
      expect(tasks.filter(task => task.state === 'completed')).toHaveLength(30)
      expect(tasks.some(task => task.agentSessionId === 'ended-0')).toBe(false)
      expect(tasks.some(task => task.agentSessionId === 'ended-34')).toBe(true)
    } finally { f.engine.close() }
  })

  it('includes live runs before the first persisted state but never includes deleted Sessions', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<void>()
    try {
      await f.seed('new')
      f.runtime.invokeAgentTurn = vi.fn(async (_input, context) => {
        await pending.promise
        return { runId: context!.agentRun!.runId } as never
      })
      const { runId } = await f.service.create({ agentSessionId: 'new', input: 'PRIVATE INPUT' })
      expect((await f.service.list()).tasks).toEqual([expect.objectContaining({
        runId, agentSessionId: 'new', title: 'Title new', timelineId: 'story', state: 'running', canPause: true,
      })])
      expect(JSON.stringify(await f.service.list())).not.toContain('PRIVATE INPUT')
      await f.store.deleteSession({ actor: f.actor, agentSessionId: 'new' })
      expect((await f.service.list()).tasks).toEqual([])
    } finally {
      pending.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      f.engine.close()
    }
  })

  it('offers live checkpoint recovery and shows only the continuation while it runs', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<void>()
    const snapshots: Array<ReturnType<typeof f.service.list>> = []
    try {
      await f.seed('paused')
      setAgentRunListChangeListener(f.runtime, sessionId => {
        expect(sessionId).toBe('paused')
        snapshots.push(f.service.list({ timelineId: 'story' }))
      })
      f.runtime.invokeAgentTurn = vi.fn(async (_input, context?: RuntimeRequestContext) => {
        if (context!.agentRun!.continuation) { await pending.promise; return { runId: context!.agentRun!.runId } as never }
        await new Promise<void>((_resolve, reject) => context!.abortSignal!.addEventListener('abort', () => {
          context!.agentRun!.onSuspended!({ sourceRunId: context!.agentRun!.runId,
            messages: [{ role: 'user', content: 'PRIVATE CHECKPOINT' }],
            userEntry: { id: 'user', agentSessionId: 'paused', sequence: 1, createdAt: '', entry: { kind: 'message', role: 'user', content: 'PRIVATE INPUT' } },
          })
          reject(new Error('Paused'))
        }, { once: true }))
        return {} as never
      })
      const original = await f.service.create({ agentSessionId: 'paused', input: 'PRIVATE INPUT' })
      expect((await snapshots[0])?.tasks[0]).toMatchObject({ runId: original.runId, state: 'running' })
      f.service.cancel(original.runId, 'user-pause')
      await new Promise<void>(resolve => setImmediate(resolve))
      expect((await f.service.list()).tasks).toEqual([expect.objectContaining({
        runId: original.runId, state: 'suspended', canResume: true, canAbandon: true, canPause: false,
      })])
      expect((await snapshots[1])?.tasks[0]).toMatchObject({ runId: original.runId, state: 'suspended', canResume: true })
      const continued = await f.service.resume({ runId: original.runId })
      const { tasks } = await f.service.list()
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ runId: continued.runId, state: 'running', canPause: true, canResume: false, canAbandon: false })
      expect(JSON.stringify(tasks)).not.toContain('PRIVATE')
      expect((await snapshots[2])?.tasks[0]).toMatchObject({ runId: continued.runId, state: 'running' })
      pending.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      expect((await snapshots[3])?.tasks[0]).toMatchObject({ runId: continued.runId, state: 'completed', canPause: false })
      expect(snapshots).toHaveLength(4)
    } finally {
      pending.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      f.engine.close()
    }
  })

  it('keeps the source checkpoint resumable and abandonable after continuation preparation fails', async () => {
    const f = fixture()
    let attempts = 0
    try {
      await f.seed('retained')
      f.runtime.invokeAgentTurn = vi.fn(async (_input, context?: RuntimeRequestContext) => {
        attempts += 1
        if (attempts > 1) throw new Error('Continuation preparation failed')
        await new Promise<void>((_resolve, reject) => context!.abortSignal!.addEventListener('abort', () => {
          context!.agentRun!.onSuspended!({ sourceRunId: context!.agentRun!.runId, messages: [],
            userEntry: { id: 'user', agentSessionId: 'retained', sequence: 1, createdAt: '', entry: { kind: 'message', role: 'user', content: 'Private' } },
          })
          reject(new Error('Paused'))
        }, { once: true }))
        return {} as never
      })
      const source = await f.service.create({ agentSessionId: 'retained', input: 'Private' })
      f.service.cancel(source.runId, 'user-pause')
      await new Promise<void>(resolve => setImmediate(resolve))
      await f.append('retained', source.runId, { kind: 'run-state', state: 'suspended' })
      const failed = await f.service.resume({ runId: source.runId })
      await new Promise<void>(resolve => setImmediate(resolve))
      const { tasks } = await f.service.list()
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ runId: source.runId, state: 'suspended', canResume: true,
        canAbandon: true, reason: 'Continuation preparation failed' })
      expect(tasks[0]!.runId).not.toBe(failed.runId)
      f.runtime.getAgentTranscriptPage = input => f.store.getEntryPage(input)
      f.runtime.appendAgentTranscriptEntries = async input => {
        const result = await f.store.appendEntries({ ...input, actor: f.actor })
        return { session: result.session, entries: result.entries, mutation: { changesetId: result.commit.changesetId } }
      }
      expect((await f.service.abandon(tasks[0]!.runId)).accepted).toBe(true)
      expect((await f.service.list()).tasks[0]).toMatchObject({ runId: source.runId, state: 'discarded', canResume: false, canAbandon: false })
    } finally { f.engine.close() }
  })

  it('keeps the persisted cold source abandonable when continuation preparation fails before checkpoint transfer', async () => {
    const f = fixture()
    try {
      await f.seed('cold', 'suspended')
      const request = { agentSessionId: 'cold', input: 'Private' }
      const prepare = vi.fn<ApplicationRuntime['prepareAgentRunRecovery']>(async () => ({
        request,
        continuation: {
          sourceRunId: 'cold-run', messages: [], expectedEntryCount: (await f.store.getSession('cold'))!.entryCount,
          userEntry: { id: 'user', agentSessionId: 'cold', sequence: 1, createdAt: '', entry: { kind: 'message', role: 'user', content: 'Private' } },
          recovery: {
            version: 1, phase: 'provider', executor: { pid: process.pid, id: 'cold-run' }, request,
            model: { providerProfileId: 'provider', modelId: 'model' }, toolContract: '', messages: [],
            userEntryId: 'user', nextProviderStep: 1, promptExtensionLeases: [],
          },
        },
      }))
      f.runtime.prepareAgentRunRecovery = prepare
      f.runtime.invokeAgentTurn = vi.fn(async () => { throw new Error('Cold preparation failed') })
      const failed = await f.service.resume({ runId: 'cold-run', agentSessionId: 'cold' })
      await new Promise<void>(resolve => setImmediate(resolve))
      const { tasks } = await f.service.list()
      expect(tasks).toHaveLength(1)
      expect(tasks[0]).toMatchObject({ runId: 'cold-run', state: 'suspended', canResume: true, canAbandon: true })
      expect(tasks[0]!.runId).not.toBe(failed.runId)
      expect(prepare).toHaveBeenCalledOnce()
      f.runtime.appendAgentTranscriptEntries = async input => {
        const result = await f.store.appendEntries({ ...input, actor: f.actor })
        return { session: result.session, entries: result.entries, mutation: { changesetId: result.commit.changesetId } }
      }
      expect((await f.service.abandon(tasks[0]!.runId, undefined, 'cold')).accepted).toBe(true)
      expect(prepare).toHaveBeenLastCalledWith({ runId: 'cold-run', agentSessionId: 'cold' })
      expect(prepare).toHaveBeenCalledOnce()
      expect((await f.service.list()).tasks[0]).toMatchObject({ runId: 'cold-run', state: 'discarded', canResume: false, canAbandon: false })
    } finally { f.engine.close() }
  })

  it('does not inherit the previous persisted Run reason into a new live Run', async () => {
    const f = fixture()
    const pending = Promise.withResolvers<void>()
    try {
      await f.seed('new-attempt')
      await f.append('new-attempt', 'old-run', { kind: 'run-state', state: 'failed', reason: 'Old failure' })
      f.runtime.invokeAgentTurn = vi.fn(async (_input, context) => {
        await pending.promise
        return { runId: context!.agentRun!.runId } as never
      })
      const created = await f.service.create({ agentSessionId: 'new-attempt', input: 'Private' })
      const { tasks } = await f.service.list()
      expect(tasks[0]).toMatchObject({ runId: created.runId, state: 'running' })
      expect(tasks[0]).not.toHaveProperty('reason')
    } finally {
      pending.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      f.engine.close()
    }
  })

  it('does not infer executor termination when a persisted Run is absent from this service', async () => {
    const f = fixture()
    try {
      await f.seed('direct', 'running')
      f.recover.mockRejectedValueOnce(Object.assign(new Error('The original Agent executor is still active'), { code: 'agent.recovery_executor_active' }))
      expect((await f.service.list()).tasks[0]).toMatchObject({ state: 'interrupted', canPause: false })
      expect(f.recover).not.toHaveBeenCalled()
      await expect(f.service.resume({ runId: 'direct-run', agentSessionId: 'direct' }))
        .rejects.toMatchObject({ code: 'agent.recovery_executor_active' })
    } finally { f.engine.close() }
  })
})
