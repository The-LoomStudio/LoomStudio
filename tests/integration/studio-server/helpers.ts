import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/local-paths.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'

export async function withStudioServer<T>(run: (port: number, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'loom-server-'))
  const server = createStudioServer({
    localPaths: resolveLoomStudioLocalPaths({ home: dir }),
    secretBackend: createMemorySecretBackend(),
  })

  try {
    const { port } = await server.listen(0)
    return await run(port, dir)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

export async function callRpc<T>(port: number, method: string, params: unknown): Promise<T> {
  const response = await authenticatedFetch(port, '/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: method,
      method,
      params,
    }),
  })
  const payload = await response.json() as {
    result?: T
    error?: { message: string }
  }

  if (payload.error) {
    throw new Error(payload.error.message)
  }

  if (!payload.result) {
    throw new Error(`Missing RPC result: ${method}`)
  }

  return payload.result
}

export async function authenticatedFetch(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  const cookie = await createApplicationSession(port)
  const headers = new Headers(init.headers)
  headers.set('cookie', cookie)
  return await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers })
}

export async function createApplicationSession(port: number): Promise<string> {
  const origin = `http://127.0.0.1:${port}`
  const response = await fetch(`${origin}/auth/session`, {
    method: 'POST',
    headers: { origin },
  })
  if (response.status !== 204) throw new Error(`Application session bootstrap failed (${response.status})`)
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie?.split(';', 1)[0]
  if (!cookie) throw new Error('Application session bootstrap did not set a cookie')
  return cookie
}
