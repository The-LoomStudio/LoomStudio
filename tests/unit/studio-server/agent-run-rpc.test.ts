import type { ApplicationRuntime, RuntimeRequestContext } from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'
import { handleAgentsRpc } from '../../../apps/studio-server/src/rpc/handlers/application/agents.js'

describe('application Agent Run RPC', () => {
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
})
