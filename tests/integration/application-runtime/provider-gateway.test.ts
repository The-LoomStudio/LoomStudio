import { createAgentStore } from '@loom-studio/agent-store'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { applicationDocumentTypes, createApplicationRuntime, createOpenAICompatibleGateway } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createMemorySecretBackend, createSecretStore } from '../../../packages/secret-store/src/index.js'
import { createPromptResourceStore } from '../../../packages/prompt-resource-store/src/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('application runtime Provider Profile integration', () => {
  afterEach(() => vi.unstubAllGlobals())

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
    await expect(fixture.runtime.createAgentProfile({
      name: 'Invalid model',
      presetId: preset.id,
      model: { providerProfileId: created.providerProfile.id, modelId: 'disabled-model' },
    })).rejects.toThrow('Provider model is not enabled')
    const profile = await fixture.runtime.createAgentProfile({
      name: 'Valid model',
      presetId: preset.id,
      model: { providerProfileId: created.providerProfile.id, modelId: 'model-a' },
    })
    await expect(fixture.runtime.deleteProviderProfile({ providerProfileId: created.providerProfile.id }))
      .rejects.toThrow('still referenced')
    await fixture.runtime.deleteAgentProfile({ agentProfileId: profile.agentProfile.id })
    await expect(fixture.runtime.deleteProviderProfile({ providerProfileId: created.providerProfile.id }))
      .resolves.toEqual({ deleted: true, credentialCleanupPending: false })
    fixture.close()
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
      providerExtensionId: 'anthropic',
      displayName: 'Anthropic account',
      config: { baseUrl: 'https://anthropic.test/v1' },
      credential: { apiKey: 'account-key' },
    })).resolves.toMatchObject({
      providerProfile: { providerExtensionId: 'anthropic', credential: { configured: true } },
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
    await expect(fixture.runtime.createAgentProfile({
      name: 'Fake Agent',
      presetId: preset.id,
      model: { providerProfileId: created.providerProfile.id, modelId: officialFakeModelId },
    })).resolves.toMatchObject({
      agentProfile: { model: { providerProfileId: created.providerProfile.id, modelId: officialFakeModelId } },
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
          { role: 'system', content: 'Agent instructions.\n\nPreset system.' },
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
    } as const
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
    const agentProfile = await fixture.runtime.createAgentProfile({
      name: 'Document-backed model',
      presetId: preset.id,
      model: { providerProfileId: profile.providerProfile.id, modelId: 'doc-model' },
    })
    const session = await fixture.runtime.createAgentSession({ agentProfileId: agentProfile.agentProfile.id })
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

function createRuntimeFixture() {
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
    backend: createMemorySecretBackend(),
    createId: prefix => `${prefix}-${++nextId}`,
    now: () => '2026-08-15T00:00:00.000Z',
    authorizeUse: (_metadata, context) => context.caller === 'application.ai-gateway',
  })
  return {
    documents,
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
