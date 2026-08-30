import type { AiGateway } from '@loom-studio/application-runtime'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { withAiGatewayLogging } from '../../../apps/studio-server/src/logging/ai-gateway-logging.js'

describe('AI gateway logging', () => {
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
