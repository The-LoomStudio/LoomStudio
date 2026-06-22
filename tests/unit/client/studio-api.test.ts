import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { describe, expect, it } from 'vitest'
import { createRendererApi } from '../../../apps/studio-client/src/shared/api/renderer-api.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('studio client typed api', () => {
  it('maps application calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.listCards': { cards: [] },
      'application.pingModelProfile': { text: 'pong' },
    }))

    await api.cards.list()
    const text = await api.modelProfiles.ping('model-1')

    expect(text).toBe('pong')
    expect(calls).toEqual([
      { method: 'application.listCards', params: {} },
      { method: 'application.pingModelProfile', params: { modelProfileId: 'model-1' } },
    ])
  })

  it('maps prompt workspace calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.importWorkspaceArtifact': { workspace: { id: 'workspace-1' }, card: { id: 'card-1' } },
      'application.getPromptWorkspace': { workspace: { id: 'workspace-1' } },
      'application.updatePromptAsset': { workspace: { id: 'workspace-1' } },
      'application.updateProjectionOrderProfile': { workspace: { id: 'workspace-1' } },
      'application.exportWorkspaceArtifact': { artifact: { artifactId: 'loom-city-v0' } },
    }))

    await api.promptWorkspaces.import({ artifact: { artifactId: 'loom-city-v0' } })
    await api.promptWorkspaces.get('workspace-1')
    await api.promptWorkspaces.updateAsset({ workspaceId: 'workspace-1', assetId: 'asset-1', body: 'updated' })
    await api.promptWorkspaces.updateProjectionOrderProfile({
      workspaceId: 'workspace-1',
      orderNodeId: 'order-1',
      projectionOrderProfile: { id: 'profile-1', scope: 'global', slotRanks: [] },
    })
    await api.promptWorkspaces.export('workspace-1')

    expect(calls).toEqual([
      { method: 'application.importWorkspaceArtifact', params: { artifact: { artifactId: 'loom-city-v0' } } },
      { method: 'application.getPromptWorkspace', params: { workspaceId: 'workspace-1' } },
      { method: 'application.updatePromptAsset', params: { workspaceId: 'workspace-1', assetId: 'asset-1', body: 'updated' } },
      {
        method: 'application.updateProjectionOrderProfile',
        params: {
          workspaceId: 'workspace-1',
          orderNodeId: 'order-1',
          projectionOrderProfile: { id: 'profile-1', scope: 'global', slotRanks: [] },
        },
      },
      { method: 'application.exportWorkspaceArtifact', params: { workspaceId: 'workspace-1' } },
    ])
  })

  it('maps renderer calls through the typed renderer api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createRendererApi(fakeBridge(calls, {
      'renderer.state.set': { state: { loveLevel: 2, messages: [] } },
      'renderer.messages.list': { messages: [] },
    }))

    const state = await api.state.set({ sessionId: 'renderer-1', key: 'loveLevel', value: 2 })
    const messages = await api.messages.list('renderer-1')

    expect(state.loveLevel).toBe(2)
    expect(messages).toEqual([])
    expect(calls).toEqual([
      { method: 'renderer.state.set', params: { sessionId: 'renderer-1', key: 'loveLevel', value: 2 } },
      { method: 'renderer.messages.list', params: { sessionId: 'renderer-1' } },
    ])
  })
})

function fakeBridge(
  calls: Array<{ method: string; params?: ClientJsonValue }>,
  responses: Record<string, unknown>,
): ClientBridge {
  return {
    connect: async () => {},
    disconnect: async () => {},
    call: async (method, params) => {
      calls.push({ method, params })
      return responses[method] as never
    },
    callWithMeta: async (method, params) => {
      calls.push({ method, params })
      return {
        result: responses[method] as never,
        meta: { clientId: 'test-client', correlationId: 'corr-test', callId: 'call-test' },
      }
    },
    request: async () => ({ jsonrpc: '2.0', id: null, result: null, meta: {} }),
    getConnectionState: () => 'connected',
  }
}
