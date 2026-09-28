import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../../apps/studio-client/src/features/provider-settings/model/provider-base-url.js'
import { chooseAgentPresetId } from '../../../apps/studio-client/src/features/agent-presets/model/use-agent-presets.js'
import type { AgentPreset } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('provider settings model', () => {
  it('normalizes OpenAI base URL without rewriting full endpoints', () => {
    expect(normalizeOpenAICompatibleBaseUrl(' https://api.openai.com/ ')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions')
    expect(readChatCompletionsEndpoint('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions')
    expect(isLikelyProviderEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true)
  })

  it('keeps or restores selected Agent Preset after refresh', () => {
    const profiles = [
      agentPreset('agent-a'),
      agentPreset('agent-b'),
    ]

    expect(chooseAgentPresetId({
      currentId: 'agent-b',
      profiles,
      storedId: 'agent-a',
    })).toBe('agent-b')
    expect(chooseAgentPresetId({
      currentId: 'deleted-agent',
      profiles,
      storedId: 'agent-a',
    })).toBe('deleted-agent')
    expect(chooseAgentPresetId({
      profiles,
    })).toBe('agent-a')
    expect(chooseAgentPresetId({
      currentId: 'deleted-agent',
      profiles: [],
      storedId: 'agent-a',
    })).toBe('deleted-agent')
    expect(chooseAgentPresetId({
      profiles,
      storedId: 'deleted-agent',
    })).toBe('deleted-agent')
  })
})

function agentPreset(id: string): AgentPreset {
  return {
    id,
    version: 1,
    resourceKind: 'preset',
    rootNode: { id: `${id}-root`, kind: 'module', label: id },
    model: { providerProfileId: 'provider-1', modelId: 'model-1' },
    delivery: 'stream',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  }
}
