import type { Logger } from '@loom-studio/logging'
import { createId } from '@loom-studio/shared'
import { createErrorResponse, createSuccessResponse, parseRpcRequest } from '@loom-studio/transport'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { StudioRpcRouter } from './studio-rpc-router.js'

export function createStudioHttpServer(options: {
  logger?: Logger
  rpcRouter: StudioRpcRouter
}): Server {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method !== 'POST' || request.url !== '/rpc') {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }

    await handleRpcRequest(request, response, options.rpcRouter, options.logger)
  })
}

async function handleRpcRequest(
  request: IncomingMessage,
  response: ServerResponse,
  rpcRouter: StudioRpcRouter,
  logger?: Logger,
): Promise<void> {
  const startedAt = performance.now()
  let rpcId: string | number | null = null
  let method = 'unknown'
  let context: {
    clientId: string
    correlationId: string
    callId: string
    parentCallId?: string
  } | undefined

  try {
    const body = await readRequestBody(request)
    const rpcRequest = parseRpcRequest(JSON.parse(body))
    rpcId = rpcRequest.id
    method = rpcRequest.method
    context = {
      clientId: 'http-local',
      correlationId: rpcRequest.meta?.correlationId ?? createId('corr'),
      callId: createId('call'),
      parentCallId: rpcRequest.meta?.parentCallId,
    }
    const result = await rpcRouter.call(rpcRequest.method, rpcRequest.params, context)
    const durationMs = readDurationMs(startedAt)
    if (method !== 'logs.list') {
      logger?.info(`${method} completed in ${durationMs} ms`, {
        event: 'rpc.completed',
        correlationId: context.correlationId,
        callId: context.callId,
        parentCallId: context.parentCallId,
        data: {
          method,
          transport: 'http',
          durationMs,
          outcome: 'success',
        },
      })
    }
    writeJson(response, 200, createSuccessResponse(rpcRequest.id, result, context))
  } catch (error) {
    const durationMs = readDurationMs(startedAt)
    logger?.error(`${method} failed after ${durationMs} ms`, {
      event: 'rpc.failed',
      correlationId: context?.correlationId,
      callId: context?.callId,
      parentCallId: context?.parentCallId,
      data: {
        method,
        transport: 'http',
        durationMs,
        outcome: 'failure',
        failureType: error instanceof Error ? error.name : 'UnknownError',
        ...readErrorCode(error),
      },
    })
    writeJson(response, 200, createErrorResponse(rpcId, error, 'rpc.invalid_request'))
  }
}

function readErrorCode(error: unknown): { errorCode?: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? { errorCode: error.code }
    : {}
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
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
