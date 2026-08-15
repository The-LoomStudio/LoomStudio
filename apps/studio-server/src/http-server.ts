import type { Logger } from '@loom-studio/logging'
import { createId, type JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import { createErrorResponse, createSuccessResponse, parseRpcRequest } from '@loom-studio/transport'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { StudioRpcRouter } from './studio-rpc-router.js'

export function createStudioHttpServer(options: {
  assets?: AssetStore
  extensionIcons?: {
    read(packageId: string, version: string): Promise<{ bytes: Uint8Array; mediaType: string } | undefined>
  }
  extensionEvents?: {
    subscribe(handler: (event: StudioEvent) => void): { dispose(): void | Promise<void> }
  }
  logger?: Logger
  rpcRouter: StudioRpcRouter
}): Server {
  return createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && request.url === '/extensions/events' && options.extensionEvents) {
      handleExtensionEventStream(request, response, options.extensionEvents)
      return
    }

    const extensionIcon = readExtensionIconRequest(request.url)
    if (request.method === 'GET' && extensionIcon && options.extensionIcons) {
      await handleExtensionIcon(response, options.extensionIcons, extensionIcon)
      return
    }

    if (options.assets && request.method === 'POST' && request.url === '/assets') {
      await handleAssetUpload(request, response, options.assets)
      return
    }

    const assetId = readAssetId(request.url)
    if (options.assets && assetId && (request.method === 'GET' || request.method === 'HEAD')) {
      await handleAssetRead(request, response, options.assets, assetId)
      return
    }

    if (request.method !== 'POST' || request.url !== '/rpc') {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }

    await handleRpcRequest(request, response, options.rpcRouter, options.logger)
  })
}

function handleExtensionEventStream(
  request: IncomingMessage,
  response: ServerResponse,
  events: NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>,
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  })
  response.write(': connected\n\n')
  const subscription = events.subscribe(event => {
    if (response.destroyed || response.writableEnded) return
    response.write(`event: ${event.name}\n`)
    response.write(`id: ${event.meta.eventId}\n`)
    response.write(`data: ${JSON.stringify(event as unknown as JsonValue)}\n\n`)
  })
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': heartbeat\n\n')
  }, 15_000)
  heartbeat.unref()

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    void subscription.dispose()
  }
  request.once('close', close)
  response.once('close', close)
}

async function handleExtensionIcon(
  response: ServerResponse,
  icons: NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionIcons']>,
  input: { packageId: string; version: string },
): Promise<void> {
  try {
    const icon = await icons.read(input.packageId, input.version)
    if (!icon) {
      writeJson(response, 404, { error: { code: 'extension.icon_not_found', message: 'Extension icon not found' } })
      return
    }
    response.writeHead(200, {
      'content-type': icon.mediaType,
      'content-length': icon.bytes.byteLength,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    response.end(icon.bytes)
  } catch (error) {
    writeJson(response, 400, {
      error: {
        code: 'extension.icon_invalid',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function readExtensionIconRequest(requestUrl: string | undefined): { packageId: string; version: string } | undefined {
  if (!requestUrl) return undefined
  const match = /^\/extensions\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._+-]+)\/icon$/.exec(requestUrl)
  return match ? { packageId: match[1]!, version: match[2]! } : undefined
}

async function handleAssetUpload(
  request: IncomingMessage,
  response: ServerResponse,
  assets: AssetStore,
): Promise<void> {
  try {
    const kind = readRequiredHeader(request, 'x-loom-asset-kind')
    const mediaType = readMediaType(request.headers['content-type'])
    const contentLength = readContentLength(request.headers['content-length'])
    const maxBytes = 64 * 1024 * 1024
    if (contentLength !== undefined && contentLength > maxBytes) {
      writeJson(response, 413, { error: { code: 'asset.too_large', message: `Asset exceeds ${maxBytes} bytes` } })
      return
    }
    const result = await assets.createMediaAsset({
      source: request,
      kind,
      label: readOptionalHeader(request, 'x-loom-asset-label'),
      mediaType,
      maxBytes,
      actor: { kind: 'client', id: 'http-local' },
      reason: 'assets.http.upload',
    })
    writeJson(response, 201, {
      asset: result.asset,
      url: `/assets/${encodeURIComponent(result.asset.id)}`,
      mutation: { changesetId: result.commit.changesetId },
    })
  } catch (error) {
    writeAssetError(response, error)
  }
}

async function handleAssetRead(
  request: IncomingMessage,
  response: ServerResponse,
  assets: AssetStore,
  assetId: string,
): Promise<void> {
  try {
    const asset = await assets.getMediaAsset(assetId)
    if (!asset) {
      writeJson(response, 404, { error: { code: 'asset.not_found', message: `Media Asset not found: ${assetId}` } })
      return
    }
    response.writeHead(200, {
      'content-type': asset.mediaType ?? 'application/octet-stream',
      'content-length': asset.sizeBytes,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = await assets.openMediaAsset(assetId)
    stream.on('error', error => response.destroy(error))
    stream.pipe(response)
  } catch (error) {
    if (!response.headersSent) writeAssetError(response, error)
    else response.destroy(error instanceof Error ? error : new Error(String(error)))
  }
}

function readAssetId(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined
  const match = /^\/assets\/([A-Za-z0-9._-]+)$/.exec(requestUrl)
  return match?.[1]
}

function readRequiredHeader(request: IncomingMessage, name: string): string {
  const value = readOptionalHeader(request, name)
  if (!value) throw Object.assign(new Error(`Missing header: ${name}`), { code: 'asset.invalid_request' })
  return value
}

function readOptionalHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0]?.trim() || undefined
  return value?.trim() || undefined
}

function readMediaType(value: string | string[] | undefined): string | undefined {
  const source = Array.isArray(value) ? value[0] : value
  return source?.split(';', 1)[0]?.trim().toLowerCase() || undefined
}

function readContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw Object.assign(new Error('Invalid content-length header'), { code: 'asset.invalid_request' })
  }
  return parsed
}

function writeAssetError(response: ServerResponse, error: unknown): void {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'asset.invalid_request'
  const status = code === 'blob.too_large' || code === 'asset.too_large'
    ? 413
    : code === 'asset.not_found' || code === 'blob.not_found'
      ? 404
      : 400
  writeJson(response, status, {
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
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
import type { AssetStore } from '@loom-studio/asset-store'
