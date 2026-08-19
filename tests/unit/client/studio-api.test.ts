import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { withClientBridgeLogging } from '../../../apps/studio-client/src/shared/api/client-bridge-logging.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('studio client typed api', () => {
  it('maps global network settings through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'settings.network.get': { proxyMode: 'system', systemProxyDetected: true },
      'settings.network.update': { proxyMode: 'manual', proxyUrl: 'http://127.0.0.1:7890', systemProxyDetected: true },
    }))

    await expect(api.settings.getNetwork()).resolves.toEqual({ proxyMode: 'system', systemProxyDetected: true })
    await expect(api.settings.updateNetwork({ proxyMode: 'manual', proxyUrl: 'http://127.0.0.1:7890' })).resolves.toEqual({
      proxyMode: 'manual',
      proxyUrl: 'http://127.0.0.1:7890',
      systemProxyDetected: true,
    })
    expect(calls).toEqual([
      { method: 'settings.network.get', params: {} },
      { method: 'settings.network.update', params: { proxyMode: 'manual', proxyUrl: 'http://127.0.0.1:7890' } },
    ])
  })

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
      'application.listProviderModels': { modelIds: ['model-1', 'model-2'] },
      'application.pingProviderModel': { text: 'pong' },
    }))

    const reverted = await api.history.revert('change-1')
    await api.importBundles.get('import-bundle-1')
    await api.cards.list()
    await api.cards.update({ cardId: 'card-1', name: 'Renamed' })
    await api.cards.updatePromptResources({ cardId: 'card-1', promptResourceIds: ['resource-1'] })
    await api.cards.delete('card-1')
    await api.cards.export('card-1')
    const models = await api.providerModels.list('provider-1')
    const text = await api.providerModels.ping('provider-1', 'model-1')

    expect(models).toEqual(['model-1', 'model-2'])
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
      { method: 'application.listProviderModels', params: { providerProfileId: 'provider-1' } },
      { method: 'application.pingProviderModel', params: { providerProfileId: 'provider-1', modelId: 'model-1' } },
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

  it('maps narrative and agent calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {}))

    await api.cards.get('card-1')
    await api.narratives.list({ createdFromCardId: 'card-1', limit: 25 })
    await api.narratives.get('timeline-1')
    await api.narratives.getPage({ timelineId: 'timeline-1', branchId: 'branch-1' })
    await api.narratives.createFromCard({ cardId: 'card-1' })
    await api.narratives.fork({ timelineId: 'timeline-1', fromBranchId: 'branch-1', fromNodeId: 'node-1' })
    await api.narratives.switch({ timelineId: 'timeline-1', branchId: 'branch-2' })
    await api.agentProfiles.list()
    await api.agentSessions.create({ agentProfileId: 'profile-1' })
    await api.agentSessions.invoke({ agentSessionId: 'agent-session-1', input: 'continue' })
    await api.agentSessions.preview({ agentSessionId: 'agent-session-1', input: 'preview' })

    expect(calls).toEqual([
      { method: 'application.getCard', params: { cardId: 'card-1' } },
      { method: 'application.listNarrativeTimelines', params: { createdFromCardId: 'card-1', limit: 25 } },
      { method: 'application.getNarrativeTimeline', params: { timelineId: 'timeline-1' } },
      { method: 'application.getNarrativePage', params: { timelineId: 'timeline-1', branchId: 'branch-1' } },
      { method: 'application.createNarrativeTimelineFromCard', params: { cardId: 'card-1' } },
      { method: 'application.forkNarrativeBranch', params: { timelineId: 'timeline-1', fromBranchId: 'branch-1', fromNodeId: 'node-1' } },
      { method: 'application.switchNarrativeBranch', params: { timelineId: 'timeline-1', branchId: 'branch-2' } },
      { method: 'application.listAgentProfiles', params: {} },
      { method: 'application.createAgentSession', params: { agentProfileId: 'profile-1' } },
      { method: 'application.invokeAgentTurn', params: { agentSessionId: 'agent-session-1', input: 'continue' } },
      { method: 'application.previewAgentTurn', params: { agentSessionId: 'agent-session-1', input: 'preview' } },
    ])
  })

  it('maps prompt resource calls through the typed studio api surface', async () => {
    const calls: Array<{ method: string; params?: ClientJsonValue }> = []
    const api = createStudioApi(fakeBridge(calls, {
      'application.getPromptResource': { resource: { id: 'resource-1' } },
      'application.listPromptResources': { resources: [{ id: 'resource-1' }] },
      'application.createPromptResource': { resource: { id: 'resource-2' } },
      'application.duplicatePromptResource': { resource: { id: 'resource-3' } },
      'application.deletePromptResource': { deleted: true },
      'application.importPromptResource': { resource: { id: 'resource-4' } },
      'application.exportPromptResource': { artifact: { format: 'loom.promptResource', schemaVersion: 1 } },
      'application.listCardPromptResources': { resources: [{ id: 'resource-1' }] },
      'application.createPromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.updatePromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.updatePromptResourceAssets': { resource: { id: 'resource-1' } },
      'application.movePromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.deletePromptResourceAsset': { resource: { id: 'resource-1' } },
      'application.listSettingMounts': { mounts: [] },
      'application.replaceSettingMounts': { mounts: [{ id: 'mount-1' }], mutation: { changesetId: 'changeset-1' } },
    }))

    await api.promptResources.get('resource-1')
    await api.promptResources.list('preset')
    await api.promptResources.create({ resourceKind: 'preset', name: 'Preset' })
    await api.promptResources.duplicate({ resourceId: 'resource-1' })
    await api.promptResources.delete('resource-1')
    await api.promptResources.import({
      format: 'loom.promptResource',
      schemaVersion: 1,
      resourceKind: 'preset',
      rootNode: { id: 'root', label: 'Preset', kind: 'module' },
    })
    await api.promptResources.export('resource-1')
    await api.promptResources.listForCard('card-1')
    await api.promptResources.createAsset({ resourceId: 'resource-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1' } })
    await api.promptResources.updateAsset({ resourceId: 'resource-1', assetId: 'asset-1', body: 'updated' })
    await api.promptResources.updateAssets({ resourceId: 'resource-1', updates: [{ assetId: 'asset-1', label: 'Renamed' }] })
    await api.promptResources.listSettingMounts({ kind: 'preset', id: 'resource-1' })
    await api.promptResources.replaceSettingMounts({ source: { kind: 'preset', id: 'resource-1' }, settingResourceIds: ['setting-1'] })
    await api.promptResources.moveAsset({ resourceId: 'resource-1', assetId: 'asset-1', targetAssetId: 'root', position: 'after' })
    await api.promptResources.deleteAsset({ resourceId: 'resource-1', assetId: 'asset-1' })

    expect(calls).toEqual([
      { method: 'application.getPromptResource', params: { resourceId: 'resource-1' } },
      { method: 'application.listPromptResources', params: { resourceKind: 'preset' } },
      { method: 'application.createPromptResource', params: { resourceKind: 'preset', name: 'Preset' } },
      { method: 'application.duplicatePromptResource', params: { resourceId: 'resource-1' } },
      { method: 'application.deletePromptResource', params: { resourceId: 'resource-1' } },
      { method: 'application.importPromptResource', params: { artifact: { format: 'loom.promptResource', schemaVersion: 1, resourceKind: 'preset', rootNode: { id: 'root', label: 'Preset', kind: 'module' } } } },
      { method: 'application.exportPromptResource', params: { resourceId: 'resource-1' } },
      { method: 'application.listCardPromptResources', params: { cardId: 'card-1' } },
      { method: 'application.createPromptResourceAsset', params: { resourceId: 'resource-1', targetAssetId: 'root', position: 'inside', asset: { id: 'asset-1' } } },
      { method: 'application.updatePromptResourceAsset', params: { resourceId: 'resource-1', assetId: 'asset-1', body: 'updated' } },
      { method: 'application.updatePromptResourceAssets', params: { resourceId: 'resource-1', updates: [{ assetId: 'asset-1', label: 'Renamed' }] } },
      { method: 'application.listSettingMounts', params: { source: { kind: 'preset', id: 'resource-1' } } },
      { method: 'application.replaceSettingMounts', params: { source: { kind: 'preset', id: 'resource-1' }, settingResourceIds: ['setting-1'] } },
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
