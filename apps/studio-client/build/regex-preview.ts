import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import type { RegexLabRequest } from '../src/dev-preview/regex-lab-contract.js'

/** Development-only, same-origin native harness. Never points at the user's Studio database. */
export function regexPreview(): Plugin {
  return { name: 'loom-native-regex-preview', apply: 'serve', configureServer(server) {
    let runtime: Promise<Awaited<ReturnType<typeof import('../../../scripts/dev/regex-preview-runtime.js')['createRegexPreviewRuntime']>>> | undefined
    let queue: Promise<unknown> = Promise.resolve()
    server.httpServer?.once('close', () => { void runtime?.then(value => value.close()) })
    server.middlewares.use('/__dev/regex-lab', (req, res) => {
      const allowed = req.method === 'POST' && req.headers.origin
        && new URL(req.headers.origin).host === req.headers.host
        && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(req.headers.origin).hostname)
      if (!allowed) { res.statusCode = 403; res.end('Same-origin development requests only'); return }
      void (async () => {
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > 1_000_000) throw new Error('Preview request exceeds 1 MB')
          chunks.push(Buffer.from(chunk))
        }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as RegexLabRequest
        if (!input || !['state', 'install', 'project', 'commit', 'preview'].includes(input.action)) throw new Error('Unknown preview action')
        if ((input.action === 'project' || input.action === 'commit' || input.action === 'preview') && (typeof input.text !== 'string' || input.text.length > 100_000)) throw new Error('Invalid preview text')
        if (input.action === 'project' && typeof input.streaming !== 'boolean') throw new Error('Invalid streaming flag')
        if (input.action === 'install' && (typeof input.caseId !== 'string' || !Array.isArray(input.sources) || input.sources.length > 12 || input.sources.some(source => typeof source !== 'string'))) throw new Error('Invalid preview sources')
        if (input.action === 'preview' && (typeof input.source !== 'string' || !['display', 'prompt', 'classify'].includes(input.phase) || (input.streaming !== undefined && typeof input.streaming !== 'boolean'))) throw new Error('Invalid source preview')
        runtime ??= server.ssrLoadModule(fileURLToPath(new URL('../../../scripts/dev/regex-preview-runtime.ts', import.meta.url)))
          .then(module => module.createRegexPreviewRuntime(fileURLToPath(new URL('../../../.artifacts/regex-preview', import.meta.url))))
        const operation = queue.then(async () => (await runtime!).handle(input))
        queue = operation.catch(() => {})
        const result = await operation
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(result))
      })().catch(error => { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) })
    })
  } }
}
