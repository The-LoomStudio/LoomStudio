import { createApplicationRuntime, createOpenAICompatibleGateway } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('application runtime provider and agent integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('invokes an OpenAI-compatible gateway with model profile config and normalized chat result', async () => {
    const requests: Array<{
      url: string
      init: RequestInit
      body: Record<string, unknown>
    }> = []
    const gateway = createOpenAICompatibleGateway({
      providerAccount: {
        id: 'account-openai',
        providerExtensionId: 'official.openai-compatible',
        displayName: 'OpenAI Compatible',
        config: { baseUrl: 'https://example.test/v1/' },
        secretRefs: { apiKey: 'plain:test-key' },
      },
      modelProfile: {
        id: 'model-rp',
        providerAccountId: 'account-openai',
        capability: 'chat.completion',
        displayName: 'RP Model',
        providerModelId: 'test-model',
        config: {
          temperature: 0.7,
          max_tokens: 256,
          stream: true,
          additionalParameters: {
            top_p: 0.9,
            unsupported_param: 'ignored',
          },
        },
      },
      fetch: (async (url, init) => {
        requests.push({
          url: String(url),
          init: init ?? {},
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        })

        return new Response(JSON.stringify({
          id: 'call-1',
          model: 'test-model',
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: '真实模型回复。' },
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
          },
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch,
    })
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
      gateway,
    })
    const { session } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Gateway Card' },
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      input: '测试真实 provider gateway。',
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe('https://example.test/v1/chat/completions')
    expect(requests[0]?.init.headers).toMatchObject({ authorization: 'Bearer test-key' })
    expect(requests[0]?.body).toMatchObject({
      model: 'test-model',
      temperature: 0.7,
      max_tokens: 256,
      top_p: 0.9,
      stream: false,
    })
    expect(requests[0]?.body).not.toHaveProperty('unsupported_param')
    expect(turn.entries.assistant.content).toBe('真实模型回复。')
    expect(turn.run).toMatchObject({
      provider: 'openai-compatible',
      model: 'test-model',
    })
  })

  it('binds an agent runtime profile to a session and mirrors narrative entries into agent transcript', async () => {
    const gatewayCalls: Array<{ modelProfileId?: string }> = []
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
      gateway: {
        invokeChat: async input => {
          gatewayCalls.push({ modelProfileId: input.modelProfileId })
          return {
            provider: 'fake',
            model: 'fake-agent-model',
            text: 'Agent says hello.',
          }
        },
      },
    })
    const providerAccount = await runtime.createProviderAccount({
      providerExtensionId: 'official.fake',
      displayName: 'Fake Provider',
      config: { baseUrl: 'fake://local' },
      secretRefs: { apiKey: 'plain:test' },
    })
    const modelProfile = await runtime.createModelProfile({
      providerAccountId: providerAccount.providerAccount.id,
      displayName: 'Fake RP Model',
      providerModelId: 'fake-rp',
      config: { temperature: 0.7 },
    })
    const agentRuntimeProfile = await runtime.createAgentRuntimeProfile({
      name: 'Narrative Agent',
      purpose: 'narrative',
      modelProfileId: modelProfile.modelProfile.id,
    })
    const card = await runtime.createCard({
      name: 'Agent Card',
      opening: {
        entries: [
          { role: 'assistant', content: '开场。' },
        ],
      },
    })
    const { session, branch } = await runtime.createSessionFromCard({
      cardId: card.card.id,
      agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      branchId: branch.id,
      input: '玩家输入。',
    })
    const transcript = await runtime.getAgentTranscript({
      sessionId: session.id,
      branchId: turn.branch.id,
    })

    expect(session.agentRuntimeProfileId).toBe(agentRuntimeProfile.agentRuntimeProfile.id)
    expect(gatewayCalls).toEqual([{ modelProfileId: modelProfile.modelProfile.id }])
    expect(turn.run).toMatchObject({
      agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
      modelProfileId: modelProfile.modelProfile.id,
    })
    expect(transcript.entries.map(entry => ({ role: entry.role, content: entry.content }))).toEqual([
      { role: 'assistant', content: '开场。' },
      { role: 'user', content: '玩家输入。' },
      { role: 'assistant', content: 'Agent says hello.' },
    ])
    expect(transcript.entries[1]?.parentTranscriptEntryId).toBe(transcript.entries[0]?.id)
    expect(transcript.entries[2]?.parentTranscriptEntryId).toBe(transcript.entries[1]?.id)
    expect(transcript.entries.map(entry => entry.source)).toEqual(['narrative', 'narrative', 'narrative'])
  })

  it('auto-loads OpenAI-compatible gateway config from model profile documents', async () => {
    const requests: Array<{
      url: string
      body: Record<string, unknown>
    }> = []

    vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })

      return new Response(JSON.stringify({
        id: 'doc-call-1',
        model: 'doc-model',
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Document-backed response.' },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) satisfies typeof fetch)

    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
    })
    const providerAccount = await runtime.createProviderAccount({
      providerExtensionId: 'official.openai-compatible',
      displayName: 'OpenAI Compatible',
      config: { baseUrl: 'https://gateway.test/v1' },
      secretRefs: { apiKey: 'plain:test-key' },
    })
    const modelProfile = await runtime.createModelProfile({
      providerAccountId: providerAccount.providerAccount.id,
      displayName: 'Document Model',
      providerModelId: 'doc-model',
      config: { temperature: 0.2 },
    })
    const agentRuntimeProfile = await runtime.createAgentRuntimeProfile({
      name: 'Document-backed Agent',
      modelProfileId: modelProfile.modelProfile.id,
    })
    const { session } = await runtime.createSession({
      cardSourceVersionId: 'card-version-1',
      cardSnapshot: { name: 'Document Gateway Card' },
      agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
    })
    const turn = await runtime.submitTurn({
      sessionId: session.id,
      input: '走默认 document-backed gateway。',
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      url: 'https://gateway.test/v1/chat/completions',
      body: {
        model: 'doc-model',
        temperature: 0.2,
        stream: false,
      },
    })
    expect(turn.entries.assistant.content).toBe('Document-backed response.')
    expect(turn.run).toMatchObject({
      provider: 'openai-compatible',
      model: 'doc-model',
      modelProfileId: modelProfile.modelProfile.id,
    })
  })
})
