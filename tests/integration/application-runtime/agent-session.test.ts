import { createAgentStore } from '@loom-studio/agent-store'
import { createApplicationRuntime, promptSlotIds, promptZoneIds } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ agents, dataEngine: engine, documents, narratives })
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
    const appended = await runtime.appendAgentMessages({
      agentSessionId: created.session.id,
      expectedMessageCount: 0,
      messages: [
        { runId: 'run-1', message: { role: 'user', content: 'Help me' } },
        { runId: 'run-1', message: { role: 'assistant', content: 'Ready' } },
      ],
    })
    const page = await runtime.getAgentMessagePage({ agentSessionId: created.session.id })
    const commit = engine.database.prepare('SELECT created_by_json, correlation_id, call_id FROM changesets WHERE id = ?')
      .get(created.mutation.changesetId)

    expect(await runtime.getAgentSession({ agentSessionId: created.session.id })).toMatchObject({
      session: { agentProfileId: profile.id, messageCount: 2 },
    })
    expect(appended.messages.map(message => message.message)).toEqual([
      { role: 'user', content: 'Help me' },
      { role: 'assistant', content: 'Ready' },
    ])
    expect(page.messages).toHaveLength(2)
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

  it('keeps document-only Application Runtime consumers valid', async () => {
    const { createInMemoryDocumentStore } = await import('@loom-studio/document-store')
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })

    await expect(runtime.createCard({ name: 'Still works' })).resolves.toMatchObject({ card: { name: 'Still works' } })
    await expect(runtime.getAgentSession({ agentSessionId: 'agent-session-1' })).rejects.toThrow('Agent Store is not configured')
  })

  it('runs an Agent-only turn without creating Narrative data', async () => {
    const { engine, runtime } = createTestRuntime()
    const { profile } = await createProfile(runtime, 'Discuss without committing narrative.')
    const created = await runtime.createAgentSession({ agentProfileId: profile.id })
    const result = await runtime.invokeAgentTurn({
      agentSessionId: created.session.id,
      input: 'Discuss the next scene without writing it.',
    })

    expect(result.messages).toMatchObject({
      user: { message: { role: 'user', content: 'Discuss the next scene without writing it.' } },
      assistant: { message: { role: 'assistant', content: 'Agent draft: Discuss the next scene without writing it.' } },
    })
    expect(result.narrative).toBeUndefined()
    expect((await runtime.getAgentMessagePage({ agentSessionId: created.session.id })).messages).toHaveLength(2)
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
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-projection`, now: () => '2026-08-12T02:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
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
    const preset = await createPreset(runtime, 'Projection Agent', 'Follow the preset instructions.')
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
      { role: 'system', content: 'Follow the preset instructions.' },
      { role: 'user', content: 'Act.' },
    ])
    expect(result.projection).toEqual(preview.projection)
    engine.close()
  })

  it('includes persisted Agent Session history in the next provider request', async () => {
    const calls: Array<{ messages: unknown[] }> = []
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const narratives = createNarrativeStore({ engine, createId: prefix => `${prefix}-history`, now: () => '2026-08-12T03:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
      narratives,
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
    expect((await runtime.getAgentMessagePage({ agentSessionId: session.session.id })).messages).toHaveLength(4)
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

  it('commits Agent messages and an explicitly targeted Narrative node in one changeset', async () => {
    const { engine, runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Story', opening: 'Opening.' })
    const timeline = await runtime.createNarrativeTimelineFromCard({ cardId: card.card.id })
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
      node: {
        body: { raw: 'Agent draft: Continue.' },
        source: {
          agentSessionId: agent.session.id,
          agentMessageId: result.messages.assistant.id,
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
      'agent.message',
      'agent.message',
      'agent.session',
      'narrative.node',
      'narrative.branch',
      'narrative.timeline',
    ])
    engine.close()
  })

  it('does not persist a partial Agent turn when the provider fails', async () => {
    const { engine } = createTestRuntime()
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId: prefix => `${prefix}-failure`, now: () => '2026-08-12T01:00:00.000Z' })
    const runtime = createApplicationRuntime({
      agents,
      dataEngine: engine,
      documents,
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
    expect((await runtime.getAgentMessagePage({ agentSessionId: session.session.id })).messages).toEqual([])
    engine.close()
  })
})
