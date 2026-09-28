import { readLogFailure, type Logger } from '@loom-studio/logging'
import { createId, type JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import { createErrorResponse, createSuccessResponse, parseRpcRequest } from '@loom-studio/transport'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AssetStore } from '@loom-studio/asset-store'
import type { ApplicationSession, ApplicationSessionAuth } from './application-session-auth.js'
import { isTechnicalRpc, summarizeRpc } from '../rpc/rpc-summary.js'
import type { StudioRpcRouter } from '../rpc/studio-rpc-router.js'
import { maxCardPngBytes } from '../codecs/card-png.js'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { maxRpcRequestBodyBytes, readRpcRequestBody, RpcRequestBodyTooLargeError } from './rpc-request-body.js'

export function createStudioHttpServer(options: {
  auth: ApplicationSessionAuth
  assets?: AssetStore
  canReadCardExtensionAsset?(input: { packageId: string; moduleId: string; cardId: string; assetId: string }): Promise<boolean>
  cardMedia?: {
    read(cardId: string, kind: 'avatar' | 'background'): Promise<{ bytes: Uint8Array; mediaType: string } | undefined>
  }
  cardPng?: {
    export(cardId: string): Promise<Uint8Array>
    import(source: Uint8Array, session: ApplicationSession): Promise<unknown>
    exportBundle(cardId: string): Promise<Uint8Array>
    importBundle(source: Uint8Array, session: ApplicationSession): Promise<unknown>
    exportPolyglot(cardId: string): Promise<Uint8Array>
  }
  extensionIcons?: {
    read(packageId: string, version: string): Promise<{ bytes: Uint8Array; mediaType: string } | undefined>
  }
  extensionFiles?: {
    read(packageId: string, version: string, path: string, installation?: { cardId: string; archiveDigest: string }): Promise<{ bytes: Uint8Array; mediaType: string }>
  }
  extensionEvents?: {
    subscribe(handler: (event: StudioEvent) => void): { dispose(): void | Promise<void> }
  }
  logger?: Logger
  rpcRouter: StudioRpcRouter
}): Server & { shutdown(): Promise<void> } {
  const requests = new Map<AbortController, Promise<void>>()
  let shutdownPromise: Promise<void> | undefined
  const server = createServer((request, response) => {
    if (shutdownPromise) {
      writeJson(response, 503, { error: { code: 'server.closing', message: 'Server is shutting down' } })
      return
    }
    const abort = new AbortController()
    const onClose = () => { if (!response.writableEnded) abort.abort() }
    response.once('close', onClose)
    const work = handleRequest(request, response, abort.signal).catch(error => {
      options.logger?.error('HTTP request failed', {
        event: 'http.request.failed',
        data: readLogFailure(error),
      })
      response.destroy(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => {
      response.off('close', onClose)
      requests.delete(abort)
    })
    requests.set(abort, work)
  })

  return Object.assign(server, {
    shutdown: () => shutdownPromise ??= stopAndDrain(),
  })

  async function stopAndDrain(): Promise<void> {
    const closed = server.listening
      ? new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
      : Promise.resolve()
    for (const abort of requests.keys()) abort.abort()
    server.closeAllConnections()
    // ponytail: Non-cooperative handlers must finish before stores close; add cancellation at their I/O boundary instead of a forced-close timeout.
    await Promise.all([closed, ...requests.values()])
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse, signal: AbortSignal): Promise<void> {
    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && request.url === '/auth/session') {
      if (!options.auth.bootstrap(request, response)) {
        writeJson(response, 403, { error: { code: 'auth.origin_forbidden', message: 'Request origin is not allowed' } })
      }
      return
    }

    const session = options.auth.authenticate(request)
    if (!session) {
      writeJson(response, 401, { error: { code: 'auth.unauthorized', message: 'Application session required' } })
      return
    }
    // Native clients and image/navigation requests may omit Origin; an explicit Origin must match.
    if (request.headers.origin !== undefined && !options.auth.hasAllowedOrigin(request)) {
      writeJson(response, 403, { error: { code: 'auth.origin_forbidden', message: 'Request origin is not allowed' } })
      return
    }

    const cardMedia = /^\/cards\/([A-Za-z0-9._-]+)\/media\/(avatar|background)(?:\?[^#]*)?$/.exec(request.url ?? '')
    if ((request.method === 'GET' || request.method === 'HEAD') && cardMedia && options.cardMedia) {
      await handleCardMedia(request, response, options.cardMedia, cardMedia[1]!, cardMedia[2] as 'avatar' | 'background')
      return
    }

    const cardPngExportId = readCardPngExportId(request.url)
    if (request.method === 'GET' && cardPngExportId && options.cardPng) {
      await handleCardPngExport(response, options.cardPng, cardPngExportId)
      return
    }

    const cardBundleExportId = readCardBundleExportId(request.url)
    if (request.method === 'GET' && cardBundleExportId && options.cardPng) {
      await handleCardFileExport(response, () => options.cardPng!.exportBundle(cardBundleExportId), 'application/vnd.loom.card+zip', 'loom-card.loomcard.zip')
      return
    }

    const cardPolyglotExportId = readCardPolyglotExportId(request.url)
    if (request.method === 'GET' && cardPolyglotExportId && options.cardPng) {
      await handleCardFileExport(response, () => options.cardPng!.exportPolyglot(cardPolyglotExportId), 'image/png', 'loom-card.polyglot.png')
      return
    }

    if (request.method === 'POST' && request.url === '/cards/import/png' && options.cardPng) {
      await handleCardPngImport(request, response, options.cardPng, session)
      return
    }

    if (request.method === 'POST' && request.url === '/cards/import/loomcard' && options.cardPng) {
      await handleCardFileImport(request, response, source => options.cardPng!.importBundle(source, session))
      return
    }

    if (request.method === 'GET' && request.url === '/extensions/events' && options.extensionEvents) {
      await handleExtensionEventStream(response, options.extensionEvents)
      return
    }

    const extensionIcon = readExtensionIconRequest(request.url)
    if (request.method === 'GET' && extensionIcon && options.extensionIcons) {
      await handleExtensionIcon(response, options.extensionIcons, extensionIcon)
      return
    }

    const extensionFile = readExtensionFileRequest(request.url)
    if (request.method === 'GET' && extensionFile && options.extensionFiles) {
      await handleExtensionFile(response, options.extensionFiles, extensionFile)
      return
    }

    if (options.assets && request.method === 'POST' && request.url === '/assets') {
      await handleAssetUpload(request, response, options.assets, session)
      return
    }

    const assetId = readAssetId(request.url)
    if (options.assets && assetId && (request.method === 'GET' || request.method === 'HEAD')) {
      await handleAssetRead(request, response, options.assets, assetId, signal)
      return
    }

    if (options.assets && request.url?.startsWith('/extension-assets/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const parts = request.url.split('/')
      let identity: { packageId: string; moduleId: string; cardId: string; assetId: string } | undefined
      try {
        if (parts.length === 6) {
          const [packageId, moduleId, cardId, id] = parts.slice(2).map(decodeURIComponent)
          if (packageId && moduleId && cardId && id && readAssetId(`/assets/${id}`)) identity = { packageId, moduleId, cardId, assetId: id }
        }
      } catch {
        // Malformed URL components are not asset identities.
      }
      if (!identity) {
        writeJson(response, 400, { error: { code: 'asset.invalid_scope', message: 'Invalid extension asset URL' } })
        return
      }
      if (!options.canReadCardExtensionAsset || !await options.canReadCardExtensionAsset(identity)) {
        writeJson(response, 403, { error: { code: 'asset.scope_denied', message: 'Asset is not available to this Card installation' } })
        return
      }
      await handleAssetRead(request, response, options.assets, identity.assetId, signal)
      return
    }

    if (request.method !== 'POST' || request.url !== '/rpc') {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } })
      return
    }

    if (readMediaType(request.headers['content-type']) !== 'application/json') {
      writeJson(response, 415, { error: { code: 'rpc.unsupported_media_type', message: 'RPC requires application/json' } })
      return
    }

    await handleRpcRequest(request, response, options.rpcRouter, session, signal, options.logger)
  }
}

async function handleCardMedia(
  request: IncomingMessage,
  response: ServerResponse,
  media: NonNullable<Parameters<typeof createStudioHttpServer>[0]['cardMedia']>,
  cardId: string,
  kind: 'avatar' | 'background',
): Promise<void> {
  try {
    const result = await media.read(cardId, kind)
    if (!result) {
      writeJson(response, 404, { error: { code: 'card.media_not_found', message: 'Card media not found' } })
      return
    }
    const etag = `"${createHash('sha256').update(result.bytes).digest('hex')}"`
    response.setHeader('content-type', result.mediaType)
    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('cache-control', 'no-cache')
    response.setHeader('etag', etag)
    const matches = request.headers['if-none-match']?.split(',').some(value => value.trim().replace(/^W\//, '') === etag || value.trim() === '*')
    if (matches) {
      response.writeHead(304)
      response.end()
      return
    }
    response.writeHead(200, { 'content-length': result.bytes.byteLength })
    response.end(request.method === 'HEAD' ? undefined : result.bytes)
  } catch (error) {
    writeJson(response, 400, { error: { code: 'card.media_invalid', message: error instanceof Error ? error.message : String(error) } })
  }
}

async function handleCardFileExport(
  response: ServerResponse,
  read: () => Promise<Uint8Array>,
  contentType: string,
  fileName: string,
): Promise<void> {
  try {
    const bytes = await read()
    response.writeHead(200, {
      'content-type': contentType,
      'content-length': bytes.byteLength,
      'content-disposition': `attachment; filename="${fileName}"`,
      'x-content-type-options': 'nosniff',
    })
    response.end(bytes)
  } catch (error) {
    writeCardPngError(response, error)
  }
}

async function handleCardFileImport(
  request: IncomingMessage,
  response: ServerResponse,
  importFile: (source: Uint8Array) => Promise<unknown>,
): Promise<void> {
  try {
    const source = await readBinaryRequestBody(request, 128 * 1024 * 1024)
    writeJson(response, 201, await importFile(source))
  } catch (error) {
    writeCardPngError(response, error)
  }
}

async function handleCardPngExport(
  response: ServerResponse,
  cards: NonNullable<Parameters<typeof createStudioHttpServer>[0]['cardPng']>,
  cardId: string,
): Promise<void> {
  try {
    const bytes = await cards.export(cardId)
    response.writeHead(200, {
      'content-type': 'image/png',
      'content-length': bytes.byteLength,
      'content-disposition': 'attachment; filename="loom-card.png"',
      'x-content-type-options': 'nosniff',
    })
    response.end(bytes)
  } catch (error) {
    writeCardPngError(response, error)
  }
}

async function handleCardPngImport(
  request: IncomingMessage,
  response: ServerResponse,
  cards: NonNullable<Parameters<typeof createStudioHttpServer>[0]['cardPng']>,
  session: ApplicationSession,
): Promise<void> {
  try {
    const source = await readBinaryRequestBody(request, maxCardPngBytes)
    writeJson(response, 201, await cards.import(source, session))
  } catch (error) {
    writeCardPngError(response, error)
  }
}

function readCardPngExportId(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined
  const match = /^\/cards\/([A-Za-z0-9._-]+)\/export\.png$/.exec(requestUrl)
  return match?.[1]
}

function readCardBundleExportId(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined
  return /^\/cards\/([A-Za-z0-9._-]+)\/export\.loomcard$/.exec(requestUrl)?.[1]
}

function readCardPolyglotExportId(requestUrl: string | undefined): string | undefined {
  if (!requestUrl) return undefined
  return /^\/cards\/([A-Za-z0-9._-]+)\/export\.polyglot\.png$/.exec(requestUrl)?.[1]
}

function writeCardPngError(response: ServerResponse, error: unknown): void {
  writeJson(response, 400, {
    error: {
      code: 'card.png_invalid',
      message: error instanceof Error ? error.message : String(error),
    },
  })
}

async function handleExtensionEventStream(
  response: ServerResponse,
  events: NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>,
): Promise<void> {
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

  await new Promise<void>((resolve, reject) => {
    response.once('close', () => {
      clearInterval(heartbeat)
      Promise.resolve().then(() => subscription.dispose()).then(resolve, reject)
    })
  })
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

async function handleExtensionFile(
  response: ServerResponse,
  files: NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionFiles']>,
  input: { packageId: string; version: string; path: string; installation?: { cardId: string; archiveDigest: string } },
): Promise<void> {
  try {
    const file = await files.read(input.packageId, input.version, input.path, input.installation)
    response.writeHead(200, {
      'content-type': file.mediaType,
      'content-length': file.bytes.byteLength,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(file.bytes)
  } catch (error) {
    writeJson(response, 404, {
      error: {
        code: 'extension.file_not_found',
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function readExtensionFileRequest(requestUrl: string | undefined): { packageId: string; version: string; path: string; installation?: { cardId: string; archiveDigest: string } } | undefined {
  if (!requestUrl) return undefined
  let pathname: string
  try {
    pathname = new URL(requestUrl, 'http://localhost').pathname
  } catch {
    return undefined
  }
  const privateMatch = /^\/card-extensions\/([^/]+)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._+-]+)\/([a-f0-9]{64})\/files\/(.+)$/.exec(pathname)
  if (privateMatch) {
    try {
      return {
        installation: { cardId: decodeURIComponent(privateMatch[1]!), archiveDigest: privateMatch[4]! },
        packageId: privateMatch[2]!, version: privateMatch[3]!, path: decodeURIComponent(privateMatch[5]!),
      }
    } catch {
      return undefined
    }
  }
  const match = /^\/extensions\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._+-]+)\/files\/(.+)$/.exec(pathname)
  if (!match) return undefined
  try {
    return { packageId: match[1]!, version: match[2]!, path: decodeURIComponent(match[3]!) }
  } catch {
    return undefined
  }
}

async function handleAssetUpload(
  request: IncomingMessage,
  response: ServerResponse,
  assets: AssetStore,
  session: ApplicationSession,
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
      actor: { kind: 'client', id: session.clientId },
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
  signal: AbortSignal,
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
    await pipeline(stream, response, { signal })
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
  session: ApplicationSession,
  signal: AbortSignal,
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
    signal?: AbortSignal
  } | undefined

  try {
    const body = await readRpcRequestBody(request, signal, maxRpcRequestBodyBytes)
    signal.throwIfAborted()
    const rpcRequest = parseRpcRequest(JSON.parse(body))
    rpcId = rpcRequest.id
    method = rpcRequest.method
    context = {
      clientId: session.clientId,
      correlationId: rpcRequest.meta?.correlationId ?? createId('corr'),
      callId: createId('call'),
      parentCallId: rpcRequest.meta?.parentCallId,
      signal,
    }
    const result = await rpcRouter.call(rpcRequest.method, rpcRequest.params, context)
    const durationMs = readDurationMs(startedAt)
    if (!method.startsWith('logs.')) {
      const summary = summarizeRpc(method, result)
      const messageText = summary.textSuffix
        ? `${method} · ${summary.textSuffix}`
        : `${method} completed`

      logger?.info(messageText, {
        event: 'rpc.completed',
        correlationId: context.correlationId,
        callId: context.callId,
        parentCallId: context.parentCallId,
        data: {
          method,
          transport: 'http',
          durationMs,
          outcome: 'success',
          technical: isTechnicalRpc(method),
          ...(summary.summaryData ?? {}),
        },
      })
    }
    const responseMeta = {
      clientId: context.clientId,
      correlationId: context.correlationId,
      callId: context.callId,
      durationMs,
      serverTime: new Date().toISOString(),
    }
    writeJson(response, 200, createSuccessResponse(rpcRequest.id, result, responseMeta))
  } catch (error) {
    if (method === 'logs.history' && signal.aborted) return
    const durationMs = readDurationMs(startedAt)
    const responseMeta = context ? {
      clientId: context.clientId,
      correlationId: context.correlationId,
      callId: context.callId,
      durationMs,
      serverTime: new Date().toISOString(),
    } : undefined

    const failure = readLogFailure(error)
    logger?.error(`${method} failed · ${failure.failureReason}`, {
      event: 'rpc.failed',
      correlationId: context?.correlationId,
      callId: context?.callId,
      parentCallId: context?.parentCallId,
      data: {
        method,
        transport: 'http',
        durationMs,
        outcome: 'failure',
        ...failure,
      },
    })
    const status = error instanceof RpcRequestBodyTooLargeError ? 413 : 200
    // Let HTTP flush the rejection before closing the unread request's connection.
    if (status === 413) response.setHeader('connection', 'close')
    writeJson(response, status, createErrorResponse(rpcId, error, 'rpc.invalid_request', responseMeta))
  }
}


function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

function readBinaryRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += bytes.byteLength
      if (size > maxBytes) {
        reject(new Error(`Card PNG exceeds ${maxBytes} bytes`))
        request.destroy()
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}
