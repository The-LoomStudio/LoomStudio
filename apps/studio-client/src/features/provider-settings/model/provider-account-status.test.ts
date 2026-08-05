import { describe, expect, it } from 'vitest'
import type { ProviderAccount } from '../../../entities/index.js'
import { hasCompleteProviderAccount } from './provider-account-status.js'

describe('hasCompleteProviderAccount', () => {
  it('requires an OpenAI-compatible account with a base URL and API key reference', () => {
    expect(hasCompleteProviderAccount([])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: '' }, { apiKey: 'plain:key' })])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: 'https://api.example.com/v1' }, {})])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: 'https://api.example.com/v1' }, { apiKey: 'plain:key' })])).toBe(true)
  })

  it('does not guess requirements for extension-owned provider accounts', () => {
    expect(hasCompleteProviderAccount([account({}, {}, 'third-party.provider')])).toBe(true)
  })
})

function account(
  config: ProviderAccount['config'],
  secretRefs: ProviderAccount['secretRefs'],
  providerExtensionId = 'official.openai-compatible',
): ProviderAccount {
  return {
    id: 'provider-account-test',
    version: 1,
    providerExtensionId,
    displayName: 'Test Provider',
    config,
    secretRefs,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  }
}
