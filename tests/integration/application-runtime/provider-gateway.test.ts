import { getAgentRunService } from '../../../apps/studio-server/src/agents/agent-run-service.js'
import { runAgentTurn } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-run-observer.js'
import type { AgentTranscriptEntry } from '../../../apps/studio-client/src/entities/agent.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createAgentStore, createNarrativeStore, createStatisticsStore } from '@loom-studio/application-data'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { applicationDocumentTypes, createApplicationRuntime, createDocumentBackedAiGateway, createOpenAICompatibleGateway } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createMemorySecretBackend, createSecretStore } from '../../../packages/secret-store/src/index.js'
import { createPromptResourceStore } from '../../../packages/application-data/src/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('application runtime Provider Profile integration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('persists native chat usage independently of provider deletion and observations', async () => {
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({ id: 'metered-call', model: 'metered',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done' } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }), { headers: { 'content-type': 'application/json' } })) satisfies typeof fetch)
    const f = createRuntimeFixture()
    try {
      createNarrativeStore({ engine: f.engine })
      const stats = createStatisticsStore(f.engine, () => '2026-10-25T00:00:00.000Z')
      const gateway = createDocumentBackedAiGateway({ documents: f.documents, secrets: f.secrets, statistics: stats })
      const { providerProfile } = await f.runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible',
        displayName: 'Metered', config: { baseUrl: 'https://metered.test/v1' }, enabledModelIds: ['metered'], credential: { apiKey: 'test-only' } })
      await gateway.invokeChat({ model: { providerProfileId: providerProfile.id, modelId: 'metered' },
        request: { messages: [{ role: 'user', content: 'Hello' }] }, sessionId: 'direct-call', runId: 'run', branchId: 'direct' })
      await f.runtime.deleteProviderProfile({ providerProfileId: providerProfile.id })
      const result = await stats.usage({ to: '2026-10-26T00:00:00.000Z', timeZone: 'UTC' })
      expect(result.totals).toMatchObject({ requests: 1, total: 15, input: 12, output: 3 })
      expect(result.collectionErrors).toBe(0)
      expect(result.providers[0]?.name).toBe('Metered')
    } finally { f.close() }
  })

  it('delivers real SDK fullStream reasoning and text through the Run API into stable client records', async () => {
    const connected = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', (async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return new Response(new ReadableStream<Uint8Array>({ start: controller => connected.resolve(controller) }), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) satisfies typeof fetch)
    const f = createRuntimeFixture()
    const service = getAgentRunService(f.runtime)
    let runId: string | undefined
    let consuming: Promise<unknown> | undefined
    try {
      const { providerProfile } = await f.runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible',
        displayName: 'Local stream fixture', config: { baseUrl: 'https://stream.test/v1' },
        enabledModelIds: ['stream-model'], credential: { apiKey: 'test-only' } })
      const preset = await createPreset(f.runtime)
      await f.runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version, name: 'Stream',
        delivery: 'stream', model: { providerProfileId: providerProfile.id, modelId: 'stream-model' } })
      const { session } = await f.runtime.createAgentSession({ agentPresetId: preset.id })
      ;({ runId } = await service.create({ agentSessionId: session.id, input: 'Stream a reply' }))
      const api = { agentSessions: { subscribeRun: service.subscribe,
        getTranscript: (input: { agentSessionId: string }) => f.runtime.getAgentTranscriptPage(input),
      } } as unknown as StudioApi
      let entries: AgentTranscriptEntry[] = []
      consuming = runAgentTurn({ api, runId, sessionId: session.id, selection: 0, target: 'agent',
        streamingId: 'streaming-agent-entry-probe', cursor: 0, status: 'running', observing: true },
      () => true, update => { entries = update(entries) }, () => {}, () => {})
      const controller = await connected.promise
      const encoder = new TextEncoder()
      const send = (delta: Record<string, unknown>, finish: string | null = null) => controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ id: 'stream-call', object: 'chat.completion.chunk', model: 'stream-model',
          choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`))
      send({ role: 'assistant', reasoning_content: 'Inspect the scene.' })
      await vi.waitFor(() => expect(entries.some(item => item.entry.kind === 'reasoning' && item.entry.content === 'Inspect the scene.')).toBe(true))
      const thoughtKey = entries.find(item => item.entry.kind === 'reasoning')!.presentationId
      send({ content: 'The door opens.' })
      await vi.waitFor(() => expect(entries.find(item => item.entry.kind === 'message' && item.entry.role === 'assistant')?.entry)
        .toMatchObject({ content: 'The door opens.', state: 'partial' }))
      expect(entries.find(item => item.entry.kind === 'reasoning')?.entry).toHaveProperty('state', 'completed')
      const textKey = entries.find(item => item.entry.kind === 'message' && item.entry.role === 'assistant')!.presentationId
      expect(thoughtKey).toBeDefined(); expect(textKey).toBeDefined()
      expect(entries.findIndex(item => item.entry.kind === 'reasoning')).toBeLessThan(entries.findIndex(item => item.entry.kind === 'message' && item.entry.role === 'assistant'))
      send({}, 'stop'); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close()
      await consuming
      expect(requests).toEqual([expect.objectContaining({ model: 'stream-model', stream: true })])
      expect(entries.find(item => item.entry.kind === 'reasoning')?.presentationId).toBe(thoughtKey)
      expect(entries.find(item => item.entry.kind === 'message' && item.entry.content === 'The door opens.')?.presentationId).toBe(textKey)
      expect(entries.some(item => item.id.startsWith('streaming-reasoning-'))).toBe(false)
    } finally {
      if (runId) { service.cancel(runId); service.acknowledgeCompletion(runId) }
      await consuming?.catch(() => {})
      f.close()
    }
  })

  it('stores per-model multipliers outside connection config and rejects stale or invalid updates', async () => {
    const fixture = createRuntimeFixture()
    try {
      const { providerProfile } = await fixture.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Estimate',
        config: {}, enabledModelIds: ['a', 'b'],
      })
      const input = { providerProfileId: providerProfile.id, expectedVersion: providerProfile.version, tokenMultipliers: { a: 0.6 } }
      const { providerProfile: updated } = await fixture.runtime.updateProviderProfile(input)
      expect(updated.tokenMultipliers).toEqual({ a: 0.6 })
      expect(updated.config).toEqual({})
      expect((await fixture.documents.get(providerProfile.id))?.content).toMatchObject({ tokenMultipliers: { a: 0.6 } })
      await expect(fixture.runtime.updateProviderProfile(input)).rejects.toThrow()
      await expect(fixture.runtime.updateProviderProfile({ ...input, expectedVersion: updated.version, tokenMultipliers: { a: 0 } })).rejects.toThrow('positive')
      await expect(fixture.runtime.updateProviderProfile({ providerProfileId: providerProfile.id, expectedVersion: undefined as unknown as number, tokenMultipliers: { b: 1 } })).rejects.toThrow('expectedVersion')
      expect((await fixture.runtime.getProviderProfile({ providerProfileId: providerProfile.id })).providerProfile.tokenMultipliers).toEqual({ a: 0.6 })
    } finally { fixture.close() }
  })

  it('rejects stale model snapshots and preserves a failed connection save', async () => {
    const f = createRuntimeFixture()
    try {
      const { providerProfile: original } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Old',
        config: { baseUrl: 'https://old.test/v1' }, enabledModelIds: ['a'], credential: { apiKey: 'old-key' },
      })
      const { providerProfile: added } = await f.runtime.updateProviderProfile({
        providerProfileId: original.id, expectedVersion: original.version, enabledModelIds: ['a', 'b'],
      })
      await expect(f.runtime.updateProviderProfile({
        providerProfileId: original.id, expectedVersion: original.version, enabledModelIds: [],
      })).rejects.toThrow()
      const oldDocument = await f.documents.get(original.id)
      const remove = vi.spyOn(f.secrets, 'delete')
      const write = vi.spyOn(f.documents, 'write').mockRejectedValueOnce(new Error('Profile write failed'))
      await expect(f.runtime.updateProviderProfile({
        providerProfileId: original.id, expectedVersion: added.version, displayName: 'New',
        config: { baseUrl: 'https://new.test/v1' }, credential: { apiKey: 'new-key' },
      })).rejects.toThrow('Profile write failed')
      write.mockRestore()
      expect(await f.documents.get(original.id)).toEqual(oldDocument)
      expect(remove).toHaveBeenCalledOnce()
      const createSecret = vi.spyOn(f.secrets, 'create').mockRejectedValueOnce(new Error('Secret write failed'))
      await expect(f.runtime.updateProviderProfile({
        providerProfileId: original.id, expectedVersion: added.version,
        config: { baseUrl: 'https://new.test/v1' }, credential: { apiKey: 'new-key' },
      })).rejects.toThrow('Secret write failed')
      createSecret.mockRestore()
      expect(await f.documents.get(original.id)).toEqual(oldDocument)
      remove.mockRejectedValueOnce(new Error('Cleanup failed'))
      const { providerProfile: saved, credentialCleanupFailed } = await f.runtime.updateProviderProfile({
        providerProfileId: original.id, expectedVersion: added.version, displayName: 'New',
        config: { baseUrl: 'https://new.test/v1' }, credential: { apiKey: 'new-key' },
      })
      expect(credentialCleanupFailed).toBe(true)
      expect(saved).toMatchObject({ displayName: 'New', enabledModelIds: ['a', 'b'], credential: { configured: true } })
      expect(JSON.stringify(saved)).not.toContain('new-key')
      const committed = await f.documents.get(original.id)
      await f.runtime.updateProviderProfile({ providerProfileId: original.id, expectedVersion: saved.version, displayName: 'Renamed' })
      expect((await f.documents.get(original.id))?.content).toMatchObject({ secretRef: (committed?.content as { secretRef: string }).secretRef })
    } finally { f.close() }
  })

  it('stores enabled models in the Provider Profile and exposes only credential status', async () => {
    const fixture = createRuntimeFixture()
    const created = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'Primary',
      config: { baseUrl: 'https://example.test/v1' },
      enabledModelIds: ['model-a', 'model-a', ' model-b '],
      credential: { apiKey: 'secret-value' },
    })

    expect(created.providerProfile).toMatchObject({
      enabledModelIds: ['model-a', 'model-b'],
      credential: { configured: true },
    })
    expect(JSON.stringify(created)).not.toContain('secret-value')
    expect(JSON.stringify(created)).not.toContain('secret:')
    const stored = await fixture.documents.get(created.providerProfile.id)
    expect(JSON.stringify(stored)).not.toContain('secret-value')
    const preset = await createPreset(fixture.runtime)
    await expect(fixture.runtime.updateAgentPreset({
      name: 'Invalid model',
      agentPresetId: preset.id, expectedVersion: (await fixture.runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: created.providerProfile.id, modelId: 'disabled-model' },
    })).rejects.toThrow('Provider model is not enabled')
    const profile = await fixture.runtime.updateAgentPreset({
      name: 'Valid model',
      agentPresetId: preset.id, expectedVersion: (await fixture.runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: created.providerProfile.id, modelId: 'model-a' },
    })
    await expect(fixture.runtime.deleteProviderProfile({ providerProfileId: created.providerProfile.id }))
      .resolves.toEqual({ deleted: true, credentialCleanupPending: false })
    await expect(fixture.runtime.getAgentPreset({ agentPresetId: profile.agentPreset.id }))
      .resolves.toMatchObject({ agentPreset: { model: { providerProfileId: created.providerProfile.id, modelId: 'model-a' } } })
    fixture.close()
  })

  it('rolls back Profile deletion when credential cleanup intent cannot be queued', async () => {
    const f = createRuntimeFixture()
    try {
      const { providerProfile } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Atomic deletion', credential: { apiKey: 'test-only' },
      })
      const stored = await f.documents.get(providerProfile.id)
      const ref = (stored!.content as { secretRef: `secret:${string}` }).secretRef
      f.engine.database.exec(`CREATE TRIGGER fail_cleanup_intent BEFORE INSERT ON secret_backend_cleanup
        BEGIN SELECT RAISE(ABORT, 'cleanup intent failed'); END`)
      await expect(f.runtime.deleteProviderProfile({ providerProfileId: providerProfile.id })).rejects.toThrow('cleanup intent failed')
      expect(await f.documents.get(providerProfile.id)).toEqual(stored)
      expect(await f.secrets.getMetadata(ref)).toMatchObject({ state: 'active' })
      expect(f.engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toEqual([])
    } finally { await f.close() }
  })

  it('returns committed deletion with pending credential cleanup and retries it', async () => {
    const backend = createMemorySecretBackend()
    const remove = vi.spyOn(backend, 'delete').mockRejectedValueOnce(new Error('backend unavailable'))
    const f = createRuntimeFixture(backend)
    try {
      const { providerProfile } = await f.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Pending deletion', credential: { apiKey: 'test-only' },
      })
      const stored = await f.documents.get(providerProfile.id)
      const ref = (stored!.content as { secretRef: `secret:${string}` }).secretRef
      await expect(f.runtime.deleteProviderProfile({ providerProfileId: providerProfile.id }))
        .resolves.toEqual({ deleted: true, credentialCleanupPending: true })
      expect(await f.documents.get(providerProfile.id)).toBeNull()
      expect(await f.secrets.getMetadata(ref)).toMatchObject({ state: 'pending-delete' })
      expect(f.engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toHaveLength(1)
      await expect(f.secrets.retryPendingCleanup({ actor: { kind: 'system', id: 'retry' } })).resolves.toBe(1)
      expect(await f.secrets.getMetadata(ref)).toBeUndefined()
      expect(remove).toHaveBeenCalledTimes(2)
    } finally { await f.close() }
  })

  it('validates Provider Profile config and credentials through the adapter registry', async () => {
    const fixture = createRuntimeFixture()
    await expect(fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.anthropic',
      displayName: 'Invalid config',
      config: { unknown: true },
    })).rejects.toThrow()
    await expect(fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.anthropic',
      displayName: 'Invalid credential',
      credential: { apiKey: '' },
    })).rejects.toThrow()
    await expect(fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.anthropic',
      displayName: 'Anthropic account',
      config: { baseUrl: 'https://anthropic.test/v1' },
      credential: { apiKey: 'account-key' },
    })).resolves.toMatchObject({
      providerProfile: { providerExtensionId: 'official.anthropic', credential: { configured: true } },
    })
    fixture.close()
  })

  it('creates a selectable fixed fake model and returns an OpenAI Chat Completion response', async () => {
    const fixture = createRuntimeFixture()
    const created = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Fake AI',
      config: {},
    })

    expect(created.providerProfile).toMatchObject({
      config: {},
      enabledModelIds: [officialFakeModelId],
      credential: { configured: false },
    })
    await expect(fixture.runtime.pingProviderModel({
      providerProfileId: created.providerProfile.id,
      modelId: officialFakeModelId,
      text: 'hello',
    })).resolves.toMatchObject({
      text: 'Agent draft: hello',
      raw: {
        object: 'chat.completion',
        model: officialFakeModelId,
        choices: [{ message: { role: 'assistant', content: 'Agent draft: hello' } }],
      },
    })

    const preset = await createPreset(fixture.runtime)
    await expect(fixture.runtime.updateAgentPreset({
      name: 'Fake Agent',
      agentPresetId: preset.id, expectedVersion: (await fixture.runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: created.providerProfile.id, modelId: officialFakeModelId },
    })).resolves.toMatchObject({
      agentPreset: { model: { providerProfileId: created.providerProfile.id, modelId: officialFakeModelId } },
    })
    fixture.close()
  })

  it('keeps the fake account on its single built-in model', async () => {
    const fixture = createRuntimeFixture()
    const created = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Existing Fake',
      config: {},
      enabledModelIds: ['custom-fake-model'],
    })
    expect(created.providerProfile.enabledModelIds).toEqual([officialFakeModelId])
    await fixture.runtime.updateProviderProfile({
      providerProfileId: created.providerProfile.id,
      expectedVersion: created.providerProfile.version,
      enabledModelIds: [],
    })

    await expect(fixture.runtime.getProviderProfile({
      providerProfileId: created.providerProfile.id,
    })).resolves.toMatchObject({
      providerProfile: {
        config: {},
        enabledModelIds: [officialFakeModelId],
      },
    })
    fixture.close()
  })

  it('migrates the earlier Fake capability profile to Chat Completions', async () => {
    const fixture = createRuntimeFixture()
    const account = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Fake AI',
      config: {},
    })
    await fixture.documents.write({
      id: 'legacy-fake-capability',
      type: applicationDocumentTypes.aiCapabilityProfile,
      content: {
        providerProfileId: account.providerProfile.id,
        capabilityId: 'text.generate',
        displayName: 'Legacy Fake',
        config: { mode: 'template' },
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
      expectedVersion: 'new',
    })

    await fixture.runtime.initialize()

    await expect(fixture.runtime.getAiCapabilityProfile({ profileId: 'legacy-fake-capability' })).resolves.toMatchObject({
      profile: { capabilityId: 'chat.completions', config: {} },
    })
    fixture.close()
  })

  it('builds a minimal OpenAI-compatible payload from an explicit model selection', async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
    const gateway = createOpenAICompatibleGateway({
      providerProfile: {
        id: 'provider-1',
        providerExtensionId: 'official.openai-compatible',
        displayName: 'Provider',
        config: { baseUrl: 'https://example.test/v1/' },
        enabledModelIds: ['test-model'],
      },
      modelId: 'test-model',
      apiKey: 'test-key',
      fetch: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        return providerResponse('test-model', '真实模型回复。')
      }) as typeof fetch,
    })

    const result = await gateway.invokeChat({
      request: {
        messages: [
          { role: 'developer', content: 'Agent instructions.' },
          { role: 'system', content: 'Preset system.' },
          { role: 'user', content: 'hello' },
        ],
      },
      runId: 'run-1',
      sessionId: 'session-1',
      branchId: 'branch-1',
    })

    expect(requests[0]).toMatchObject({
      url: 'https://example.test/v1/chat/completions',
      body: {
        model: 'test-model',
        stream: false,
        messages: [
          { role: 'system', content: 'Agent instructions.' },
          { role: 'system', content: 'Preset system.' },
          { role: 'user', content: 'hello' },
        ],
      },
    })
    expect(requests[0]?.body).not.toHaveProperty('temperature')
    expect(requests[0]?.body).not.toHaveProperty('max_tokens')
    expect(requests[0]?.init.headers).toMatchObject({ authorization: 'Bearer test-key' })
    expect(result.text).toBe('真实模型回复。')
  })

  it('keeps provider-boundary validation in the delegated gateway path', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const gateway = createOpenAICompatibleGateway({
      providerProfile: {
        id: 'provider-1',
        providerExtensionId: 'official.openai-compatible',
        displayName: 'Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      },
      modelId: 'test-model',
      apiKey: 'test-key',
      fetch,
    })

    await expect(
      gateway.invokeChat({
        request: { messages: [{ role: 'user', content: '' }] },
        runId: 'run-1',
        sessionId: 'session-1',
        branchId: 'branch-1',
      }),
    ).rejects.toThrow('content cannot be empty')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves stable HTTP and network errors across the SDK boundary', async () => {
    const options = {
      providerProfile: {
        id: 'provider-1',
        providerExtensionId: 'official.openai-compatible',
        displayName: 'Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      },
      modelId: 'test-model',
      apiKey: 'test-key',
    }
    const input = {
      request: { messages: [{ role: 'user' as const, content: 'hello' }] },
      runId: 'run-1',
      sessionId: 'session-1',
      branchId: 'branch-1',
    }
    const httpGateway = createOpenAICompatibleGateway({
      ...options,
      fetch: (async () =>
        new Response(
          JSON.stringify({
            error: { message: 'Invalid credential' },
          }),
          {
            status: 401,
            headers: { 'content-type': 'application/json' },
          },
        )) as typeof fetch,
    })

    await expect(httpGateway.invokeChat(input)).rejects.toThrow(
      'Provider request failed (401): Invalid credential',
    )

    const networkGateway = createOpenAICompatibleGateway({
      ...options,
      fetch: (async () => {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect timeout'), {
            code: 'ETIMEDOUT',
          }),
        })
      }) as typeof fetch,
    })
    const networkError = await networkGateway
      .invokeChat(input)
      .catch((error) => error as Error)
    expect(networkError).toMatchObject({
      name: 'ProviderConnectTimeoutError',
      message: 'Provider network connection timed out',
    })
  })

  it('preserves stable provider errors through the document-backed registry route', async () => {
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({
      error: { message: 'Invalid account credential' },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })) satisfies typeof fetch)
    const fixture = createRuntimeFixture()
    const profile = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'OpenAI Compatible',
      config: { baseUrl: 'https://gateway.test/v1' },
      enabledModelIds: ['doc-model'],
      credential: { apiKey: 'document-secret' },
    })

    await expect(fixture.runtime.pingProviderModel({
      providerProfileId: profile.providerProfile.id,
      modelId: 'doc-model',
    })).rejects.toThrow('Provider request failed (401): Invalid account credential')
    fixture.close()
  })

  it('loads Provider Profile and credential through the controlled Secret Store path', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown>; authorization?: string }> = []
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      })
      return providerResponse('doc-model', 'Document-backed response.')
    }) satisfies typeof fetch)

    const fixture = createRuntimeFixture()
    const profile = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'OpenAI Compatible',
      config: { baseUrl: 'https://gateway.test/v1' },
      enabledModelIds: ['doc-model'],
      credential: { apiKey: ' document-secret ' },
    })
    const preset = await createPreset(fixture.runtime)
    const agentPreset = await fixture.runtime.updateAgentPreset({
      name: 'Document-backed model',
      agentPresetId: preset.id, expectedVersion: (await fixture.runtime.getPromptResource({ resourceId: preset.id })).resource.version,
      model: { providerProfileId: profile.providerProfile.id, modelId: 'doc-model' },
      delivery: 'complete',
    })
    const session = await fixture.runtime.createAgentSession({ agentPresetId: agentPreset.agentPreset.id })
    const turn = await fixture.runtime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: '走默认 document-backed gateway。',
    })
    console.log('TURN RESULT:', turn)

    expect(requests).toEqual([expect.objectContaining({
      url: 'https://gateway.test/v1/chat/completions',
      authorization: 'Bearer document-secret',
      body: expect.objectContaining({ model: 'doc-model', stream: false }),
    })])
    expect(turn.entries.assistant.entry).toMatchObject({ kind: 'message', role: 'assistant', content: 'Document-backed response.' })
    fixture.close()
  })

  it('discovers OpenAI-compatible models through the controlled Secret Store path', async () => {
    const requests: Array<{ url: string; authorization?: string }> = []
    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
      })
      return new Response(JSON.stringify({
        data: [{ id: 'model-b' }, { id: 'model-a' }, { id: 'model-b' }, { invalid: true }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) satisfies typeof fetch)

    const fixture = createRuntimeFixture()
    const profile = await fixture.runtime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'OpenAI Compatible',
      config: { baseUrl: 'https://gateway.test/v1/' },
      credential: { apiKey: 'document-secret' },
    })

    await expect(fixture.runtime.listProviderModels({ providerProfileId: profile.providerProfile.id }))
      .resolves.toEqual({ modelIds: ['model-b', 'model-a'] })
    expect(requests).toEqual([{
      url: 'https://gateway.test/v1/models',
      authorization: 'Bearer document-secret',
    }])
    fixture.close()
  })
})

function createRuntimeFixture(backend = createMemorySecretBackend()) {
  let nextId = 0
  const engine = createSqliteDataEngine({
    filename: ':memory:',
    createId: prefix => `${prefix}-${++nextId}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const secrets = createSecretStore({
    engine,
    backend,
    createId: prefix => `${prefix}-${++nextId}`,
    now: () => '2026-08-15T00:00:00.000Z',
    authorizeUse: (_metadata, context) => context.caller === 'application.ai-gateway',
  })
  return {
    documents, engine, secrets,
    runtime: createApplicationRuntime({
      agents: createAgentStore({ engine }),
      dataEngine: engine,
      documents,
      promptResources,
      secrets,
    }),
    close: () => engine.close(),
  }
}

async function createPreset(runtime: ReturnType<typeof createRuntimeFixture>['runtime']) {
  const created = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Agent' })
  return (await runtime.createPromptResourceAsset({
    resourceId: created.resource.id,
    targetAssetId: created.resource.rootNode.id,
    position: 'inside',
    asset: { id: `${created.resource.id}.instructions`, label: 'Instructions', category: 'preset', kind: 'entry', body: 'Reply.' },
  })).resource
}

function providerResponse(model: string, content: string): Response {
  return new Response(JSON.stringify({
    id: 'call-1',
    model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
