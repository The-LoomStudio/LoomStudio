import {
  createAiGatewayCapabilityRegistry,
  createProfiledAiGateway,
  type AiGatewayCapabilityRegistry,
  type ProfiledAiGateway,
} from '@loom-studio/ai-gateway'
import { describe, expect, it, vi } from 'vitest'
import type { JsonValue } from '@loom-studio/shared'
import { aiRouter } from '../../../apps/studio-server/src/rpc/trpc/services.js'
import type { StudioTrpcContext } from '../../../apps/studio-server/src/rpc/trpc/context.js'
import type { StudioRpcServices } from '../../../apps/studio-server/src/rpc/trpc/services-context.js'

function caller(services: { registry: AiGatewayCapabilityRegistry; gateway: ProfiledAiGateway }) {
  const runtime = {} as StudioTrpcContext['runtime']
  return aiRouter.createCaller({
    runtime,
    request: {},
    services: {
      applicationRuntime: runtime,
      kernel: {} as StudioRpcServices['kernel'],
      aiCapabilities: services.registry,
      aiGateway: services.gateway,
    },
  })
}

describe('AI Gateway RPC', () => {
  it.each<JsonValue>([
    { ranking: [2, 0, 1], scores: [0.9, 0.6, 0.2] },
    { vectors: [[0.25, -0.5]], vendorMetadata: { revision: 'v1' } },
    { choices: [{ message: { role: 'assistant', content: 'Unmodified output' } }] },
  ])('lists providers and preserves capability output in invocation and RPC Run results: %j', async output => {
    const registry = createAiGatewayCapabilityRegistry()
    registry.register({
      provider: {
        id: 'test.opaque',
        displayName: 'Opaque',
        capabilities: [{ id: 'vendor.operation', displayName: 'Vendor operation' }],
      },
      handlers: { 'vendor.operation': () => output },
    }, { kind: 'platform' })
    const gateway = createProfiledAiGateway({
      registry,
      resolveProfile: async profileId => ({
        profileId, providerProfileId: 'account', providerId: 'test.opaque',
        capabilityId: 'vendor.operation', accountConfig: {}, profileConfig: {},
      }),
    })
    const rpc = caller({ registry, gateway })
    await expect(rpc.providers.list()).resolves.toMatchObject({ providers: [{ id: 'test.opaque' }] })
    await expect(rpc.invoke({ profileId: 'profile', input: {} })).resolves.toMatchObject({ profileId: 'profile', output })
    const createRun = vi.spyOn(gateway, 'createRun')
    try {
      const created = await caller({ registry, gateway }).run.create({
        profileId: 'profile', input: {},
      }) as { runId: string }
      const rpcResult = await createRun.mock.results[0]!.value.result
      expect(rpcResult.output).toEqual(output)
      expect(await caller({ registry, gateway }).run.subscribe({ runId: created.runId })).toMatchObject({
        state: 'completed',
        events: [
          { type: 'started', runId: created.runId },
          { type: 'completed', runId: created.runId, result: rpcResult },
        ],
      })
    } finally {
      createRun.mockRestore()
    }
  })

  it('creates, subscribes to, and cancels an in-memory run', async () => {
    const registry = createAiGatewayCapabilityRegistry()
    registry.register({
      provider: {
        id: 'test.provider',
        displayName: 'Test',
        capabilities: [{ id: 'test', displayName: 'Test' }],
      },
      handlers: {
        test: ({ signal }) => new Promise(resolve => {
          signal?.addEventListener('abort', () => resolve({ cancelled: true }), { once: true })
        }),
      },
    }, { kind: 'platform' })
    const gateway = createProfiledAiGateway({
      registry,
      resolveProfile: async profileId => ({
        profileId,
        providerProfileId: 'provider-profile-1',
        providerId: 'test.provider',
        capabilityId: 'test',
        accountConfig: {},
        profileConfig: {},
      }),
    })
    const services = { registry, gateway }
    await expect(caller(services).run.state({ runId: 'missing' })).rejects.toThrow('Gateway run not found: missing')
    const created = await caller(services).run.create({ profileId: 'profile-1', input: {} }) as { runId: string }
    await expect(caller(services).run.state({ runId: created.runId })).resolves.toMatchObject({ state: 'running' })
    await expect(caller(services).run.cancel({ runId: created.runId, reason: 'user-stop' })).resolves.toMatchObject({ runId: created.runId })
    await expect(caller(services).run.subscribe({ runId: created.runId })).resolves.toMatchObject({
      events: [
        { type: 'started' },
        { type: 'cancelled', reason: 'user-stop' },
      ],
      state: 'cancelled',
    })
    await expect(caller(services).run.subscribe({ runId: created.runId, cursor: 1 })).resolves.toMatchObject({
      events: [{ type: 'cancelled', reason: 'user-stop' }],
      state: 'cancelled',
    })
  })
})
