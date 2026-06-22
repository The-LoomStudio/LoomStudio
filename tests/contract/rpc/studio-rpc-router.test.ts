import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import type { RendererPocService } from '../../../apps/studio-server/src/renderer-poc.js'
import { createStudioRpcRouter } from '../../../apps/studio-server/src/studio-rpc-router.js'

const context = {
  clientId: 'test-client',
  correlationId: 'corr-test',
  callId: 'call-test',
}

describe('studio rpc router', () => {
  it('exposes studio-server rpc capabilities with required metadata', async () => {
    const router = createStudioRpcRouter({
      applicationRuntime: {} as ApplicationRuntime,
      kernel: createKernelCaller(),
      rendererPoc: createRendererPocService(),
    })

    const listed = await router.call('studio.rpc.listCapabilities', {}, context) as {
      capabilities: Array<{ name: string; namespace: string; owner: string; stability: string }>
    }

    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'studio.rpc.listCapabilities',
      namespace: 'studio',
      owner: 'studio-server',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.createCard',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'renderer.createSession',
      namespace: 'renderer',
      owner: 'studio-server',
      stability: 'experimental',
    }))
  })

  it('falls back to kernel rpc for unknown studio-server namespaces', async () => {
    const router = createStudioRpcRouter({
      applicationRuntime: {} as ApplicationRuntime,
      kernel: createKernelCaller(),
      rendererPoc: createRendererPocService(),
    })

    await expect(router.call('extension.echo', { text: 'hello' }, context)).resolves.toEqual({
      method: 'extension.echo',
      params: { text: 'hello' },
      callId: 'call-test',
    })
  })
})

function createKernelCaller(): {
  callRpc(method: string, params: JsonValue | undefined, context: typeof context): Promise<JsonValue>
} {
  return {
    callRpc: async (method, params, callContext) => ({
      method,
      params: params ?? null,
      callId: callContext.callId,
    }),
  }
}

function createRendererPocService(): RendererPocService {
  return {
    call: method => {
      throw new Error(`Unexpected renderer call: ${method}`)
    },
    handleEventsRequest: () => undefined,
    close: () => undefined,
  }
}
