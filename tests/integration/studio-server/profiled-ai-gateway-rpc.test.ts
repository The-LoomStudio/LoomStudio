import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('profile-backed AI Gateway RPC', () => {
  it('creates persisted capability configuration and invokes by profile id only', async () => {
    await withStudioServer(async port => {
      const account = await callRpc<{ providerProfile: { id: string; credential: { configured: boolean } } }>(
        port,
        'application.createProviderProfile',
        {
          providerExtensionId: 'official.fake',
          displayName: 'Fake Account',
          config: {},
        },
      )
      const created = await callRpc<{ profile: { id: string; available: boolean } }>(
        port,
        'application.createAiCapabilityProfile',
        {
          providerProfileId: account.providerProfile.id,
          capabilityId: 'chat.completions',
          displayName: 'Fake Chat Completion',
          config: {},
        },
      )

      expect(account.providerProfile.credential.configured).toBe(false)
      expect(created.profile.available).toBe(true)
      await expect(callRpc(port, 'ai.invoke', {
        profileId: created.profile.id,
        input: { messages: [{ role: 'user', content: 'gateway input' }] },
      })).resolves.toMatchObject({
        profileId: created.profile.id,
        providerId: 'official.fake',
        capabilityId: 'chat.completions',
        output: {
          object: 'chat.completion',
          choices: [{ message: { content: 'Agent draft: gateway input' } }],
        },
      })
      await expect(callRpc(port, 'ai.invoke', {
        providerId: 'official.fake',
        capabilityId: 'chat.completions',
        input: { messages: [{ role: 'user', content: 'bypass' }] },
      })).rejects.toThrow('profileId')

      await callRpc(port, 'application.deleteProviderProfile', { providerProfileId: account.providerProfile.id })
      await expect(callRpc(port, 'application.getAiCapabilityProfile', { profileId: created.profile.id }))
        .resolves.toMatchObject({ profile: { available: false, unavailableReason: 'provider-profile-missing' } })
      await expect(callRpc(port, 'ai.invoke', { profileId: created.profile.id, input: { messages: [] } }))
        .rejects.toThrow(account.providerProfile.id)
      const replacement = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake', displayName: 'Fake Account', config: {},
      })
      await expect(callRpc(port, 'application.updateAiCapabilityProfile', {
        profileId: created.profile.id, providerProfileId: replacement.providerProfile.id,
      })).resolves.toMatchObject({ profile: { available: true, providerProfileId: replacement.providerProfile.id } })
    })
  })
})
