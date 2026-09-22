import type { AiGateway } from '@loom-studio/application-runtime'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { withAiGatewayLogging } from '../../../apps/studio-server/src/logging/ai-gateway-logging.js'

describe('AI gateway logging', () => {
  it.each([false, true])('distinguishes HTTP rejection from cancellation (aborted=%s)', async aborted => {
    const memory = createMemoryLogSink({ capacity: 5 })
    const root = createRootLogger({ service: 'test', instanceId: 'test', sinks: [memory] })
    const controller = new AbortController()
    if (aborted) controller.abort('private user reason')
    const observed = withAiGatewayLogging({
      invokeChat: async () => { throw Object.assign(new Error('private payload'), { statusCode: 429 }) },
    }, root.child('runtime.provider'))
    await expect(observed.invokeChat({
      request: { messages: [{ role: 'user', content: 'private input' }], metadata: { providerStep: 2 } },
      runId: 'run', sessionId: 'session', branchId: 'branch', abortSignal: controller.signal,
    })).rejects.toThrow('private payload')
    expect(memory.list()[1]).toMatchObject({
      event: aborted ? 'provider.invoke.cancelled' : 'provider.invoke.failed',
      level: aborted ? 'info' : 'error',
      data: { providerStep: 2, statusCode: 429, outcome: aborted ? 'cancelled' : 'failed' },
    })
    expect(JSON.stringify(memory.list())).not.toContain('private')
  })

  it('records stream timing and result metadata without recording stream text', async () => {
    const memory = createMemoryLogSink({ capacity: 5 })
    const root = createRootLogger({ service: 'test', instanceId: 'test', sinks: [memory] })
    let delivered = 0
    const observed = withAiGatewayLogging({ invokeChat: async input => {
      input.onEvent?.({ type: 'text-delta', runId: 'gateway', delta: 'private output' })
      return { model: 'test-model', provider: 'test', text: 'private output', message: { role: 'assistant', content: 'private output' }, usage: { outputTokens: 7 }, finishReason: 'stop' }
    } }, root.child('runtime.provider'))
    await observed.invokeChat({
      request: { messages: [] }, runId: 'run', sessionId: 'session', branchId: 'branch',
      delivery: 'stream', onEvent: () => { delivered++ },
    })
    expect(delivered).toBe(1)
    expect(memory.list()[1]?.data).toMatchObject({ firstOutputMs: expect.any(Number), durationMs: expect.any(Number), outputCharacters: 14, usage: { outputTokens: 7 } })
    expect(memory.list()[1]?.data?.usage).not.toHaveProperty('inputTokens')
    expect(JSON.stringify(memory.list())).not.toContain('private')
  })
  it('preserves optional model discovery capability', async () => {
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'provider-test',
      sinks: [],
    })
    const gateway: AiGateway = {
      listModels: async () => ({ modelIds: ['model-a'] }),
      invokeChat: async () => { throw new Error('not used') },
    }

    const observed = withAiGatewayLogging(gateway, root.child('runtime.provider'))

    await expect(observed.listModels?.({ providerProfileId: 'provider-1' }))
      .resolves.toEqual({ modelIds: ['model-a'] })
  })

  it('logs failures without request, response, or error content', async () => {
    const memory = createMemoryLogSink({ capacity: 5 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'provider-test',
      sinks: [memory],
    })
    const gateway: AiGateway = {
      invokeChat: async () => {
        throw new Error('Private provider error content')
      },
    }
    const observed = withAiGatewayLogging(gateway, root.child('runtime.provider'))

    await expect(observed.invokeChat({
      model: { providerProfileId: 'provider-profile-1', modelId: 'model-1' },
      request: { messages: [{ role: 'user', content: 'Private request content' }] },
      runId: 'run-1',
      sessionId: 'session-1',
      branchId: 'branch-1',
      context: { correlationId: 'corr-1', callId: 'call-1' },
    })).rejects.toThrow('Private provider error content')

    expect(memory.list().map(record => record.event)).toEqual([
      'provider.invoke.started',
      'provider.invoke.failed',
    ])
    expect(memory.list()[1]).toMatchObject({
      correlationId: 'corr-1',
      callId: 'call-1',
      data: {
        providerProfileId: 'provider-profile-1',
        modelId: 'model-1',
        messageCount: 1,
        failureType: 'Error',
      },
    })
    expect(JSON.stringify(memory.list())).not.toContain('Private')
  })
})
