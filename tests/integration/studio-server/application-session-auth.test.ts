import { describe, expect, it } from 'vitest'
import { createApplicationSession, withStudioServer } from './helpers.js'

describe('Studio Server application session auth', () => {
  it('keeps health public and rejects protected requests without a session', async () => {
    await withStudioServer(async port => {
      const health = await fetch(`http://127.0.0.1:${port}/health`)
      expect(health.status).toBe(200)

      const rpc = await fetch(`http://127.0.0.1:${port}/rpc`, { method: 'POST' })
      expect(rpc.status).toBe(401)
      await expect(rpc.json()).resolves.toMatchObject({ error: { code: 'auth.unauthorized' } })
    })
  })

  it('bootstraps only from the exact request origin', async () => {
    await withStudioServer(async port => {
      const url = `http://127.0.0.1:${port}/auth/session`
      expect((await fetch(url, { method: 'POST' })).status).toBe(403)
      expect((await fetch(url, {
        method: 'POST',
        headers: { origin: 'http://localhost:5173' },
      })).status).toBe(403)
      expect((await fetch(url, {
        method: 'POST',
        headers: {
          host: 'attacker.example',
          origin: 'http://attacker.example',
        },
      })).status).toBe(403)

      const response = await fetch(url, {
        method: 'POST',
        headers: { origin: `http://127.0.0.1:${port}` },
      })
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      const cookie = response.headers.get('set-cookie')
      expect(cookie).toMatch(/^loom_studio_session=[A-Za-z0-9_-]+;/)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')
      expect(cookie).toContain('Path=/')
      expect(cookie).not.toContain('Secure')
    })
  })

  it('accepts the explicitly configured Vite development origin behind the proxy', async () => {
    await withStudioServer(async port => {
      const response = await fetch(`http://127.0.0.1:${port}/auth/session`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173' },
      })
      expect(response.status).toBe(204)
      expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    })
  })

  it('accepts the issued cookie without exposing its token in a response body', async () => {
    await withStudioServer(async port => {
      const cookie = await createApplicationSession(port)
      const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'system.ping', params: { echo: 'auth-test' } }),
      })
      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ result: { echo: 'auth-test' } })
    })
  })
})
