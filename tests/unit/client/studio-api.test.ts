import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { withClientBridgeLogging } from '../../../apps/studio-client/src/shared/api/client-bridge-logging.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

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
      'application.getImportBundle': { importBundle: { id: 'import-bundle-1' } },
      'application.listCards': { cards: [] },
      'application.updateCard': { card: { id: 'card-1' } },
      'application.updateCardPromptResources': { card: { id: 'card-1' } },
      'application.deleteCard': { deleted: true },
      'application.exportCardArtifact': { artifact: { artifactId: 'card-1' } },
      'application.pingModelProfile': { text: 'pong' },
    }))

    const reverted = await api.history.revert('change-1')
    await api.importBundles.get('import-bundle-1')
    await api.cards.list()
    await api.cards.update({ cardId: 'card-1', name: 'Renamed' })
    await api.cards.updatePromptResources({ cardId: 'card-1', promptResourceIds: ['resource-1'] })
    await api.cards.delete('card-1')
    await api.cards.export('card-1')
    const text = await api.modelProfiles.ping('model-1')

    expect(text).toBe('pong')
    expect(reverted).toEqual({ changesetId: 'change-undo' })
    expect(calls).toEqual([
      { method: 'docs.revertChangeset', params: { changesetId: 'change-1' } },
      { method: 'application.getImportBundle', params: { importBundleId: 'import-bundle-1' } },
      { method: 'application.listCards', params: {} },
      { method: 'application.updateCard', params: { cardId: 'card-1', name: 'Renamed' } },
      { method: 'application.updateCardPromptResources', params: { cardId: 'card-1', promptResourceIds: ['resource-1'] } },
      { method: 'application.deleteCard', params: { cardId: 'card-1' } },
      { method: 'application.exportCardArtifact', params: { cardId: 'card-1' } },
      { method: 'application.pingModelProfile', params: { modelProfileId: 'model-1' } },
    ])
  })

  it('maps card bundle imports through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.importCardBundle': { card: { id: 'card-1' }, importBundle: { id: 'import-bundle-1' } },
    }))

    await api.cardBundles.import({ artifact: { artifactId: 'loom-city-v0' } })

    expect(calls).toEqual([
      { method: 'application.importCardBundle', params: { artifact: { artifactId: 'loom-city-v0' } } },
    ])
  })

  it('maps prompt resource calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.getPromptResource': { resource: { id: 'resource-1' } },
      'application.listCardPromptResources': { resources: [{ id: 'resource-1' }] },
      'application.createPromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.updatePromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.updatePromptResourceAssets': { resource: { id: 'resource-1' } },
      'application.movePromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.deletePromptResourceAsset': { resource: { id: 'resource-1' } },
    }))

    await api.promptResources.get('resource-1')
    await api.promptResources.listForCard('card-1')
    await api.promptResources.createAsset({ resourceId: 'resource-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1' } })
    await api.promptResources.updateAsset({ resourceId: 'resource-1', assetId: 'asset-1', body: 'updated' })
    await api.promptResources.updateAssets({ resourceId: 'resource-1', updates: [{ assetId: 'asset-1', label: 'Renamed' }] })
    await api.promptResources.moveAsset({ resourceId: 'resource-1', assetId: 'asset-1', targetAssetId: 'root', position: 'after' })
    await api.promptResources.deleteAsset({ resourceId: 'resource-1', assetId: 'asset-1' })

    expect(calls).toEqual([
      { method: 'application.getPromptResource', params: { resourceId: 'resource-1' } },
      { method: 'application.listCardPromptResources', params: { cardId: 'card-1' } },
      { method: 'application.createPromptResourceAsset', params: { resourceId: 'resource-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1' } } },
      { method: 'application.updatePromptResourceAsset', params: { resourceId: 'resource-1', assetId: 'asset-1', body: 'updated' } },
      { method: 'application.updatePromptResourceAssets', params: { resourceId: 'resource-1', updates: [{ assetId: 'asset-1', label: 'Renamed' }] } },
      { method: 'application.movePromptResourceAsset', params: { resourceId: 'resource-1', assetId: 'asset-1', targetAssetId: 'root', position: 'after' } },
      { method: 'application.deletePromptResourceAsset', params: { resourceId: 'resource-1', assetId: 'asset-1' } },
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
