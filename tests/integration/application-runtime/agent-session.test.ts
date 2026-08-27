import { createAgentStore } from '@loom-studio/agent-store'
import { createAgentToolRegistry, createApplicationRuntime, promptSlotIds, promptZoneIds, type ToolDefinition, type ToolRuntimeRegistration } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime(agentTools = createAgentToolRegistry([])) {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ agents, agentTools, dataEngine: engine, documents, narratives, promptResources })
  return { engine, runtime }
}

async function createProfile(runtime: ReturnType<typeof createTestRuntime>['runtime'], instructions = 'Help the user.') {
  const provider = await runtime.createProviderProfile({
    providerExtensionId: 'official.fake',
    displayName: 'Test Provider',
    config: { baseUrl: 'https://example.test/v1' },
    enabledModelIds: ['test-model'],
  })
  const preset = await createPreset(runtime, 'Test Agent', instructions)
  const profile = (await runtime.createAgentProfile({
    name: 'Test Agent Profile',
    presetId: preset.id,
    model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
  })).agentProfile
  return { preset, profile }
}

async function createPreset(
  runtime: ReturnType<typeof createTestRuntime>['runtime'],
  name: string,
  instructions: string,
) {
  const created = await runtime.createPromptResource({ resourceKind: 'preset', name })
  return (await runtime.createPromptResourceAsset({
    resourceId: created.resource.id,
    targetAssetId: created.resource.rootNode.id,
    position: 'inside',
    asset: { id: `${created.resource.id}.instructions`, label: 'Agent Instructions', category: 'preset', kind: 'entry', body: instructions },
  })).resource
}

