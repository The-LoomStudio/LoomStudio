import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AiCapabilityLab } from '../../../apps/studio-client/src/widgets/model-panel/ai-capability-lab.js'

describe('unavailable capability profile visibility', () => {
  it('keeps missing references and saved config visible without any registered providers', () => {
    const html = renderToStaticMarkup(createElement(AiCapabilityLab, {
      providers: [], providerAccounts: [],
      profiles: [{
        id: 'profile-kept', version: 1, providerProfileId: 'deleted-account',
        capabilityId: 'text.rerank', displayName: 'Saved profile', config: { model: 'kept-model' },
        available: false, unavailableReason: 'provider-profile-missing',
        createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      }],
      onCreateProviderAccount: async () => undefined,
      onCreateProfile: async () => undefined,
      onUpdateProviderAccount: async () => {},
      onUpdateProfile: async () => {},
      onInvoke: async () => { throw new Error('Not invoked during rendering') },
      onRefresh: async () => {},
      t: key => key,
    }))
    for (const text of ['Saved profile', 'profile-kept', 'deleted-account', 'text.rerank', 'kept-model', 'provider.aiLabMissingAccount']) {
      expect(html).toContain(text)
    }
  })
})
