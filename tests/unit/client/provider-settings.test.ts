import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { readModelConfig, readModelConfigForm } from '../../../apps/studio-client/src/features/provider-settings/model/model-profile-config.js'
import { isLikelyProviderEndpoint, normalizeOpenAICompatibleBaseUrl, readChatCompletionsEndpoint } from '../../../apps/studio-client/src/features/provider-settings/model/provider-base-url.js'
import { chooseAgentRuntimeProfileId, readGatewayModelConfig } from '../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.js'
import type { AgentRuntimeProfile, ModelProfile } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('provider settings model', () => {
  it('maps camelCase form fields to provider wire config', () => {
    const config = readGatewayModelConfig({
      temperature: '0.7',
      maxTokens: '256',
    }, createTranslator('en-US'))

    expect(config).toEqual({
      temperature: 0.7,
      max_tokens: 256,
    })
  })

  it('rejects invalid numeric model config', () => {
    expect(() => readGatewayModelConfig({
      temperature: 'warm',
      maxTokens: '',
    }, createTranslator('en-US'))).toThrow('Expected number')
  })

  it('normalizes OpenAI base URL without rewriting full endpoints', () => {
    expect(normalizeOpenAICompatibleBaseUrl(' https://api.openai.com/ ')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/chat/completions')).toBe('https://api.openai.com/v1/chat/completions')
    expect(readChatCompletionsEndpoint('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions')
    expect(isLikelyProviderEndpoint('https://api.openai.com/v1/chat/completions')).toBe(true)
  })

  it('maps model config to yaml form fields', () => {
    const form = readModelConfigForm(modelProfile({
      additionalParameters: { top_p: 0.9 },
      customHeaders: { 'x-trace': 'on' },
    }))

    expect(form.additionalParameters).toContain('top_p')
    expect(form.excludeParameters).toBe('')
    expect(form.customHeaders).toContain('x-trace')
  })

  it('maps yaml form fields back to model config', () => {
    const config = readModelConfig(modelProfile({
      additionalParameters: { old: true },
      excludeParameters: ['seed'],
      customHeaders: { stale: 'yes' },
    }), {
      additionalParameters: 'top_p: 0.8',
      excludeParameters: '',
      customHeaders: 'x-trace: on',
    })

    expect(config).toEqual({
      additionalParameters: { top_p: 0.8 },
      customHeaders: { 'x-trace': 'on' },
    })
  })

  it('keeps or restores selected agent runtime profile after refresh', () => {
    const profiles = [
      agentProfile('agent-a'),
      agentProfile('agent-b'),
    ]

    expect(chooseAgentRuntimeProfileId({
      currentId: 'agent-b',
      profiles,
      storedId: 'agent-a',
    })).toBe('agent-b')
    expect(chooseAgentRuntimeProfileId({
      currentId: 'deleted-agent',
      profiles,
      storedId: 'agent-a',
    })).toBe('agent-a')
    expect(chooseAgentRuntimeProfileId({
      profiles,
    })).toBe('agent-a')
    expect(chooseAgentRuntimeProfileId({
      currentId: 'deleted-agent',
      profiles: [],
      storedId: 'agent-a',
    })).toBeUndefined()
  })
})

function modelProfile(config: ModelProfile['config']): ModelProfile {
  return {
    id: 'model-profile',
    version: 1,
    providerAccountId: 'provider',
    capability: 'chat',
    displayName: 'Model',
    providerModelId: 'gpt-test',
    config,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  }
}

function agentProfile(id: string): AgentRuntimeProfile {
  return {
    id,
    version: 1,
    name: id,
    purpose: 'narrative',
    modelProfileId: 'model-profile',
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
  }
}
