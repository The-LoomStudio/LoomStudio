import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'

const mediaTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}
const apiPrefixes = ['/auth', '/rpc', '/health', '/assets', '/cards', '/extensions', '/extension-assets']

export async function serveClientFile(
  directory: string,
  request: IncomingMessage,
  response: ServerResponse,
  signal: AbortSignal,
): Promise<boolean> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400).end()
    return true
  }
  if (apiPrefixes.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
    response.writeHead(400).end()
    return true
  }

  const isPage = pathname === '/' || pathname === '/studio'
    || (pathname.startsWith('/studio/') && !extname(pathname) && request.headers.accept?.includes('text/html'))
  const root = await realpath(directory)
  const candidate = resolve(root, isPage ? 'index.html' : `.${pathname}`)
  try {
    const filename = await realpath(candidate)
    const path = relative(root, filename)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      response.writeHead(403).end()
      return true
    }
    const file = await stat(filename)
    if (!file.isFile()) {
      response.writeHead(404).end()
      return true
    }
    response.writeHead(200, {
      'content-type': mediaTypes[extname(filename)] ?? 'application/octet-stream',
      'content-length': file.size,
      'cache-control': pathname.startsWith('/app-assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    })
    if (request.method === 'HEAD') response.end()
    else await pipeline(createReadStream(filename), response, { signal })
  } catch (error) {
    if (!response.headersSent && ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      response.writeHead(404).end()
    } else {
      throw error
    }
  }
  return true
}
