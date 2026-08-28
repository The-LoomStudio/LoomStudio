import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

describe('Studio Server Extension data capabilities', () => {
  it('connects Package-owned Payload and scoped storage capabilities to Application Runtime', async () => {
    await withStudioServer(async (port, root) => {
      const sourceDirectory = await writeExtensionPackage(root)
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await callRpc(port, 'extensions.enableModule', {
        packageId: 'example.data-capabilities',
        moduleId: 'server',
        grants: { assets: ['assets.publish'] },
      })

      const createdCard = await callRpc<{ card: { id: string; version: number } }>(port, 'application.createCard', {
        name: 'Extension Data Card',
        opening: { entries: [{ content: 'The story begins.' }] },
      })
      const otherPayload = await callRpc<{ payload: { id: string } }>(port, 'application.createPortableExtensionPayload', {
        artifactPayloadId: 'other-default',
        payload: {
          packageId: 'other.package',
          fileName: 'other.json',
          format: 'other.config',
          mediaType: 'application/json',
          content: '{}',
        },
      })
      const otherBound = await callRpc<{ card: { version: number } }>(port, 'application.replaceCardPortableExtensionPayloads', {
        cardId: createdCard.card.id,
        expectedVersion: createdCard.card.version,
        payloadIds: [otherPayload.payload.id],
      })

      const ownPayload = await callRpc<{ id: string; packageId: string }>(port, 'example.data-capabilities.publish', {})
      await expect(callRpc<Array<{ id: string; packageId: string }>>(
        port,
        'example.data-capabilities.listPayloads',
        {},
      )).resolves.toEqual([
        expect.objectContaining({ id: ownPayload.id, packageId: 'example.data-capabilities' }),
      ])
      await expect(callRpc(port, 'example.data-capabilities.readPayload', {
        payloadId: otherPayload.payload.id,
      })).rejects.toThrow('owned by another package')
      await callRpc(port, 'example.data-capabilities.bind', {
        cardId: createdCard.card.id,
        expectedVersion: otherBound.card.version,
      })

      await expect(callRpc<{ payloads: Array<{ id: string; packageId: string }> }>(
        port,
        'application.listPortableExtensionPayloads',
        {},
      )).resolves.toMatchObject({
        payloads: expect.arrayContaining([
          expect.objectContaining({ id: otherPayload.payload.id, packageId: 'other.package' }),
          expect.objectContaining({ id: ownPayload.id, packageId: 'example.data-capabilities' }),
        ]),
      })
      const boundCard = await callRpc<{ card: { version: number; portableExtensionPayloadIds: string[] } }>(
        port,
        'application.getCard',
        { cardId: createdCard.card.id },
      )
      expect(boundCard).toMatchObject({
        card: { portableExtensionPayloadIds: [otherPayload.payload.id, ownPayload.id] },
      })
      await expect(callRpc<{ artifact: { extensionPayloads: Array<{ packageId: string }> } }>(
        port,
        'application.exportCardBundle',
        { cardId: createdCard.card.id },
      )).resolves.toMatchObject({
        artifact: {
          extensionPayloads: [
            { packageId: 'other.package' },
            { packageId: 'example.data-capabilities' },
          ],
        },
      })
      await callRpc(port, 'example.data-capabilities.clearBindings', {
        cardId: createdCard.card.id,
        expectedVersion: boundCard.card.version,
      })
      await expect(callRpc<{ card: { portableExtensionPayloadIds: string[] } }>(
        port,
        'application.getCard',
        { cardId: createdCard.card.id },
      )).resolves.toMatchObject({
        card: { portableExtensionPayloadIds: [otherPayload.payload.id] },
      })

      const timeline = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', {
        cardId: createdCard.card.id,
      })
      const narrative = await callRpc<{ nodes: Array<{ id: string }> }>(port, 'application.getNarrativePage', {
        timelineId: timeline.timeline.id,
      })
      const media = await callRpc<{ assetId: string }>(port, 'example.data-capabilities.publishAsset', {})
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Extension Data Test Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      })
      const preset = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', {
        resourceKind: 'preset',
        name: 'Extension Data Test Preset',
      })
      const profile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Extension Data Test Agent',
        presetId: preset.resource.id,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      })
      const agentSession = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentProfileId: profile.agentProfile.id,
      })
      const turn = await callRpc<{ entries: { user: { id: string } } }>(port, 'application.invokeAgentTurn', {
        agentSessionId: agentSession.session.id,
        input: 'Record this turn.',
      })
      await expect(callRpc(port, 'example.data-capabilities.saveRecord', {
        timelineId: timeline.timeline.id,
        nodeId: 'missing-node',
        agentSessionId: agentSession.session.id,
        messageId: turn.entries.user.id,
        assetId: media.assetId,
      })).rejects.toThrow('Narrative Node not found')
      const record = await callRpc<{ bindings: Array<{ kind: string }> }>(port, 'example.data-capabilities.saveRecord', {
        timelineId: timeline.timeline.id,
        nodeId: narrative.nodes[0]!.id,
        agentSessionId: agentSession.session.id,
        messageId: turn.entries.user.id,
        assetId: media.assetId,
      })
      expect(record.bindings.map(binding => binding.kind)).toEqual([
        'narrative-node',
        'agent-message',
        'asset',
        'state-path',
      ])
      await callRpc(port, 'example.data-capabilities.saveTimelineConfig', {
        timelineId: timeline.timeline.id,
        value: { style: 'watercolor' },
      })
      await expect(callRpc<Array<{ scope: { kind: string; timelineId: string }; value: unknown }>>(
        port,
        'example.data-capabilities.listConfigs',
        {},
      )).resolves.toEqual([
        expect.objectContaining({
          scope: { kind: 'timeline', timelineId: timeline.timeline.id },
          value: { style: 'watercolor' },
        }),
      ])

      await callRpc(port, 'application.deleteNarrativeTimeline', { timelineId: timeline.timeline.id })
      await expect(callRpc(port, 'example.data-capabilities.listConfigs', {})).resolves.toEqual([])
      await expect(callRpc(port, 'example.data-capabilities.listRecords', {})).resolves.toEqual([])
      expect((await authenticatedFetch(port, `/assets/${media.assetId}`)).status).toBe(200)
    })
  })
})

