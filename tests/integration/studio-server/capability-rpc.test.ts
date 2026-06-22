import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server capability rpc integration', () => {
  it('serves studio rpc capability metadata through /rpc', async () => {
    await withStudioServer(async port => {
      const listed = await callRpc<{
        capabilities: Array<{ name: string; namespace: string; owner: string; stability: string }>
      }>(port, 'studio.rpc.listCapabilities', {})

      expect(listed.capabilities).toContainEqual(expect.objectContaining({
        name: 'application.createCard',
        namespace: 'application',
        owner: 'application',
        stability: 'experimental',
      }))
      expect(listed.capabilities).toContainEqual(expect.objectContaining({
        name: 'renderer.createSession',
        namespace: 'renderer',
        owner: 'studio-server',
        stability: 'experimental',
      }))
    })
  })
})