describe('application agent session lifecycle', () => {
  it('persists editable Agent Tool entries and reloads them into the registry', async () => {
    const tool: ToolDefinition = {
      id: 'official/read_context',
      owner: { namespace: 'official' },
      name: 'read_context',
      description: 'Read context for {{User}}.',
      input: { kind: 'structured', schema: { type: 'object' } },
      prompt: {
        provider: { order: 10 },
      },
    }
    let nextId = 0
    let nextTime = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId, now })
    const narratives = createNarrativeStore({ engine, createId, now })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const providerRequests: Array<{ tools?: unknown[] }> = []
    const registration: ToolRuntimeRegistration = {
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed' as const,
        content: [],
      }),
    }
    const firstRegistry = createAgentToolRegistry([tool], [registration])
    const firstRuntime = createApplicationRuntime({
      agents,
      agentTools: firstRegistry,
      dataEngine: engine,
      documents,
      gateway: {
        invokeChat: async input => {
          providerRequests.push({ tools: input.request.tools })
          return {
            provider: 'test',
            model: 'test-model',
            text: 'Done.',
            finishReason: 'stop',
            message: { role: 'assistant', content: 'Done.' },
          }
        },
      },
      narratives,
      promptResources,
    })
    await firstRuntime.initialize()

    const initial = (await firstRuntime.listAgentTools()).tools[0]!
    const definition: ToolDefinition = {
      ...tool,
      name: 'read_workspace_context',
      description: 'Read the active workspace for {{User}}.',
      prompt: {
        guidance: 'Return only relevant context.',
        provider: { order: 3 },
      },
    }
    const updated = await firstRuntime.updateAgentTool({
      toolId: tool.id,
      expectedVersion: initial.version,
      definition,
    })

    expect(updated.tool).toMatchObject({
      ...definition,
      version: initial.version + 1,
      createdAt: initial.createdAt,
    })
    expect(firstRegistry.resolve([tool.id]).tools).toEqual([definition])

    const provider = await firstRuntime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'Tool Provider',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: ['test-model'],
    })
    const preset = await createPreset(firstRuntime, 'Tool Prompt', 'Use available tools.')
    await firstRuntime.replacePresetToolMounts({
      presetId: preset.id,
      mounts: [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true, provider: { order: 3 } }],
    })
    const profile = await firstRuntime.createAgentProfile({
      name: 'Tool Agent',
      presetId: preset.id,
      model: {
        providerProfileId: provider.providerProfile.id,
        modelId: 'test-model',
      },
    })
    const session = await firstRuntime.createAgentSession({
      agentProfileId: profile.agentProfile.id,
    })
    const turn = await firstRuntime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: 'Read the workspace.',
    })
    expect(turn.toolPromptBuildTrace.orders).toEqual([
      expect.objectContaining({ toolId: tool.id, providerOrder: 3, projection: 'provider-tools' }),
    ])
    expect(providerRequests[0]?.tools).toEqual([
      expect.objectContaining({
        name: definition.name,
        description: expect.stringContaining('Read the active workspace for User.'),
      }),
    ])
    expect(providerRequests[0]?.tools?.[0]).toEqual(
      expect.objectContaining({
        description: expect.stringContaining('Return only relevant context.'),
      }),
    )

    const secondRegistry = createAgentToolRegistry([tool], [registration])
    const secondRuntime = createApplicationRuntime({
      agents,
      agentTools: secondRegistry,
      dataEngine: engine,
      documents,
      narratives,
      promptResources,
    })
    await secondRuntime.initialize()

    expect((await secondRuntime.listAgentTools()).tools).toEqual([updated.tool])
    expect(secondRegistry.resolve([tool.id]).tools).toEqual([definition])
    expect(await secondRuntime.listPresetToolMounts({ presetId: preset.id })).toEqual({
      mounts: [expect.objectContaining({
        presetResourceId: preset.id,
        toolId: tool.id,
        defaultEnabled: true,
        provider: { order: 3 },
      })],
    })
    engine.close()
  })

  it('stores Agent Profile tool selection and exposes registry analysis without executing tools', async () => {
    const tool: ToolDefinition = {
      id: 'official/read_context',
      owner: { namespace: 'official' },
      name: 'read_context',
      description: 'Read context.',
      input: {
        kind: 'hybrid',
        metadataSchema: { type: 'object' },
        rawField: 'content',
        mediaType: 'text/plain',
      },
    }
    const { engine, runtime } = createTestRuntime(createAgentToolRegistry([tool], [{
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [],
      }),
    }]))
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake', displayName: 'Fake', config: {}, enabledModelIds: ['test-model'],
    })
    const preset = await createPreset(runtime, 'Tool Agent', 'Use tools when available.')
    await runtime.replacePresetToolMounts({
      presetId: preset.id,
      mounts: [{
        toolId: tool.id,
        orderIndex: 0,
        defaultEnabled: false,
        activation: { kind: 'keyword', keywords: ['context'] },
        content: { zone: promptZoneIds.tools, slot: 'preset-tools', rankKey: '10', orderHint: 5 },
      }],
    })
    const profile = (await runtime.createAgentProfile({
      name: 'Tool Agent', presetId: preset.id,
      model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      toolOverrides: { [tool.id]: true },
    })).agentProfile

    expect(profile.toolOverrides).toEqual({ [tool.id]: true })
    expect((await runtime.listAgentTools()).tools).toEqual([
      expect.objectContaining(tool),
    ])
    expect((await runtime.analyzeAgentTools({ agentProfileId: profile.id })).analysis.exposures).toEqual([
      expect.objectContaining({
        toolId: tool.id,
        exposed: true,
        transport: 'content',
      }),
    ])
    const session = await runtime.createAgentSession({ agentProfileId: profile.id })
    const inactive = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Hello.' })
    const active = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Read context.' })
    expect(inactive.toolExposures).toEqual([])
    expect(active.toolExposures).toEqual([expect.objectContaining({ toolId: tool.id, transport: 'content' })])
    expect(active.projection.zones.find(zone => zone.zoneId === promptZoneIds.tools)?.slots).toEqual([
      expect.objectContaining({ slotKey: 'preset-tools' }),
    ])
    await expect(runtime.updateAgentProfile({ agentProfileId: profile.id, toolOverrides: { 'missing/tool': true } }))
      .rejects.toThrow('not registered')
    engine.close()
  })

  it('creates, appends internally, pages, and deletes an independent Agent Session', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime)
    const created = await runtime.createAgentSession({
      agentProfileId: profile.id,
      title: 'Guide',
    }, {
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    const appended = await runtime.appendAgentTranscriptEntries({
      agentSessionId: created.session.id,
      expectedEntryCount: 0,
      entries: [
        { runId: 'run-1', entry: { kind: 'message', role: 'user', content: 'Help me' } },
        { runId: 'run-1', entry: { kind: 'message', role: 'assistant', content: 'Ready' } },
      ],
    })
    const page = await runtime.getAgentTranscriptPage({ agentSessionId: created.session.id })
    const commit = engine.database.prepare('SELECT created_by_json, correlation_id, call_id FROM changesets WHERE id = ?')
      .get(created.mutation.changesetId)

    expect(await runtime.getAgentSession({ agentSessionId: created.session.id })).toMatchObject({
      session: { agentProfileId: profile.id, entryCount: 2 },
    })
    expect(appended.entries.map(entry => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'Help me' },
      { kind: 'message', role: 'assistant', content: 'Ready' },
    ])
    expect(page.entries).toHaveLength(2)
    expect(commit).toEqual({
      created_by_json: JSON.stringify({ kind: 'client', id: 'client-1' }),
      correlation_id: 'corr-1',
      call_id: 'call-1',
    })

    await expect(runtime.deleteAgentProfile({ agentProfileId: profile.id })).rejects.toThrow('still referenced')
    await runtime.deleteAgentSession({ agentSessionId: created.session.id })
    await expect(runtime.deleteAgentProfile({ agentProfileId: profile.id })).resolves.toEqual({ deleted: true })
    await expect(runtime.getAgentSession({ agentSessionId: created.session.id })).rejects.toThrow('Agent session not found')
    engine.close()
  })

  it('requires the shared Prompt Resource Store and Data Engine', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    expect(() => createApplicationRuntime({ documents: createInMemoryDocumentStore() })).toThrow('Prompt Resource Store is required')
  })

  it('runs an Agent-only turn without creating Narrative data', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime, 'Discuss without committing narrative.')
    const created = await runtime.createAgentSession({ agentProfileId: profile.id })
    const result = await runtime.invokeAgentTurn({
      agentSessionId: created.session.id,
      input: 'Discuss the next scene without writing it.',
    })

    expect(result.entries).toMatchObject({
      user: { entry: { kind: 'message', role: 'user', content: 'Discuss the next scene without writing it.' } },
      assistant: { entry: { kind: 'message', role: 'assistant', content: 'Agent draft: Discuss the next scene without writing it.' } },
    })
    expect(result.narrative).toBeUndefined()
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: created.session.id })).entries).toHaveLength(5)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('loads Settings linked by the selected Preset without a Narrative Timeline', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const preset = (await runtime.listPromptResources({ resourceKind: 'preset' })).resources
      .find(resource => resource.origin?.key === 'loom-assistant-preset')!
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Official Test Provider',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: ['test-model'],
    })
    const profile = await runtime.createAgentProfile({
      name: 'Official Assistant',
      presetId: preset.id,
      model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
    })
    const session = await runtime.createAgentSession({ agentProfileId: profile.agentProfile.id })
    const preview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'What is Loom Studio?' })

    expect(preview.messages.some(message => 'content' in message && message.content.includes('Loom Studio 是面向 AI 角色扮演'))).toBe(true)
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_timelines').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('uses the same Preset projection for preview and invocation', async () => {
    const calls: Array<{ messages: unknown[] }> = []
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-projection-${++nextAgentId}`, now: () => '2026-08-12T02:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-projection`, now: () => '2026-08-12T02:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      promptResources,
      gateway: {
        invokeChat: async input => {
          calls.push({ messages: input.request.messages })
          return {
            provider: 'fake',
            model: 'projection-model',
            message: { role: 'assistant', content: 'Done.' },
            text: 'Done.',
          }
        },
      },
    })
    const preset = await createPreset(runtime, 'Projection Agent', 'Follow the preset instructions for {{User}}.')
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Projection Provider',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: ['projection-model'],
    })
    const profile = await runtime.createAgentProfile({
      name: 'Projection Profile',
      presetId: preset.id,
      model: { providerProfileId: provider.providerProfile.id, modelId: 'projection-model' },
    })
    const session = await runtime.createAgentSession({ agentProfileId: profile.agentProfile.id })
    const preview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: 'Act.' })
    const result = await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'Act.' })

    expect(preview.messages).toEqual(calls[0]?.messages)
    expect(preview.messages).toEqual([
      { role: 'system', content: 'Follow the preset instructions for User.' },
      { role: 'user', content: 'Act.' },
    ])
    expect(result.projection).toEqual(preview.projection)
    engine.close()
  })

  it('includes persisted Agent Session history in the next provider request', async () => {
    const calls: Array<{ messages: unknown[] }> = []
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-history-${++nextAgentId}`, now: () => '2026-08-12T03:00:00.000Z' })
    const narratives = createNarrativeStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      narratives,
      promptResources,
      gateway: {
        invokeChat: async input => {
          calls.push({ messages: input.request.messages })
          const reply = calls.length === 1 ? 'First reply.' : 'Second reply.'
          return {
            provider: 'fake',
            model: 'history-model',
            message: { role: 'assistant', content: reply },
            text: reply,
          }
        },
      },
    })
    const { profile } = await createProfile(runtime, 'Keep the conversation context.')
    const session = await runtime.createAgentSession({ agentProfileId: profile.id })

    await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'First.' })
    const second = await runtime.invokeAgentTurn({ agentSessionId: session.session.id, input: 'Second.' })

    expect(calls[1]?.messages).toEqual([
      { role: 'system', content: 'Keep the conversation context.' },
      { role: 'user', content: 'First.' },
      { role: 'assistant', content: 'First reply.' },
      { role: 'user', content: 'Second.' },
    ])
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.session.id })).entries).toHaveLength(10)
    expect(second.projection.zones.find(zone => zone.zoneId === promptZoneIds.sessionHistory)?.slots[0]).toMatchObject({
      slotKey: promptSlotIds.sessionMain,
      fragments: [
        expect.objectContaining({ id: expect.any(String), content: 'First.' }),
        expect.objectContaining({ id: expect.any(String), content: 'First reply.' }),
      ],
    })
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 0 })
    engine.close()
  })

  it('commits the user input and final assistant output to an explicitly targeted Narrative branch', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Story', opening: 'Opening.' })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const { profile } = await createProfile(runtime, 'Continue the accepted narrative.')
    const agent = await runtime.createAgentSession({ agentProfileId: profile.id })
    const result = await runtime.invokeAgentTurn({
      agentSessionId: agent.session.id,
      input: 'Continue.',
      narrativeTarget: { timelineId: timeline.timeline.id, commit: true },
    })
    const commit = engine.database.prepare('SELECT operations_json FROM changesets WHERE id = ?')
      .get(result.mutation.changesetId) as { operations_json: string }

    expect(result.narrative).toMatchObject({
      nodes: [
        {
          body: { raw: 'Continue.' },
          source: {
            agentSessionId: agent.session.id,
            agentMessageId: result.entries.user.id,
            runId: result.runId,
            changesetId: result.mutation.changesetId,
          },
        },
        {
          body: { raw: 'Agent draft: Continue.' },
          source: {
            agentSessionId: agent.session.id,
            agentMessageId: result.entries.assistant.id,
            runId: result.runId,
            changesetId: result.mutation.changesetId,
          },
        },
      ],
      node: {
        body: { raw: 'Agent draft: Continue.' },
        source: {
          agentSessionId: agent.session.id,
          agentMessageId: result.entries.assistant.id,
          runId: result.runId,
          changesetId: result.mutation.changesetId,
        },
      },
    })
    expect(result.projection.zones.find(zone => zone.zoneId === promptZoneIds.narrativeHistory)?.slots[0]).toMatchObject({
      slotKey: promptSlotIds.narrativeMain,
      fragments: [expect.objectContaining({ content: 'Opening.' })],
    })
    expect(result.projection.messages).toEqual([
      { role: 'system', content: 'Continue the accepted narrative.' },
      { role: 'developer', content: 'Opening.' },
      { role: 'user', content: 'Continue.' },
    ])
    expect(JSON.parse(commit.operations_json).map((operation: { entityType: string }) => operation.entityType)).toEqual([
      'narrative.node',
      'narrative.branch',
      'narrative.timeline',
      'narrative.node',
      'narrative.branch',
      'narrative.timeline',
    ])
    engine.close()
  })

  it('persists a failed Run boundary when the provider fails', async () => {
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    let nextAgentId = 0
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-failure-${++nextAgentId}`, now: () => '2026-08-12T01:00:00.000Z' })
    const promptResources = createPromptResourceStore({ engine, createId: prefix => `${prefix}-failure`, now: () => '2026-08-12T01:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      promptResources,
      gateway: { invokeChat: async () => { throw new Error('provider failed') } },
    })
    const preset = await createPreset(runtime, 'Failure Agent', 'Fail safely.')
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Failure Provider',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: ['failure-model'],
    })
    const profile = await runtime.createAgentProfile({
      name: 'Failure Profile',
      presetId: preset.id,
      model: { providerProfileId: provider.providerProfile.id, modelId: 'failure-model' },
    })
    const session = await runtime.createAgentSession({ agentProfileId: profile.agentProfile.id })

    await expect(runtime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: 'Fail.',
    })).rejects.toThrow('provider failed')
    expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.session.id })).entries.map(entry => entry.entry)).toEqual([
      { kind: 'message', role: 'user', content: 'Fail.' },
      { kind: 'run-state', state: 'running' },
      { kind: 'run-state', state: 'failed', reason: 'provider failed' },
    ])
    engine.close()
  })
})
