import { buildOpenAIChatPayload } from '../../../packages/application-runtime/src/provider-payload.js'
import { describe, expect, it } from 'vitest'

describe('OpenAI-compatible provider payload builder', () => {
  it('builds a stable chat completions payload from canonical messages and model profile config', () => {
    const payload = buildOpenAIChatPayload({
      messages: [
        { role: 'system', content: 'System rules.' },
        { role: 'developer', content: 'Developer rules.' },
        { role: 'user', content: 'Hello.' },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"id":"x"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'Found.' },
      ],
      modelProfile: {
        id: 'model-1',
        providerAccountId: 'account-1',
        capability: 'chat.completion',
        displayName: 'Test Model',
        providerModelId: 'gpt-test',
        config: {
          temperature: 0.7,
          max_tokens: 256,
          stream: true,
          customHeaders: { 'x-test': 'ignored' },
          additionalParameters: {
            top_p: 0.9,
            unknown_param: 'ignored',
          },
          excludeParameters: ['temperature'],
        },
      },
    })

    expect(payload).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'System rules.' },
        { role: 'developer', content: 'Developer rules.' },
        { role: 'user', content: 'Hello.' },
        {
          role: 'assistant',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"id":"x"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'Found.' },
      ],
      max_tokens: 256,
      top_p: 0.9,
      stream: false,
    })
  })

  it('rejects invalid payload fields at the provider boundary', () => {
    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'user', content: '' }],
      modelProfile: modelProfile({}),
    })).toThrow('content cannot be empty')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'user', content: 'Hello.' }],
      modelProfile: modelProfile({ temperature: 'hot' }),
    })).toThrow('temperature')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'assistant' }],
      modelProfile: modelProfile({}),
    })).toThrow('assistant message cannot be empty')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'tool', tool_call_id: '', content: 'result' }],
      modelProfile: modelProfile({}),
    })).toThrow('tool_call_id cannot be empty')
  })
})

function modelProfile(config: Record<string, unknown>) {
  return {
    id: 'model-1',
    providerAccountId: 'account-1',
    capability: 'chat.completion' as const,
    displayName: 'Test Model',
    providerModelId: 'gpt-test',
    config,
  }
}
