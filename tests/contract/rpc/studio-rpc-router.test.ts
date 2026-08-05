import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
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
  })

  it('falls back to kernel rpc for unknown studio-server namespaces', async () => {
    const router = createStudioRpcRouter({
      applicationRuntime: {} as ApplicationRuntime,
      kernel: createKernelCaller(),
    })

    await expect(router.call('extension.echo', { text: 'hello' }, context)).resolves.toEqual({
      method: 'extension.echo',
      params: { text: 'hello' },
      callId: 'call-test',
    })
  })

  it('passes rpc call context into application mutations', async () => {
    let receivedContext: unknown
    const applicationRuntime = {
      createCard: async (_input: unknown, requestContext?: unknown) => {
        receivedContext = requestContext
        return {
          card: { id: 'card-1', version: 1, name: 'Card' },
          mutation: { changesetId: 'chg-1' },
        }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })

    await router.call('application.createCard', { name: 'Card' }, context)

    expect(receivedContext).toEqual(context)
  })

  it('passes rpc call context into prompt resource mutations', async () => {
    let receivedContext: unknown
    const applicationRuntime = {
      updatePromptResourceAssets: async (_input: unknown, requestContext?: unknown) => {
        receivedContext = requestContext
        return {
          resource: { id: 'resource-1', version: 2, rootNode: {} },
          mutation: { changesetId: 'chg-resource-1' },
        }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })

    await router.call('application.updatePromptResourceAssets', {
      resourceId: 'resource-1',
      updates: [{ assetId: 'asset-1', label: 'Renamed' }],
    }, context)

    expect(receivedContext).toEqual(context)
  })

  it('passes rpc call context into bundle import and card manifest mutations', async () => {
    const received: unknown[] = []
    const applicationRuntime = {
      importCardBundle: async (_input: unknown, requestContext?: unknown) => {
        received.push(requestContext)
        return { card: { id: 'card-1' }, importBundle: { id: 'bundle-1' } }
      },
      updateCardPromptResources: async (_input: unknown, requestContext?: unknown) => {
        received.push(requestContext)
        return { card: { id: 'card-1' }, mutation: { changesetId: 'chg-1' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })

    await router.call('application.importCardBundle', {
      artifact: {
        schemaVersion: 1,
        artifactId: 'artifact-1',
        displayName: 'Artifact',
        card: { name: 'Card' },
        contextAssets: [],
      },
    }, context)
    await router.call('application.updateCardPromptResources', {
      cardId: 'card-1',
      promptResourceIds: ['resource-1'],
    }, context)

    expect(received).toEqual([context, context])
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
