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
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.createNarrativeTimeline',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).not.toContainEqual(expect.objectContaining({
      name: 'application.createNarrativeTimelineFromCard',
    }))
    expect(listed.capabilities).not.toContainEqual(expect.objectContaining({
      name: 'application.exportCardArtifact',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.createAgentSession',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.invokeAgentTurn',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.previewAgentTurn',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.updateAgentTool',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities).toContainEqual(expect.objectContaining({
      name: 'application.replacePresetToolMounts',
      namespace: 'application',
      owner: 'application',
      stability: 'experimental',
    }))
    expect(listed.capabilities.map(capability => capability.name)).not.toContain('application.appendAgentTranscriptEntrys')
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
        content: { zone: 'tools', slot: 'official-tools', rankKey: '10', orderHint: 20 },
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
        content: { zone: 'tools', slot: 'official-tools', rankKey: '10', orderHint: 20 },
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
        commit: true,
      },
    }, context)

    expect(receivedInput).toEqual({
      agentSessionId: 'agent-session-1',
      input: 'Continue.',
      narrativeTarget: {
        timelineId: 'timeline-1',
        branchId: 'branch-1',
        commit: true,
      },
    })
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

  it('passes rpc call context into narrative mutations', async () => {
    let receivedContext: unknown
    const applicationRuntime = {
      createNarrativeTimeline: async (_input: unknown, requestContext?: unknown) => {
        receivedContext = requestContext
        return {
          timeline: { id: 'timeline-1' },
          branch: { id: 'branch-1' },
          nodes: [],
          mutation: { changesetId: 'chg-1' },
        }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })

    await router.call('application.createNarrativeTimeline', { cardId: 'card-1' }, context)

    expect(receivedContext).toEqual(context)
  })

  it('passes rpc call context into Agent Session mutations', async () => {
    let receivedContext: unknown
    const applicationRuntime = {
      createAgentSession: async (_input: unknown, requestContext?: unknown) => {
        receivedContext = requestContext
        return { session: { id: 'agent-session-1' }, mutation: { changesetId: 'chg-agent-1' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })

    await router.call('application.createAgentSession', { agentProfileId: 'profile-1' }, context)

    expect(receivedContext).toEqual(context)
  })

  it('passes rpc call context into bundle and prompt resource mutations', async () => {
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
      replaceSettingMounts: async (_input: unknown, requestContext?: unknown) => {
        received.push(requestContext)
        return { mounts: [], mutation: { changesetId: 'chg-2' } }
      },
      replacePresetToolMounts: async (_input: unknown, requestContext?: unknown) => {
        received.push(requestContext)
        return { mounts: [], mutation: { changesetId: 'chg-3' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({
      applicationRuntime,
      kernel: createKernelCaller(),
    })

    await router.call('application.importCardBundle', {
      artifact: {
        schemaVersion: 2,
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
    await router.call('application.replaceSettingMounts', {
      source: { kind: 'preset', id: 'preset-1' },
      settingResourceIds: ['setting-1'],
    }, context)
    await router.call('application.replacePresetToolMounts', {
      presetId: 'preset-1',
      mounts: [],
    }, context)

    expect(received).toEqual([context, context, context, context])
  })

  it('rejects invalid Setting Mount sources before invoking the runtime', async () => {
    let invoked = false
    const applicationRuntime = {
      replaceSettingMounts: async () => {
        invoked = true
        return { mounts: [], mutation: { changesetId: 'chg-1' } }
      },
    } as unknown as ApplicationRuntime
    const router = createStudioRpcRouter({ applicationRuntime, kernel: createKernelCaller() })

    await expect(router.call('application.replaceSettingMounts', {
      source: { kind: 'manual', id: 'workspace' },
      settingResourceIds: [],
    }, context)).rejects.toThrow('Expected Setting mount source param: source')
    await expect(router.call('application.replaceSettingMounts', {
      source: { kind: 'preset' },
      settingResourceIds: [],
    }, context)).rejects.toThrow('Expected Setting mount source param: source')
    expect(invoked).toBe(false)
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
