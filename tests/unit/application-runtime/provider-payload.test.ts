import { buildOpenAIChatPayload } from '../../../packages/application-runtime/src/provider-payload.js'
import { describe, expect, it } from 'vitest'

describe('OpenAI-compatible provider payload builder', () => {
  it('builds a minimal chat completions payload from canonical messages and a model id', () => {
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
      modelId: 'gpt-test',
    })

    expect(payload).toEqual({
      model: 'gpt-test',
      messages: [
        { role: 'system', content: 'System rules.\n\nDeveloper rules.' },
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
      stream: false,
    })
  })

  it('downgrades developer messages and coalesces adjacent system context for broad compatibility', () => {
    const payload = buildOpenAIChatPayload({
      messages: [
        { role: 'developer', content: 'Agent instructions.' },
        { role: 'system', content: 'Preset system.' },
        { role: 'system', content: 'Stable knowledge.' },
        { role: 'user', content: 'Hello.' },
      ],
      modelId: 'compatible-model',
    })

    expect(payload.messages).toEqual([
      { role: 'system', content: 'Agent instructions.\n\nPreset system.\n\nStable knowledge.' },
      { role: 'user', content: 'Hello.' },
    ])
  })

  it('rejects invalid payload fields at the provider boundary', () => {
    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'user', content: '' }],
      modelId: 'gpt-test',
    })).toThrow('content cannot be empty')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'assistant' }],
      modelId: 'gpt-test',
    })).toThrow('assistant message cannot be empty')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'tool', tool_call_id: '', content: 'result' }],
      modelId: 'gpt-test',
    })).toThrow('tool_call_id cannot be empty')

    expect(() => buildOpenAIChatPayload({
      messages: [{ role: 'user', content: 'Hello.' }],
      modelId: '',
    })).toThrow('modelId cannot be empty')
  })
})
