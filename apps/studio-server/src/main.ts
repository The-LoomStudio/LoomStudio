import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import type { LoomRunner } from '@loom-studio/loom-runner'
import { createErrorResponse, createSuccessResponse, parseRpcRequest } from '@loom-studio/transport'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

const defaultPort = 4173

export type StudioServer = {
  listen(port?: number): Promise<{ port: number }>
  close(): Promise<void>
}

export function createStudioServer(): StudioServer {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const extensionHost: ExtensionHost = {
    list: () => [],
    diagnostics: () => [],
  }
  const loomRunner: LoomRunner = {
    run: async input => ({
      fragments: input.fragments,
      diagnostics: [],
    }),
  }
  const kernel = createKernel({
    documents,
    diagnostics,
    extensionHost,
    loomRunner,
  })
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method !== 'POST' || request.url !== '/rpc') {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }

    await handleRpcRequest(request, response, kernel)
  })

  return {
    listen: async (port = defaultPort) => {
      await kernel.start()
      await new Promise<void>(resolve => {
        server.listen(port, resolve)
      })
      const address = server.address()
      const actualPort = typeof address === 'object' && address ? address.port : port
      return { port: actualPort }
    },
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      })
      await kernel.stop()
    },
  }
}

export async function main(): Promise<void> {
  const server = createStudioServer()
  const port = Number(process.env.PORT ?? defaultPort)
  const result = await server.listen(port)
  console.log(`Loom Studio server listening on ${result.port}`)
}

async function handleRpcRequest(request: IncomingMessage, response: ServerResponse, kernel: Awaited<ReturnType<typeof createKernel>>): Promise<void> {
  try {
    const body = await readRequestBody(request)
    const rpcRequest = parseRpcRequest(JSON.parse(body))
    const result = await kernel.callRpc(rpcRequest.method, rpcRequest.params)
    writeJson(response, 200, createSuccessResponse(rpcRequest.id, result))
  } catch (error) {
    writeJson(response, 200, createErrorResponse(null, error, 'rpc.invalid_request'))
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
