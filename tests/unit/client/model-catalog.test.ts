import { describe, expect, it } from 'vitest'
import { mergeModelCatalog } from '../../../apps/studio-client/src/features/provider-settings/model/model-catalog.js'

describe('mergeModelCatalog', () => {
  it('keeps enabled models first and removes duplicate fetched models', () => {
    expect(mergeModelCatalog(['gpt-4.1-mini'], ['gpt-4o', 'gpt-4.1-mini'], '')).toEqual([
      { enabled: true, id: 'gpt-4.1-mini' },
      { enabled: false, id: 'gpt-4o' },
    ])
  })

  it('filters both enabled and fetched models case-insensitively', () => {
    expect(mergeModelCatalog(['Claude-Sonnet'], ['gpt-4o'], 'sonnet')).toEqual([
      { enabled: true, id: 'Claude-Sonnet' },
    ])
  })
})
