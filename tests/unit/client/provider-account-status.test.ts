import { describe, expect, it } from 'vitest'
import type { ProviderAccount } from '../../../apps/studio-client/src/entities/index.js'
import { hasCompleteProviderAccount } from '../../../apps/studio-client/src/features/provider-settings/model/provider-account-status.js'

describe('hasCompleteProviderAccount', () => {
  it('requires an OpenAI-compatible account with a base URL and API key reference', () => {
    expect(hasCompleteProviderAccount([])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: '' }, true)])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: 'https://api.example.com/v1' }, false)])).toBe(false)
    expect(hasCompleteProviderAccount([account({ baseUrl: 'https://api.example.com/v1' }, true)])).toBe(true)
  })

  it('does not guess requirements for extension-owned provider accounts', () => {
    expect(hasCompleteProviderAccount([account({}, false, 'third-party.provider')])).toBe(true)
  })
})

function account(
  config: ProviderAccount['config'],
  configured: boolean,
  providerExtensionId = 'official.openai-compatible',
): ProviderAccount {
  return {
    id: 'provider-account-test',
    version: 1,
    providerExtensionId,
    displayName: 'Test Provider',
    config,
    enabledModelIds: [],
    credential: { configured },
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  }
}
