import { describe, expect, it } from 'vitest'
import { resolveModelBrand, resolveProviderBrand } from '../../../apps/studio-client/src/features/provider-settings/model/model-brand.js'

describe('model brand resolution', () => {
  it.each([
    ['gpt-4.1-mini', 'openai'],
    ['anthropic/claude-sonnet-4', 'anthropic'],
    ['google/gemini-2.5-pro', 'gemini'],
    ['deepseek-chat', 'deepseek'],
    ['[NV]deepseek-v4-flash-0731', 'deepseek'],
    ['[G]GLM-5.3', 'zhipu'],
    ['step-3.7-flash', 'stepfun'],
    ['meta-llama/llama-4-maverick', 'meta'],
    ['qwen/qwen3-235b', 'qwen'],
    ['unknown-model', null],
  ])('maps %s to %s', (modelId, expected) => {
    expect(resolveModelBrand(modelId)).toBe(expected)
  })

  it('prefers a concrete provider hint over an OpenAI-compatible extension id', () => {
    expect(resolveProviderBrand('DeepSeek', 'https://api.deepseek.com', 'builtin.openai-compatible')).toBe('deepseek')
  })
})
