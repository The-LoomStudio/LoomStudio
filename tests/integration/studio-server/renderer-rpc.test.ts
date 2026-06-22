import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server renderer rpc integration', () => {
  it('serves the Custom Renderer PoC state through /rpc', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{
        session: { id: string; revoked: boolean }
        state: { loveLevel: number; messages: Array<{ content: string }> }
      }>(port, 'renderer.createSession', {})
      const updated = await callRpc<{
        state: { loveLevel: number }
      }>(port, 'renderer.state.set', {
        sessionId: created.session.id,
        key: 'loveLevel',
        value: 7,
      })
      const appended = await callRpc<{
        message: { role: string; content: string }
        state: { messages: Array<{ content: string }> }
      }>(port, 'renderer.messages.append', {
        sessionId: created.session.id,
        role: 'user',
        content: 'Renderer PoC RPC message.',
      })
      const listed = await callRpc<{
        messages: Array<{ content: string }>
      }>(port, 'renderer.messages.list', {
        sessionId: created.session.id,
      })
      const revoked = await callRpc<{
        session: { revoked: boolean }
      }>(port, 'renderer.revokeSession', {
        sessionId: created.session.id,
      })

      expect(created.session.revoked).toBe(false)
      expect(created.state.loveLevel).toBe(1)
      expect(updated.state.loveLevel).toBe(7)
      expect(appended.message).toMatchObject({ role: 'user', content: 'Renderer PoC RPC message.' })
      expect(listed.messages.map(message => message.content)).toContain('Renderer PoC RPC message.')
      expect(appended.state.messages.map(message => message.content)).toContain('Renderer PoC RPC message.')
      expect(revoked.session.revoked).toBe(true)
    })
  })
})
