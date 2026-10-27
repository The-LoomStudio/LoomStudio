import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { createStudioRpcRouter } from '../../support/trpc-caller.js'

const context = {
  clientId: 'test-client',
  correlationId: 'corr-test',
  callId: 'call-test',
}

describe('studio rpc router', () => {
  it.each<[string, JsonValue]>([
    ['createCard', { name: 'Card' }],
    ['updatePromptResourceAssets', { resourceId: 'resource-1', updates: [{ assetId: 'asset-1', label: 'Renamed' }] }],
    ['createNarrativeTimeline', { cardId: 'card-1' }],
    ['createAgentSession', { agentPresetId: 'profile-1' }],
    ['importCardBundle', { artifact: {
      schemaVersion: 4, artifactId: 'artifact-1', displayName: 'Artifact', card: { name: 'Card' }, contextAssets: [],
    } }],
    ['updateCardPromptResources', { cardId: 'card-1', promptResourceIds: ['resource-1'] }],
    ['replaceLoreMounts', { source: { kind: 'preset', id: 'preset-1' }, loreResourceIds: ['setting-1'] }],
    ['replacePresetToolMounts', { presetId: 'preset-1', mounts: [] }],
  ])('passes rpc context into %s', async (method, input) => {
    const mutate = vi.fn(async (_input: unknown, _context: unknown) => ({}))
    const applicationRuntime = { [method]: mutate } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })
    await router.call(`application.${method}`, input, context)
    expect(mutate).toHaveBeenCalledExactlyOnceWith(expect.anything(), context)
  })

  it('emits Card lifecycle facts after deletion commits', async () => {
    const emitted: Array<{ name: string; payload: JsonValue; context: unknown }> = []
    const applicationRuntime = {
      previewCardDeletion: async () => ({
        cardId: 'card-1',
        timelines: [{ id: 'timeline-1' }],
        extensionData: {
          cardScoped: { configs: 1, records: 2 },
          timelineScoped: { configs: 3, records: 4 },
        },
        textTransformRuleIds: [],
      }),
      deleteCard: async () => ({ deleted: true, mutation: { changesetId: 'chg-delete' } }),
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
      emitEvent: (name, payload, eventContext) => emitted.push({ name, payload, context: eventContext }),
    })

    await router.call('application.deleteCard', { cardId: 'card-1', includePlayData: true }, context)

    expect(emitted).toEqual([{
      name: 'entity.lifecycle.changed',
      payload: {
        operation: 'tombstoned',
        root: { kind: 'card', id: 'card-1' },
        affected: { timelines: 1, extensionConfigs: 4, extensionRecords: 6 },
        changesetId: 'chg-delete',
      },
      context,
    }])
  })

  it('emits one lifecycle event per Card after a batch deletion commit', async () => {
    const emitted: Array<{ name: string; payload: JsonValue; context: unknown }> = []
    const applicationRuntime = {
      previewCardDeletion: async ({ cardId }: { cardId: string }) => ({
        cardId,
        timelines: [],
        extensionData: {
          cardScoped: { configs: 0, records: 0 },
          timelineScoped: { configs: 0, records: 0 },
        },
        textTransformRuleIds: [],
      }),
      deleteCards: async ({ cardIds }: { cardIds: string[] }) => ({
        cardIds,
        deleted: true,
        mutation: { changesetId: 'chg-batch-delete' },
      }),
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
      emitEvent: (name, payload, eventContext) => emitted.push({ name, payload, context: eventContext }),
    })

    await router.call('application.deleteCards', { cardIds: ['card-1', 'card-2'] }, context)

    expect(emitted.map(event => event.payload)).toEqual([
      expect.objectContaining({ root: { kind: 'card', id: 'card-1' }, changesetId: 'chg-batch-delete' }),
      expect.objectContaining({ root: { kind: 'card', id: 'card-2' }, changesetId: 'chg-batch-delete' }),
    ])
  })

  it('parses editable Agent Tool entries without changing their stable id', async () => {
    let receivedInput: unknown
    const applicationRuntime = {
      updateAgentTool: async (input: unknown) => {
        receivedInput = input
        return { tool: { id: 'official/test_content', version: 2 } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })
    const definition = {
      id: 'official/test_content',
      owner: { namespace: 'official' },
      name: 'write_content',
      description: 'Write raw content for {{User}}.',
      input: {
        kind: 'hybrid',
        metadataSchema: { type: 'object' },
        rawField: 'content',
        mediaType: 'text/plain',
      },
      prompt: {
        provider: { order: 20 },
        content: {
          zone: 'tools',
          slot: 'official-tools',
          rankKey: '10',
          orderHint: 20,
        },
      },
    }

    await router.call('application.updateAgentTool', {
      toolId: definition.id,
      expectedVersion: 1,
      definition,
    }, context)

    expect(receivedInput).toEqual({
      toolId: definition.id,
      expectedVersion: 1,
      definition,
    })
  })

  it('parses Preset Tool mounts as relation data instead of Tool definitions', async () => {
    let receivedInput: unknown
    const applicationRuntime = {
      replacePresetToolMounts: async (input: unknown) => {
        receivedInput = input
        return { mounts: [], mutation: { changesetId: 'chg-tool-mount' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })

    await router.call('application.replacePresetToolMounts', {
      presetId: 'preset-1',
      mounts: [{
        toolId: 'official/test_content',
        orderIndex: 0,
        defaultEnabled: true,
        activation: { kind: 'keyword', keywords: ['write'] },
        provider: { order: 10 },
        content: { targetAnchorId: 'tools', localDepth: 2 },
      }],
    }, context)

    expect(receivedInput).toEqual({
      presetId: 'preset-1',
      mounts: [{
        toolId: 'official/test_content',
        orderIndex: 0,
        defaultEnabled: true,
        activation: { kind: 'keyword', keywords: ['write'] },
        provider: { order: 10 },
        content: { targetAnchorId: 'tools', localDepth: 2 },
      }],
    })
  })

  it('parses the optional Narrative target for Agent turns', async () => {
    let receivedInput: unknown
    let receivedContext: unknown
    const applicationRuntime = {
      invokeAgentTurn: async (input: unknown, requestContext?: unknown) => {
        receivedInput = input
        receivedContext = requestContext
        return { runId: 'run-1', mutation: { changesetId: 'chg-1' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })

    await router.call('application.invokeAgentTurn', {
      agentSessionId: 'agent-session-1',
      input: 'Continue.',
      narrativeTarget: {
        timelineId: 'timeline-1',
        branchId: 'branch-1',
        inputNodeId: 'user-node-1',
      },
    }, context)

    expect(receivedInput).toEqual({
      agentSessionId: 'agent-session-1',
      input: 'Continue.',
      narrativeTarget: {
        timelineId: 'timeline-1',
        branchId: 'branch-1',
        inputNodeId: 'user-node-1',
      },
    })
    expect(receivedContext).toEqual(context)
  })

  it('parses portable Extension Payload mutations and preserves rpc context', async () => {
    const received: Array<{ method: string; input: unknown; requestContext: unknown }> = []
    const applicationRuntime = {
      createPortableExtensionPayload: async (input: unknown, requestContext?: unknown) => {
        received.push({ method: 'create', input, requestContext })
        return { payload: { id: 'payload-1' }, mutation: { changesetId: 'chg-1' } }
      },
      updatePortableExtensionPayload: async (input: unknown, requestContext?: unknown) => {
        received.push({ method: 'update', input, requestContext })
        return { payload: { id: 'payload-1' }, mutation: { changesetId: 'chg-2' } }
      },
      replaceCardPortableExtensionPayloads: async (input: unknown, requestContext?: unknown) => {
        received.push({ method: 'bind', input, requestContext })
        return { card: { id: 'card-1' }, mutation: { changesetId: 'chg-3' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })
    const payload = {
      packageId: 'example.renderer',
      fileName: 'theme.json',
      format: 'example.theme',
      mediaType: 'application/json',
      schemaVersion: 1,
      content: '{"accent":"violet"}',
    }

    await router.call('application.createPortableExtensionPayload', {
      artifactPayloadId: 'theme-default',
      payload,
    }, context)
    await router.call('application.updatePortableExtensionPayload', {
      payloadId: 'payload-1',
      expectedVersion: 1,
      payload,
    }, context)
    await router.call('application.replaceCardPortableExtensionPayloads', {
      cardId: 'card-1',
      expectedVersion: 2,
      payloadIds: ['payload-1'],
    }, context)

    expect(received).toEqual([
      {
        method: 'create',
        input: { artifactPayloadId: 'theme-default', payload },
        requestContext: context,
      },
      {
        method: 'update',
        input: { payloadId: 'payload-1', expectedVersion: 1, payload },
        requestContext: context,
      },
      {
        method: 'bind',
        input: { cardId: 'card-1', expectedVersion: 2, payloadIds: ['payload-1'] },
        requestContext: context,
      },
    ])
  })

  it.each<JsonObject>([
    { mounts: [{ id: 'missing-mount' }, { loreResourceId: 'new-setting' }] },
    { loreResourceIds: ['lore'] },
    { mounts: [] },
  ])('passes supported Setting Mount lists to the runtime: %j', async list => {
    const replaceLoreMounts = vi.fn(async () => ({ mounts: [] }))
    const applicationRuntime = { replaceLoreMounts } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })
    const input = { source: { kind: 'preset', id: 'preset-1' }, ...list }
    await router.call('application.replaceLoreMounts', input, context)
    expect(replaceLoreMounts).toHaveBeenCalledExactlyOnceWith(input, context)
  })

  it.each<JsonObject>([
    { source: { kind: 'manual', id: 'workspace' }, loreResourceIds: [] },
    { source: { kind: 'preset' }, loreResourceIds: [] },
    { source: { kind: 'preset', id: 'preset-1' } },
    { source: { kind: 'preset', id: 'preset-1' }, mounts: [], loreResourceIds: [] },
    { source: { kind: 'preset', id: 'preset-1' }, mounts: [{ id: 1 }] },
  ])('rejects invalid Setting Mount input before invoking the runtime: %j', async input => {
    const replaceLoreMounts = vi.fn()
    const applicationRuntime = { replaceLoreMounts } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })
    await expect(router.call('application.replaceLoreMounts', input, context)).rejects.toThrow()
    expect(replaceLoreMounts).not.toHaveBeenCalled()
  })
})

function createKernelCaller(): Pick<import('@loom-studio/kernel').Kernel, 'callRpc'> {
  return { async callRpc<T>(method: string, params?: JsonValue, callContext?: Partial<typeof context>) {
    return { method, params: params ?? null, callId: callContext?.callId } as T
  } }
}
