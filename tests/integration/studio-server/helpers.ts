import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function withStudioServer<T>(run: (port: number, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'loom-server-'))
  const server = createStudioServer({ sqlitePath: join(dir, 'store.sqlite') })

  try {
    const { port } = await server.listen(0)
    return await run(port, dir)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}

export async function callRpc<T>(port: number, method: string, params: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
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
