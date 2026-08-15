import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../../apps/studio-client/src/features/provider-settings/model/provider-base-url.js'
import { chooseAgentProfileId } from '../../../apps/studio-client/src/features/agent-profiles/model/use-agent-profiles.js'
import type { AgentProfile } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('provider settings model', () => {
  it('normalizes OpenAI base URL without rewriting full endpoints', () => {
    expect(normalizeOpenAICompatibleBaseUrl(' https://api.openai.com/ ')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions')
    expect(readChatCompletionsEndpoint('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions')
    expect(isLikelyProviderEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true)
  })

  it('keeps or restores selected Agent Profile after refresh', () => {
    const profiles = [
      agentProfile('agent-a'),
      agentProfile('agent-b'),
    ]

    expect(chooseAgentProfileId({
      currentId: 'agent-b',
      profiles,
      storedId: 'agent-a',
    })).toBe('agent-b')
    expect(chooseAgentProfileId({
      currentId: 'deleted-agent',
      profiles,
      storedId: 'agent-a',
    })).toBe('agent-a')
    expect(chooseAgentProfileId({
      profiles,
    })).toBe('agent-a')
    expect(chooseAgentProfileId({
      currentId: 'deleted-agent',
      profiles: [],
      storedId: 'agent-a',
    })).toBeUndefined()
  })
})

function agentProfile(id: string): AgentProfile {
  return {
    id,
    version: 1,
    name: id,
    presetId: 'preset-1',
    model: { providerProfileId: 'provider-1', modelId: 'model-1' },
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  }
}
