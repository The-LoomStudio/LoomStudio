import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { handleAgentsRpc } from '../../../apps/studio-server/src/rpc/handlers/application/agents.js'

describe('application Agent Run RPC', () => {
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
    await expect(handleAgentsRpc(runtime, 'application.agent.run.mutation-approval', {
      runId, requestId, allow: true,
    })).resolves.toMatchObject({ accepted: true })

    for (let attempt = 0; attempt < 20 && !approved; attempt += 1)
      await new Promise(resolve => setTimeout(resolve, 0))
    expect(approved).toBe(true)
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
        resumed = input.input === '' && Boolean(context?.agentRun?.continuation)
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

  it.each([false, true])('resumes from persisted transcript without repeating user message (partial: %s)', async partial => {
    let resumedWithContinuation = false
    let invokedInput = 'not-called'
    let continuationMessages: unknown
    const runtime = {
      getAgentTranscriptPage: async () => ({
        entries: [
          {
            id: 'user-entry-floor-1',
            agentSessionId: 'session-persisted',
            sequence: 1,
            runId: 'run-prev',
            entry: { kind: 'message', role: 'user', content: 'Tell me a story.' },
            createdAt: '2026-09-20T14:19:53.000Z',
          },
          {
            id: 'run-state-1',
            agentSessionId: 'session-persisted',
            sequence: 2,
            runId: 'run-prev',
            entry: { kind: 'run-state', state: 'running' },
            createdAt: '2026-09-20T14:19:54.000Z',
          },
          {
            id: 'observation',
            agentSessionId: 'session-persisted',
            sequence: 4,
            runId: 'run-prev',
            entry: { kind: 'provider-observation', provider: 'test', model: 'test-model' },
            createdAt: '2026-09-20T14:19:55.000Z',
          },
          ...(partial ? [{
            id: 'partial',
            agentSessionId: 'session-persisted',
            sequence: 5,
            runId: 'run-prev',
            entry: { kind: 'message', role: 'assistant', state: 'partial', content: 'Once upon a time' },
            createdAt: '2026-09-20T14:19:55.000Z',
          }] : []),
          {
            id: 'run-state-2',
            agentSessionId: 'session-persisted',
            sequence: 3,
            runId: 'run-prev',
            entry: { kind: 'run-state', state: 'failed', reason: '500 Internal Server Error' },
            createdAt: '2026-09-20T14:19:55.000Z',
          },
        ],
        nextCursor: undefined,
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
    expect(invokedInput).toBe('')
    expect(resumedWithContinuation).toBe(true)
    expect(continuationMessages).toEqual(partial ? [{
      role: 'system',
      content: 'The previous assistant response was interrupted. Continue from this partial response without repeating it:\nOnce upon a time',
    }] : [])
  })
})