async function writeExtensionPackage(root: string): Promise<string> {
  const directory = join(root, 'extension-data-capabilities')
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: 'example.data-capabilities',
    version: '1.0.0',
    displayName: 'Extension Data Capabilities',
    engines: { studio: '^0.1.0' },
    modules: [{
      id: 'server',
      runtime: 'server',
      entry: './dist/index.js',
      capabilities: { 'assets.publish': true },
      contributes: {
        rpc: [
          { name: 'example.data-capabilities.publish' },
          { name: 'example.data-capabilities.listPayloads' },
          { name: 'example.data-capabilities.readPayload' },
          { name: 'example.data-capabilities.bind' },
          { name: 'example.data-capabilities.clearBindings' },
          { name: 'example.data-capabilities.saveTimelineConfig' },
          { name: 'example.data-capabilities.listConfigs' },
          { name: 'example.data-capabilities.publishAsset' },
          { name: 'example.data-capabilities.saveRecord' },
          { name: 'example.data-capabilities.listRecords' },
        ],
      },
    }],
  }))
  await writeFile(join(directory, 'dist/index.js'), `
let payloadId
export function activate(ctx) {
  ctx.rpc.register('example.data-capabilities.publish', async () => {
    const payload = await ctx.portablePayloads.publish({
      artifactPayloadId: 'style-default',
      payload: {
        fileName: 'style.json',
        format: 'example.style',
        mediaType: 'application/json',
        content: '{"style":"watercolor"}',
      },
    })
    payloadId = payload.id
    return payload
  })
  ctx.rpc.register('example.data-capabilities.listPayloads', () => ctx.portablePayloads.listOwn())
  ctx.rpc.register('example.data-capabilities.readPayload', params => ctx.portablePayloads.readOwn(params.payloadId))
  ctx.rpc.register('example.data-capabilities.bind', params => ctx.portablePayloads.replaceOwnCardBindings({
    cardId: params.cardId,
    expectedVersion: params.expectedVersion,
    payloadIds: [payloadId],
  }))
  ctx.rpc.register('example.data-capabilities.clearBindings', params => ctx.portablePayloads.replaceOwnCardBindings({
    cardId: params.cardId,
    expectedVersion: params.expectedVersion,
    payloadIds: [],
  }))
  ctx.rpc.register('example.data-capabilities.saveTimelineConfig', params => ctx.storage.configs.upsert({
    scope: { kind: 'timeline', timelineId: params.timelineId },
    key: 'image-style',
    value: params.value,
  }))
  ctx.rpc.register('example.data-capabilities.listConfigs', () => ctx.storage.configs.list())
  ctx.rpc.register('example.data-capabilities.publishAsset', async () => {
    const asset = await ctx.assets.publish({
      bytes: new Uint8Array([1, 2, 3]),
      kind: 'generated.image',
      mediaType: 'image/png',
    })
    return { assetId: asset.id }
  })
  ctx.rpc.register('example.data-capabilities.saveRecord', params => ctx.storage.records.create({
    scope: { kind: 'timeline', timelineId: params.timelineId },
    recordType: 'memory',
    data: { summary: 'Bound record' },
    bindings: [
      { kind: 'narrative-node', timelineId: params.timelineId, nodeId: params.nodeId },
      { kind: 'agent-message', agentSessionId: params.agentSessionId, messageId: params.messageId },
      { kind: 'asset', assetId: params.assetId },
      { kind: 'state-path', timelineId: params.timelineId, path: 'characters.alice' },
    ],
  }))
  ctx.rpc.register('example.data-capabilities.listRecords', () => ctx.storage.records.list())
}
`)
  return directory
}
