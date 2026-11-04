import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import { describe, expect, it, vi } from 'vitest'
import { callApplicationRpc as handleAgentsRpc } from '../../support/trpc-caller.js'

describe('application Agent Run RPC', () => {
  it.each([false, true])('cancels owner deletion without retaining a recoverable checkpoint (checkpoint: %s)', async checkpoint => {
    let signal: AbortSignal | undefined
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        signal = context.abortSignal
        if (checkpoint) context.agentRun!.onSuspended!({
          sourceRunId: context.agentRun!.runId,
          messages: [{ role: 'user', content: 'Deleted owner' }],
          userEntry: { id: 'user', agentSessionId: 'deleted', sequence: 1, entry: { kind: 'message', role: 'user', content: 'Deleted owner' }, createdAt: '2026-11-04T00:00:00Z' },
        })
        throw Object.assign(new Error('Agent Session deleted'), { name: 'AbortError', code: 'agent.session_deleted' })
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'deleted', input: 'Wait.',
    }) as { runId: string }
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(signal?.aborted).toBe(false)
    expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
      .toMatchObject({ done: true, state: 'cancelled', events: expect.arrayContaining([{ type: 'cancelled', runId, reason: 'Agent Session deleted' }]) })
    expect(await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId }))
      .toMatchObject({ runId, accepted: false, state: 'cancelled' })
  })

  it('invalidates both continuation and source checkpoints when its owner is deleted during resume preparation', async () => {
    let calls = 0
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        calls++
        if (calls === 1) {
          context.agentRun!.onSuspended!({
            sourceRunId: context.agentRun!.runId,
            messages: [{ role: 'user', content: 'Resume then delete' }],
            userEntry: { id: 'user', agentSessionId: 'deleted', sequence: 1, entry: { kind: 'message', role: 'user', content: 'Resume then delete' }, createdAt: '2026-11-04T00:00:00Z' },
          })
          throw new Error('Recoverable interruption')
        }
        expect(context.agentRun!.continuation).toBeDefined()
        throw Object.assign(new Error('Agent Session deleted'), { name: 'AbortError', code: 'agent.session_deleted' })
      },
    } as unknown as ApplicationRuntime
    const source = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'deleted', input: 'Wait.' }) as { runId: string }
    await new Promise<void>(resolve => setImmediate(resolve))
    const continuation = await handleAgentsRpc(runtime, 'application.agent.run.resume', source) as { runId: string }
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(await handleAgentsRpc(runtime, 'application.agent.run.state', continuation)).toMatchObject({ state: 'cancelled' })
    for (const { runId } of [source, continuation]) {
      expect(await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId })).toMatchObject({ accepted: false })
    }
    expect(calls).toBe(2)
  })

  it('keeps unrelated AbortError failures as failed', async () => {
    const runtime = {
      invokeAgentTurn: async () => { throw new DOMException('Unrelated abort', 'AbortError') },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'other', input: 'Wait.' }) as { runId: string }
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(await handleAgentsRpc(runtime, 'application.agent.run.state', { runId })).toMatchObject({ state: 'failed' })
  })

  it('deduplicates concurrent and completed sends while rejecting changed payloads for the same ID', async () => {
    let calls = 0
    const finish = Promise.withResolvers<void>()
    const runtime = {
      findAgentRunCheckpoint: async () => null,
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        calls++
        await finish.promise
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} }
      },
    } as unknown as ApplicationRuntime
    const request = { requestId: '7xK2mN9pQ4a', agentSessionId: 'session', input: 'Only once' }
    const [first, retry] = await Promise.all([
      handleAgentsRpc(runtime, 'application.agent.run.create', request),
      handleAgentsRpc(runtime, 'application.agent.run.create', request),
    ])
    expect(retry).toEqual(first)
    expect(first).toMatchObject({ runId: request.requestId })
    expect(calls).toBe(1)
    await expect(handleAgentsRpc(runtime, 'application.agent.run.create', { ...request, input: 'Different' })).rejects.toThrow('different input')
    finish.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(await handleAgentsRpc(runtime, 'application.agent.run.create', request)).toEqual(first)
    expect(calls).toBe(1)
  })

  it('protects undelivered completion across byte and metadata pressure, but expires it', async () => {
    vi.useFakeTimers()
    const largeResult = { runId: 'large', projection: { text: 'context '.repeat(1200 * 1024) } }
    const runtime = {
      invokeAgentTurn: async (input: { agentSessionId: string }, context: RuntimeRequestContext) =>
        input.agentSessionId === 'large'
          ? { ...largeResult, runId: context.agentRun!.runId }
          : { runId: context.agentRun!.runId, entries: {}, mutation: {} },
    } as unknown as ApplicationRuntime
    try {
      const original = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'large', input: 'Write' }) as { runId: string }
      await vi.advanceTimersByTimeAsync(0)
      for (let index = 0; index < 130; index++) {
        const done = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: `delivered-${index}`, input: 'Write' }) as { runId: string }
        await vi.advanceTimersByTimeAsync(0)
        await handleAgentsRpc(runtime, 'application.agent.run.acknowledge-completion', { runId: done.runId })
      }
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId: original.runId, cursor: 0 }))
        .toMatchObject({
          state: 'completed', replayExpired: true,
          events: [{ type: 'completed', result: { projection: largeResult.projection } }],
        })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId: original.runId, cursor: 0 }))
        .toMatchObject({ state: 'completed', replayExpired: true, events: [] })
    } finally { vi.useRealTimers() }
  })
  it('keeps the original checkpoint when resume preparation fails and retries from the failed continuation', async () => {
    let attempts = 0
    let recovered = false
    const runtime = {
      invokeAgentTurn: async (input: { activationFacts?: unknown }, context: RuntimeRequestContext) => {
        attempts += 1
        if (attempts === 1) {
          await new Promise<void>((_resolve, reject) => {
            context.abortSignal!.addEventListener('abort', () => {
              context.agentRun!.onSuspended!({
                sourceRunId: context.agentRun!.runId,
                messages: [{ role: 'user', content: 'Original checkpoint' }],
                userEntry: { id: 'user', agentSessionId: 'resume', sequence: 1, entry: { kind: 'message', role: 'user', content: 'Original checkpoint' }, createdAt: '2026-10-02T00:00:00Z' },
              })
              reject(new Error('paused'))
            }, { once: true })
          })
        }
        if (attempts === 2) throw new Error('Temporary preparation failure')
        recovered = context.agentRun!.continuation!.messages[0]?.content === 'Original checkpoint'
          && JSON.stringify(input.activationFacts) === '{"original":true}'
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} }
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'resume', input: 'Original checkpoint', activationFacts: { original: true },
    }) as { runId: string }
    await handleAgentsRpc(runtime, 'application.agent.run.pause', { runId })
    await new Promise<void>(resolve => setImmediate(resolve))
    const failed = await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId }) as { runId: string }
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(await handleAgentsRpc(runtime, 'application.agent.run.state', { runId: failed.runId })).toMatchObject({ state: 'failed' })
    const retry = await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId: failed.runId }) as { runId: string }
    expect(retry.runId).not.toBe(failed.runId)
    expect(recovered).toBe(true)
    expect(attempts).toBe(3)
  })
  it('rejects overlapping RPC creation while allowing another Session to execute', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let invocations = 0
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        invocations += 1
        await pending
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} }
      },
    } as unknown as ApplicationRuntime
    try {
      await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'same', input: 'First' })
      await expect(handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'same', input: 'Overlap' }))
        .rejects.toMatchObject({ cause: { code: 'agent.session_busy' } })
      await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'other', input: 'Concurrent' })
      expect(invocations).toBe(2)
    } finally { release() }
  })

  it('protects a paused checkpoint through replay expiry and completed-Run eviction', async () => {
    vi.useFakeTimers()
    let resumed = false
    const runtime = {
      invokeAgentTurn: async (input: { agentSessionId: string }, context: RuntimeRequestContext) => {
        if (input.agentSessionId === 'paused' && !context.agentRun!.continuation) {
          await new Promise<void>((_resolve, reject) => {
            context.abortSignal!.addEventListener('abort', () => {
              context.agentRun!.onSuspended!({
                sourceRunId: context.agentRun!.runId, messages: [{ role: 'user', content: 'Keep checkpoint' }],
                userEntry: { id: 'user', agentSessionId: 'paused', sequence: 1, entry: { kind: 'message', role: 'user', content: 'Keep checkpoint' }, createdAt: '2026-10-02T00:00:00Z' },
              })
              reject(new Error('paused'))
            }, { once: true })
          })
        }
        if (input.agentSessionId === 'paused') resumed = context.agentRun!.continuation!.messages[0]?.content === 'Keep checkpoint'
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} }
      },
    } as unknown as ApplicationRuntime
    try {
      const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'paused', input: 'Keep checkpoint' }) as { runId: string }
      await handleAgentsRpc(runtime, 'application.agent.run.pause', { runId })
      await vi.advanceTimersByTimeAsync(120_000)
      for (let index = 0; index < 130; index++) {
        const done = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: `done-${index}`, input: 'Finish' }) as { runId: string }
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await handleAgentsRpc(runtime, 'application.agent.run.acknowledge-completion', { runId: done.runId })
      }
      expect(await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId })).toMatchObject({ accepted: true, sourceRunId: runId })
      expect(resumed).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('bounds long-run replay and returns an explicit live snapshot for an expired cursor', async () => {
    let emit!: NonNullable<RuntimeRequestContext['agentRun']>['onEvent']
    let release!: () => void
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        emit = context.agentRun!.onEvent
        await new Promise<void>(resolve => { release = resolve })
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} } as never
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'large', input: 'Write' }) as { runId: string }
    try {
      const delta = 'x'.repeat(8_192)
      for (let index = 0; index < 200; index++)
        emit({ type: 'text-delta', runId, providerRunId: 'provider', providerStep: 1, delta })
      emit({ type: 'reasoning-delta', runId, providerRunId: 'provider', providerStep: 1, reasoningId: 'r', delta: 'Thinking' })
      const reset = await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }) as {
        replayExpired: boolean; partialEvents: { delta: string }[]; events: unknown[]; nextCursor: number
      }
      expect(reset).toMatchObject({ replayExpired: true, events: [], nextCursor: 202 })
      expect(reset.partialEvents[0].delta).toBe(delta.repeat(200))
      expect(reset).toMatchObject({ partialEvents: expect.arrayContaining([expect.objectContaining({ type: 'reasoning-delta', delta: 'Thinking' })]) })
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: reset.nextCursor }))
        .toMatchObject({ events: [], nextCursor: 202, done: false })
      emit({ type: 'text-delta', runId, providerRunId: 'provider', providerStep: 1, delta: 'tail' })
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 202 }))
        .toMatchObject({ events: [{ type: 'text-delta', delta: 'tail' }], nextCursor: 203 })
    } finally { release() }
  })

  it('snapshots interleaved tool arguments and clears them after commitment and termination', async () => {
    let emit!: NonNullable<RuntimeRequestContext['agentRun']>['onEvent']
    const finish = Promise.withResolvers<void>()
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        emit = context.agentRun!.onEvent
        await finish.promise
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} } as never
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'tools', input: 'Write' }) as { runId: string }
    const input = (toolCallId: string, delta: string) => emit({ type: 'tool-input-delta', runId, providerRunId: 'provider', providerStep: 1, streamId: `tool:${toolCallId}`, toolCallId, toolName: 'codeact_json', delta })
    const snapshot = () => handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 })
    try {
      // Evict the replay without finishing the current Provider step.
      for (let i = 0; i < 140; i++) emit({ type: 'text-delta', runId, providerRunId: 'provider', providerStep: 1, delta: 'x'.repeat(8192) })
      input('a', '{')
      input('b', 'second')
      const before = await snapshot()
      input('a', '}')
      expect(before).toMatchObject({ replayExpired: true, partialEvents: expect.arrayContaining([expect.objectContaining({ toolCallId: 'a', delta: '{' }), expect.objectContaining({ toolCallId: 'b', delta: 'second' })]) })
      expect(await snapshot()).toMatchObject({ partialEvents: expect.arrayContaining([expect.objectContaining({ toolCallId: 'a', delta: '{}' }), expect.objectContaining({ toolCallId: 'b', delta: 'second' })]) })
      emit({ type: 'transcript-appended', runId, entries: [{ id: 'saved', agentSessionId: 'tools', runId, sequence: 1, createdAt: '',
        entry: { streamId: 'tool:a', kind: 'tool-invocation', invocationId: 'invocation-a', providerItemId: 'a', toolId: 'codeact', exposedName: 'codeact_json', transport: 'native-function', status: 'proposed' } }] })
      const committed = await snapshot() as { partialEvents: { streamId?: string }[] }
      expect(committed.partialEvents.some(event => event.streamId === 'tool:a')).toBe(false)
      expect(committed.partialEvents.some(event => event.streamId === 'tool:b')).toBe(true)
      input('c', 'unfinished')
      finish.resolve()
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(await snapshot()).toMatchObject({ done: true, partialEvents: [] })
    } finally { finish.resolve() }
  })

  it('expires terminal replay without losing its authoritative completed state', async () => {
    vi.useFakeTimers()
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) =>
        ({ runId: context.agentRun!.runId, entries: {}, mutation: {} }),
    } as unknown as ApplicationRuntime
    try {
      const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'terminal', input: 'Write' }) as { runId: string }
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
        .toMatchObject({ done: true, state: 'completed', events: expect.arrayContaining([expect.objectContaining({ type: 'completed' })]) })
      await vi.advanceTimersByTimeAsync(120_000)
      expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
        .toMatchObject({ done: true, state: 'completed', replayExpired: true, events: [], partialEvents: [] })
      expect(await handleAgentsRpc(runtime, 'application.agent.run.state', { runId })).toMatchObject({ state: 'completed' })
    } finally { vi.useRealTimers() }
  })

  it('reloads the persisted terminal state after the lightweight Run record was evicted', async () => {
    let firstId = ''
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        firstId ||= context.agentRun!.runId
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} }
      },
      getAgentTranscriptPage: async (input: { agentSessionId: string }) => {
        expect(input.agentSessionId).toBe('old-session')
        return { entries: [{ runId: firstId, entry: { kind: 'run-state', state: 'completed' } }] }
      },
    } as unknown as ApplicationRuntime
    for (let index = 0; index < 130; index++) {
      const done = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: `session-${index}`, input: 'Write' }) as { runId: string }
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await handleAgentsRpc(runtime, 'application.agent.run.acknowledge-completion', { runId: done.runId })
    }
    expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId: firstId, cursor: 0, agentSessionId: 'old-session' }))
      .toMatchObject({ state: 'completed', done: true, replayExpired: true, events: [] })
  })
  it('discards a paused run so neither its checkpoint nor transcript can resume', async () => {
    const entries: Array<{ id: string; sequence: number; runId: string; entry: { kind: string; state?: string; role?: string; content?: string } }> = [
      { id: 'user', sequence: 1, runId: 'old', entry: { kind: 'message', role: 'user', content: 'Write' } },
    ]
    let invocations = 0
    const runtime = {
      invokeAgentTurn: (_input: unknown, context: RuntimeRequestContext) => {
        invocations++
        return new Promise((_resolve, reject) => {
          context.abortSignal!.addEventListener('abort', () => {
            context.agentRun?.onSuspended?.({
              sourceRunId: context.agentRun.runId, messages: [],
              userEntry: { id: 'user', agentSessionId: 'session', sequence: 1, runId: 'old', entry: entries[0]!.entry },
            } as never)
            reject(new Error('paused'))
          }, { once: true })
        })
      },
      getAgentTranscriptPage: async () => ({ session: { entryCount: entries.length }, entries }),
      prepareAgentRunRecovery: async () => {
        expect(entries.at(-1)?.entry.state).toBe('discarded')
        return undefined
      },
      appendAgentTranscriptEntries: async (input: { expectedEntryCount: number; entries: Array<{ runId: string; entry: { kind: string; state: string } }> }) => {
        expect(input.expectedEntryCount).toBe(entries.length)
        entries.push({ id: 'discarded', sequence: entries.length + 1, ...input.entries[0]! })
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'session', input: 'Write' }) as { runId: string }
    await handleAgentsRpc(runtime, 'application.agent.run.pause', { runId })
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = await handleAgentsRpc(runtime, 'application.agent.run.state', { runId }) as { state: string }
      if (state.state === 'suspended') break
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(await handleAgentsRpc(runtime, 'application.agent.run.abandon', { runId })).toMatchObject({ accepted: true })
    expect(await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId })).toMatchObject({ accepted: false })
    expect(await handleAgentsRpc(runtime, 'application.agent.run.resume', { agentSessionId: 'session' })).toMatchObject({ accepted: false })
    expect(invocations).toBe(1)
  })

  it('subscribes to committed transcript entries before the Run finishes', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const entry = {
      id: 'invocation-1', agentSessionId: 'session-live', sequence: 3, runId: 'run-live',
      entry: { kind: 'tool-invocation', invocationId: 'call-1', toolId: 'official/read', exposedName: 'read', transport: 'native-function', status: 'proposed' },
      createdAt: '2026-09-30T00:00:00.000Z',
    }
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        context.agentRun!.onEvent({ type: 'transcript-appended', runId: context.agentRun!.runId, entries: [entry] as never })
        await pending
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} } as never
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'session-live', input: 'Read',
    }) as { runId: string }

    const batch = await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }) as {
      events: Array<{ type: string; entries?: unknown[] }>; nextCursor: number; done: boolean
    }
    expect(batch.done).toBe(false)
    expect(batch.events).toContainEqual({ type: 'transcript-appended', runId, entries: [entry] })
    expect(await handleAgentsRpc(runtime, 'application.agent.run.subscribe', {
      runId, cursor: batch.nextCursor,
    })).toMatchObject({ events: [], done: false })
    release()
  })

  it.each(['allow', 'deny', 'cancel'] as const)('handles history read %s separately from mutation approval', async outcome => {
    let decision: unknown
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        decision = await context.agentRun!.onHistoryReadApproval!({
          kind: 'narrative-history-read', timelineId: 't', branchId: 'b',
          selection: { kind: 'tail', count: 1, throughNodeId: 'old' },
          maxNodes: 1, maxCharacters: 100,
        }, context.abortSignal)
        return { runId: context.agentRun!.runId, entries: {}, mutation: {} } as never
      },
    } as unknown as ApplicationRuntime
    const created = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'history', input: 'Read history',
    }) as { runId: string }
    const { runId } = created
    const batch = await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }) as {
      events: Array<{ type: string; requestId?: string; action?: unknown; preview?: unknown }>
    }
    const event = batch.events.find(item => item.type === 'history-read-approval-requested')!
    expect(event.action).toMatchObject({ kind: 'narrative-history-read' })
    expect(event.preview).toBeUndefined()
    const requestId = event.requestId!
    expect(await handleAgentsRpc(runtime, 'application.agent.run.mutation-approval', {
      runId, requestId, allow: true,
    })).toMatchObject({ accepted: false })
    if (outcome === 'cancel') {
      await handleAgentsRpc(runtime, 'application.agent.run.cancel', { runId })
      expect(await handleAgentsRpc(runtime, 'application.agent.run.history-read-approval', {
        runId, requestId, allow: true,
      })).toMatchObject({ accepted: false })
      expect(decision).toBeUndefined()
    } else {
      expect(await handleAgentsRpc(runtime, 'application.agent.run.history-read-approval', {
        runId, requestId, allow: outcome === 'allow', reason: 'user choice',
      })).toMatchObject({ accepted: true })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(decision).toMatchObject({ decision: outcome })
      expect(await handleAgentsRpc(runtime, 'application.agent.run.history-read-approval', {
        runId, requestId, allow: true,
      })).toMatchObject({ accepted: false })
    }
  })

  it('forwards the macro inspection target using the runtime contract', async () => {
    let received: unknown
    const runtime = {
      inspectMacros: async (input: unknown) => {
        received = input
        return { macroInspection: {} }
      },
    } as unknown as ApplicationRuntime

    await handleAgentsRpc(runtime, 'application.inspectMacros', {
      cardId: 'card-1',
      presetId: 'preset-1',
      timelineTarget: { timelineId: 'timeline-1', branchId: 'branch-1' },
      macroSelections: { greeting: 'card:card-1' },
    })

    expect(received).toEqual({
      cardId: 'card-1',
      presetId: 'preset-1',
      timelineTarget: { timelineId: 'timeline-1', branchId: 'branch-1' },
      macroSelections: { greeting: 'card:card-1' },
    })
  })

  it('pauses a Run at a mutation preview until the client allows it', async () => {
    let approved = false
    const runtime = {
      invokeAgentTurn: async (_input: { input: string }, context?: RuntimeRequestContext) => {
        const decision = await context?.agentRun?.onMutationApproval?.({
          action: 'patch',
          path: '/resources/World/Key.md',
          kind: 'prompt-resource',
          before: 'old',
          after: 'new',
        }, context.abortSignal!)
        approved = decision?.decision === 'allow'
        return { runId: context?.agentRun?.runId ?? 'run', agentSession: {}, entries: {}, mutation: {} } as never
      },
    } as unknown as ApplicationRuntime

    const created = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'session-approval',
      input: 'Update the resource.',
    })
    const runId = (created as { runId: string }).runId
    let requestId = ''
    for (let attempt = 0; attempt < 20 && !requestId; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
      const batch = await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }) as {
        events: Array<{ type: string; requestId?: string }>
      }
      requestId = batch.events.find(event => event.type === 'mutation-approval-requested')?.requestId ?? ''
    }
    expect(requestId).toBeTruthy()
    const snapshot = await handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }) as { nextCursor: number }
    await expect(handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: snapshot.nextCursor }))
      .resolves.toMatchObject({ events: [], pendingApprovals: [{ requestId }] })
    await expect(handleAgentsRpc(runtime, 'application.agent.run.mutation-approval', {
      runId, requestId, allow: true,
    })).resolves.toMatchObject({ accepted: true })

    for (let attempt = 0; attempt < 20 && !approved; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 0))
    expect(approved).toBe(true)
    await expect(handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: snapshot.nextCursor }))
      .resolves.toMatchObject({ pendingApprovals: [] })
  })

  it('does not leave an approval pending when cancellation arrives before it is requested', async () => {
    let enterApproval!: () => void
    const gate = new Promise<void>(resolve => { enterApproval = resolve })
    const runtime = {
      invokeAgentTurn: async (_input: unknown, context: RuntimeRequestContext) => {
        await gate
        await context.agentRun!.onMutationApproval!({
          kind: 'prompt-resource', path: '/resources/probe.md', action: 'replace', before: 'a', after: 'b',
        }, context.abortSignal!)
        throw new Error('Cancelled approval must not complete')
      },
    } as unknown as ApplicationRuntime
    const { runId } = await handleAgentsRpc(runtime, 'application.agent.run.create', { agentSessionId: 'cancel-before-approval', input: 'Write' }) as { runId: string }
    await handleAgentsRpc(runtime, 'application.agent.run.cancel', { runId })
    enterApproval()
    await new Promise<void>(resolve => setImmediate(resolve))
    await expect(handleAgentsRpc(runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
      .resolves.toMatchObject({ done: true, state: 'cancelled', pendingApprovals: [] })
  })

  it('pauses with a checkpoint and resumes without a new user input', async () => {
    let invocation = 0
    let resumed = false
    const runtime = {
      invokeAgentTurn: (input: { input: string }, context?: RuntimeRequestContext) => {
        invocation += 1
        if (invocation === 1) {
          return new Promise((_, reject) => {
            context?.abortSignal?.addEventListener('abort', () => {
              if (context.abortSignal?.reason !== 'user-pause') return
              context.agentRun?.onSuspended?.({
                sourceRunId: context.agentRun.runId,
                messages: [{ role: 'user', content: 'original request' }],
                userEntry: {
                  id: 'user-entry',
                  agentSessionId: 'session-1',
                  sequence: 1,
                  runId: context.agentRun.runId,
                  entry: { kind: 'message', role: 'user', content: 'original request' },
                  createdAt: '2026-09-13T00:00:00.000Z',
                },
                partialEntryId: 'partial-entry',
              })
              reject(new Error('paused'))
            }, { once: true })
          })
        }
        resumed = input.input === 'original request' && Boolean(context?.agentRun?.continuation?.userEntry)
        return Promise.resolve({ runId: context?.agentRun?.runId ?? 'run', agentSession: {}, entries: {}, mutation: {} } as never)
      },
    } as unknown as ApplicationRuntime

    const created = await handleAgentsRpc(runtime, 'application.agent.run.create', {
      agentSessionId: 'session-1',
      input: 'original request',
    })
    const runId = (created as { runId: string }).runId
    await handleAgentsRpc(runtime, 'application.agent.run.pause', { runId })

    let state = 'running'
    for (let attempt = 0; attempt < 20 && state === 'running'; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
      state = (await handleAgentsRpc(runtime, 'application.agent.run.state', { runId }) as { state: string }).state
    }
    expect(state).toBe('suspended')

    const resumedRun = await handleAgentsRpc(runtime, 'application.agent.run.resume', { runId }) as {
      runId: string
      sourceRunId: string
      accepted: boolean
    }
    expect(resumedRun).toMatchObject({ sourceRunId: runId, accepted: true })

    for (let attempt = 0; attempt < 20 && !resumed; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    expect(resumed).toBe(true)
  })

  it.each([false, true])('forwards the durable recovery request and messages without rebuilding them (partial: %s)', async partial => {
    let resumedWithContinuation = false
    let invokedInput = 'not-called'
    let continuationMessages: unknown
    const runtime = {
      prepareAgentRunRecovery: async () => ({
        request: { agentSessionId: 'session-persisted', input: 'Tell me a story.' },
        continuation: {
          sourceRunId: 'run-prev',
          userEntry: {
            id: 'user-entry-floor-1',
            agentSessionId: 'session-persisted',
            sequence: 1,
            runId: 'run-prev',
            entry: { kind: 'message', role: 'user', content: 'Tell me a story.' },
            createdAt: '2026-09-20T14:19:53.000Z',
          },
          messages: [
            { role: 'system', content: 'Original prompt.' },
            { role: 'user', content: 'Tell me a story.' },
            ...(partial ? [{ role: 'assistant', content: 'Once upon a time' }] : []),
          ],
        },
      }),
      invokeAgentTurn: (input: { input: string }, context?: RuntimeRequestContext) => {
        invokedInput = input.input
        resumedWithContinuation = Boolean(context?.agentRun?.continuation?.userEntry)
        continuationMessages = context?.agentRun?.continuation?.messages
        return Promise.resolve({ runId: context?.agentRun?.runId ?? 'run', agentSession: {}, entries: {}, mutation: {} } as never)
      },
    } as unknown as ApplicationRuntime

    const resumeResult = await handleAgentsRpc(runtime, 'application.agent.run.resume', {
      agentSessionId: 'session-persisted',
    }) as { runId: string; sourceRunId: string; accepted: boolean }

    expect(resumeResult.accepted).toBe(true)
    expect(resumeResult.sourceRunId).toBe('run-prev')
    expect(invokedInput).toBe('Tell me a story.')
    expect(resumedWithContinuation).toBe(true)
    expect(continuationMessages).toEqual([
      { role: 'system', content: 'Original prompt.' },
      { role: 'user', content: 'Tell me a story.' },
      ...(partial ? [{ role: 'assistant', content: 'Once upon a time' }] : []),
    ])
  })
})
