import {
  createAiGateway,
  parseProviderOptions,
} from '../../../packages/ai-gateway/src/index.js'
import { describe, expect, it } from 'vitest'

describe('platform AI gateway', () => {
  it('uses one SDK step and returns a function tool call without executing it', async () => {
    const requests: Array<Record<string, unknown>> = []
    const gateway = createAiGateway()
    const result = await gateway.invokeChat({
      provider: {
        kind: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        fetch: stubFetch(requests, {
          id: 'call-1',
          model: 'test-model',
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'tool-1',
                    type: 'function',
                    function: {
                      name: 'write_text',
                      arguments: '{"path":"a.txt","content":"raw\\ntext"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        }),
      },
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'write' }],
      tools: [
        {
          name: 'write_text',
          description: 'write text',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      ],
      toolChoice: { type: 'tool', toolName: 'write_text' },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'test-model',
      tool_choice: { type: 'function', function: { name: 'write_text' } },
      tools: [{ type: 'function', function: { name: 'write_text' } }],
    })
    expect(result).toMatchObject({
      finishReason: 'tool_call',
      rawFinishReason: 'tool_calls',
      providerCallId: 'call-1',
      raw: expect.objectContaining({ id: 'call-1' }),
      message: {
        role: 'assistant',
        tool_calls: [{ id: 'tool-1', function: { name: 'write_text' } }],
      },
    })
  })

  it('replays canonical tool calls and results through the SDK wire adapter', async () => {
    const requests: Array<Record<string, unknown>> = []
    const gateway = createAiGateway()
    await gateway.invokeChat({
      provider: {
        kind: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        fetch: stubFetch(requests, textResponse('done')),
      },
      modelId: 'test-model',
      messages: [
        { role: 'user', content: 'write' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'tool-1',
              type: 'function',
              function: {
                name: 'write_text',
                arguments: '{"path":"a.txt","content":"hello"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'tool-1', content: 'ok' },
      ],
      tools: [{ name: 'write_text', inputSchema: { type: 'object' } }],
    })

    expect(requests[0]?.messages).toEqual([
      { role: 'user', content: 'write' },
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'tool-1' })],
      }),
      { role: 'tool', tool_call_id: 'tool-1', content: 'ok' },
    ])
  })

  it('rejects unknown provider options before they reach an adapter', () => {
    expect(() =>
      parseProviderOptions('openai', { arbitraryVendorFlag: true }),
    ).toThrow()
    expect(
      parseProviderOptions('openai', { store: false, reasoningEffort: 'low' }),
    ).toEqual({
      openai: { store: false, reasoningEffort: 'low' },
    })
  })

  it('rejects ambiguous tool registration before a provider request', async () => {
    const fetch = stubFetch([], textResponse('unused'))
    const base = {
      provider: {
        kind: 'openai-compatible' as const,
        apiKey: 'test-key',
        baseUrl: 'https://example.test/v1',
        fetch,
      },
      modelId: 'test-model',
      messages: [{ role: 'user' as const, content: 'write' }],
    }

    await expect(
      createAiGateway().invokeChat({
        ...base,
        tools: [
          { name: 'write_text', inputSchema: { type: 'object' } },
          { name: 'write_text', inputSchema: { type: 'object' } },
        ],
      }),
    ).rejects.toThrow('Duplicate tool name: write_text')

    await expect(
      createAiGateway().invokeChat({
        ...base,
        tools: [{ name: 'write_text', inputSchema: { type: 'object' } }],
        toolChoice: { type: 'tool', toolName: 'missing' },
      }),
    ).rejects.toThrow('Tool choice references an unknown tool: missing')

    await expect(
      createAiGateway().invokeChat({
        ...base,
        toolChoice: 'required',
      }),
    ).rejects.toThrow('Tool choice requires at least one registered tool')
  })
})

function stubFetch(
  requests: Array<Record<string, unknown>>,
  responseBody: Record<string, unknown>,
): typeof fetch {
  return (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'request-1',
      },
    })
  }) as typeof fetch
}

function textResponse(content: string): Record<string, unknown> {
  return {
    id: 'call-2',
    model: 'test-model',
    choices: [
      { finish_reason: 'stop', message: { role: 'assistant', content } },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
  }
}
