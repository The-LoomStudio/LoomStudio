import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { createRendererApi } from '../../../apps/studio-client/src/shared/api/renderer-api.js'
import { createStudioApi, withClientBridgeLogging } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('studio client typed api', () => {
  it('logs failed rpc calls without params or error messages', async () => {
    const logs = createMemoryLogSink({ capacity: 10 })
    const root = createRootLogger({ service: 'studio-client', instanceId: 'client-test', sinks: [logs] })
    const privateError = Object.assign(new Error('private server failure text'), { code: 'RPC_FAILED' })
    const bridge = withClientBridgeLogging(failingBridge(privateError), root.child('transport.rpc'))

    await expect(bridge.call('application.updateCard', {
      name: 'Private character name',
      body: 'Private character content',
    })).rejects.toBe(privateError)

    const records = logs.list()
    expect(records).toHaveLength(1)
    expect(records[0]?.message).toMatch(/^application\.updateCard failed after \d+(?:\.\d+)? ms$/)
    expect(records[0]?.data).toMatchObject({
      method: 'application.updateCard',
      failureType: 'Error',
      errorCode: 'RPC_FAILED',
    })
    expect(JSON.stringify(records)).not.toContain('Private character')
    expect(JSON.stringify(records)).not.toContain('private server failure text')
  })

  it('maps log queries through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'logs.list': {
        items: [],
        cursor: 'memory:test:0',
        hasMore: false,
      },
    }))

    const page = await api.logs.list({
      limit: 50,
      levels: ['warn', 'error'],
      namespacePrefix: 'transport.rpc',
    })

    expect(page.cursor).toBe('memory:test:0')
    expect(calls).toEqual([{
      method: 'logs.list',
      params: {
        limit: 50,
        levels: ['warn', 'error'],
        namespacePrefix: 'transport.rpc',
      },
    }])
  })

  it('maps application calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'docs.revertChangeset': { changesetId: 'change-undo' },
      'application.listCards': { cards: [] },
      'application.updateCard': { card: { id: 'card-1' } },
      'application.deleteCard': { deleted: true },
      'application.pingModelProfile': { text: 'pong' },
    }))

    const reverted = await api.history.revert('change-1')
    await api.cards.list()
    await api.cards.update({ cardId: 'card-1', name: 'Renamed' })
    await api.cards.delete('card-1')
    const text = await api.modelProfiles.ping('model-1')

    expect(text).toBe('pong')
    expect(reverted).toEqual({ changesetId: 'change-undo' })
    expect(calls).toEqual([
      { method: 'docs.revertChangeset', params: { changesetId: 'change-1' } },
      { method: 'application.listCards', params: {} },
      { method: 'application.updateCard', params: { cardId: 'card-1', name: 'Renamed' } },
      { method: 'application.deleteCard', params: { cardId: 'card-1' } },
      { method: 'application.pingModelProfile', params: { modelProfileId: 'model-1' } },
    ])
  })

  it('maps prompt workspace calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.importWorkspaceArtifact': { workspace: { id: 'workspace-1' }, card: { id: 'card-1' } },
      'application.getPromptWorkspace': { workspace: { id: 'workspace-1' } },
      'application.listPromptWorkspaces': { workspaces: [{ id: 'workspace-1' }] },
      'application.createPromptAsset': { workspace: { id: 'workspace-1' } },
      'application.updatePromptAsset': { workspace: { id: 'workspace-1' } },
      'application.updatePromptAssets': { workspace: { id: 'workspace-1' } },
      'application.movePromptAsset': { workspace: { id: 'workspace-1' } },
      'application.deletePromptAsset': { workspace: { id: 'workspace-1' } },
      'application.updateProjectionOrderProfile': { workspace: { id: 'workspace-1' } },
      'application.exportWorkspaceArtifact': { artifact: { artifactId: 'loom-city-v0' } },
    }))

    await api.promptWorkspaces.import({ artifact: { artifactId: 'loom-city-v0' } })
    await api.promptWorkspaces.get('workspace-1')
    await api.promptWorkspaces.list({ cardId: 'card-1' })
    await api.promptWorkspaces.createAsset({ workspaceId: 'workspace-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1', label: 'A', kind: 'entry' } })
    await api.promptWorkspaces.updateAsset({ workspaceId: 'workspace-1', assetId: 'asset-1', body: 'updated' })
    await api.promptWorkspaces.updateAssets({ workspaceId: 'workspace-1', updates: [{ assetId: 'asset-1', body: 'updated again' }] })
    await api.promptWorkspaces.moveAsset({ workspaceId: 'workspace-1', assetId: 'asset-1', targetAssetId: 'root', position: 'after' })
    await api.promptWorkspaces.deleteAsset({ workspaceId: 'workspace-1', assetId: 'asset-1' })
    await api.promptWorkspaces.updateProjectionOrderProfile({
      workspaceId: 'workspace-1',
      orderNodeId: 'order-1',
      projectionOrderProfile: { id: 'profile-1', scope: 'global', slotRanks: [] },
    })
    await api.promptWorkspaces.export('workspace-1')

    expect(calls).toEqual([
      { method: 'application.importWorkspaceArtifact', params: { artifact: { artifactId: 'loom-city-v0' } } },
      { method: 'application.getPromptWorkspace', params: { workspaceId: 'workspace-1' } },
      { method: 'application.listPromptWorkspaces', params: { cardId: 'card-1' } },
      { method: 'application.createPromptAsset', params: { workspaceId: 'workspace-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1', label: 'A', kind: 'entry' } } },
      { method: 'application.updatePromptAsset', params: { workspaceId: 'workspace-1', assetId: 'asset-1', body: 'updated' } },
      { method: 'application.updatePromptAssets', params: { workspaceId: 'workspace-1', updates: [{ assetId: 'asset-1', body: 'updated again' }] } },
      { method: 'application.movePromptAsset', params: { workspaceId: 'workspace-1', assetId: 'asset-1', targetAssetId: 'root', position: 'after' } },
      { method: 'application.deletePromptAsset', params: { workspaceId: 'workspace-1', assetId: 'asset-1' } },
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

function failingBridge(error: Error): ClientBridge {
  return {
    connect: async () => {},
    disconnect: async () => {},
    call: async () => { throw error },
    callWithMeta: async () => { throw error },
    request: async () => { throw error },
    getConnectionState: () => 'connected',
  }
}
