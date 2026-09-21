import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { handleAgentsRpc } from '../../../apps/studio-server/src/rpc/handlers/application/agents.js'

describe('application Agent Run RPC', () => {
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

  it('resumes from persisted transcript using agentSessionId without repeating user message', async () => {
    let resumedWithContinuation = false
    let invokedInput = 'not-called'
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
  })
})
