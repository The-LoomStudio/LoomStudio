import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { describe, expect, it } from 'vitest'

describe('studio client state api', () => {
  it('maps state reads and mutations without changing their payload', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const bridge = createFakeBridge(calls)
    const api = createStudioApi(bridge)

    await api.states.get({ scope: 'global' })
    await api.states.apply({
      target: { scope: 'global' },
      expectedRevisionId: 'state-revision-1',
      operations: [{ op: 'increment', path: '/gold', by: -2 }],
      idempotencyKey: 'tool-invocation-1',
    })
    await api.states.listDefinitions('global')
    await api.states.upsertDefinition({
      definitionId: 'state.gold',
      definition: { kind: 'global', path: 'global.gold', schema: { type: 'number' }, default: 0 },
    })

    expect(calls).toEqual([
      { method: 'application.getStateSnapshot', params: { target: { scope: 'global' } } },
      {
        method: 'application.applyStateMutation',
        params: {
          target: { scope: 'global' },
          expectedRevisionId: 'state-revision-1',
          operations: [{ op: 'increment', path: '/gold', by: -2 }],
          idempotencyKey: 'tool-invocation-1',
        },
      },
      { method: 'application.listStateDefinitions', params: { kind: 'global' } },
      {
        method: 'application.upsertStateDefinition',
        params: {
          definitionId: 'state.gold',
          definition: { kind: 'global', path: 'global.gold', schema: { type: 'number' }, default: 0 },
        },
      },
    ])
  })
})

function createFakeBridge(calls: Array<{ method: string; params?: ClientJsonValue }>): ClientBridge {
  return {
    connect: async () => undefined,
    disconnect: async () => undefined,
    call: async <T>(method: string, params?: ClientJsonValue) => {
      calls.push({ method, params })
      return {} as T
    },
    callWithMeta: async <T>() => ({ result: {} as T, meta: {} }),
    request: async () => ({ jsonrpc: '2.0', id: 'test', result: {} }),
    getConnectionState: () => 'connected',
  }
}
