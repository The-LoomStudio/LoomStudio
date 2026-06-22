import { createId } from '@loom-studio/shared'
import { createErrorResponse, createSuccessResponse, parseRpcRequest } from '@loom-studio/transport'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { RendererPocService } from './renderer-poc.js'
import type { StudioRpcRouter } from './studio-rpc-router.js'

export function createStudioHttpServer(options: {
  rendererPoc: RendererPocService
  rpcRouter: StudioRpcRouter
}): Server {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && request.url?.startsWith('/renderer/events')) {
      options.rendererPoc.handleEventsRequest(request, response)
      return
    }

    if (request.method !== 'POST' || request.url !== '/rpc') {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }

    await handleRpcRequest(request, response, options.rpcRouter)
  })
}

async function handleRpcRequest(
  request: IncomingMessage,
  response: ServerResponse,
  rpcRouter: StudioRpcRouter,
): Promise<void> {
  let rpcId: string | number | null = null

  try {
    const body = await readRequestBody(request)
    const rpcRequest = parseRpcRequest(JSON.parse(body))
    rpcId = rpcRequest.id
    const context = {
      clientId: 'http-local',
      correlationId: rpcRequest.meta?.correlationId ?? createId('corr'),
      callId: createId('call'),
      parentCallId: rpcRequest.meta?.parentCallId,
    }
    const result = await rpcRouter.call(rpcRequest.method, rpcRequest.params, context)
    writeJson(response, 200, createSuccessResponse(rpcRequest.id, result, context))
  } catch (error) {
    writeJson(response, 200, createErrorResponse(rpcId, error, 'rpc.invalid_request'))
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
