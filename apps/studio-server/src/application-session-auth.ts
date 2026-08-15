import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

const cookieName = 'loom_studio_session'

export type ApplicationSession = {
  clientId: string
  sessionId: string
}

export type ApplicationSessionAuth = {
  authenticate(request: IncomingMessage): ApplicationSession | undefined
  bootstrap(request: IncomingMessage, response: ServerResponse): boolean
}

export function createApplicationSessionAuth(options: { allowedOrigins?: string[] } = {}): ApplicationSessionAuth {
  const token = randomBytes(32).toString('base64url')
  const sessionId = randomUUID()
  const allowedOrigins = new Set((options.allowedOrigins ?? []).map(normalizeAllowedOrigin))
  const session = {
    clientId: `session:${sessionId}`,
    sessionId,
  }

  return {
    authenticate: request => {
      const candidate = readCookie(request, cookieName)
      return candidate && safeEqual(candidate, token) ? session : undefined
    },
    bootstrap: (request, response) => {
      if (!hasAllowedOrigin(request, allowedOrigins)) return false
      const secure = request.headers.origin?.startsWith('https://') ?? false
      response.writeHead(204, {
        'cache-control': 'no-store',
        'set-cookie': serializeSessionCookie(token, secure),
      })
      response.end()
      return true
    },
  }
}

function hasAllowedOrigin(request: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (!origin || Array.isArray(origin) || !host) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && isLoopbackHostname(parsed.hostname)
      && (parsed.host === host || allowedOrigins.has(parsed.origin))
  } catch {
    return false
  }
}

function normalizeAllowedOrigin(origin: string): string {
  const parsed = new URL(origin)
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopbackHostname(parsed.hostname) || parsed.origin !== origin) {
    throw new Error(`Application session allowed origin must be an exact loopback origin: ${origin}`)
  }
  return parsed.origin
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie
  if (!header) return undefined
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=')
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue
    return entry.slice(separator + 1).trim() || undefined
  }
  return undefined
}

function safeEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return candidateBytes.byteLength === expectedBytes.byteLength && timingSafeEqual(candidateBytes, expectedBytes)
}

function serializeSessionCookie(token: string, secure: boolean): string {
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/${secure ? '; Secure' : ''}`
}
