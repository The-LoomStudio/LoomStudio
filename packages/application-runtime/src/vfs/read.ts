import type { VfsEntry, VfsReadObservation } from './types.js'
import { formatVfsReference } from './reference.js'

const maxReadChars = 16 * 1024

export function vfsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

export function vfsPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')
    || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || value.includes('//')
    || value.split('/').some(part => part === '.' || part === '..')) {
    throw vfsError('vfs.invalid_path', 'Use an absolute virtual path returned by ctx.ls or ctx.search; traversal is not supported.')
  }
  return value === '/' ? value : value.replace(/\/+$/, '')
}

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) {
    throw vfsError('vfs.invalid_options', `Options must be an object with only: ${keys.join(', ')}.`)
  }
  return value as Record<string, unknown>
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
    throw vfsError('vfs.invalid_range', `Expected an integer from ${min} to ${max}.`)
  return value
}

function find(entries: readonly VfsEntry[], path: string): VfsEntry {
  const entry = entries.find(item => item.path === path)
  if (!entry) throw vfsError('vfs.not_found', `Path unavailable: ${path}. Use ctx.ls to discover this invocation's accessible view.`)
  return entry
}

export function listVfs(entries: readonly VfsEntry[], args: unknown[]): string {
  if (args.length > 2) throw vfsError('vfs.invalid_arguments', 'Use ctx.ls(path?, { offset?, limit? }?).')
  const path = vfsPath(args[0] ?? '/')
  const options = record(args[1], ['offset', 'limit'])
  const offset = integer(options.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = integer(options.limit, 50, 1, 100)
  const entry = find(entries, path)
  if (entry.kind !== 'directory') throw vfsError('vfs.not_directory', 'Use ctx.read for a file.')
  const prefix = path === '/' ? '/' : `${path}/`
  const children = entries.filter(item => item.path.startsWith(prefix)
    && item.path !== path && !item.path.slice(prefix.length).includes('/'))
  const rows = children.slice(offset, offset + limit).map(item =>
    `  ${item.path.slice(prefix.length)}${item.kind === 'directory' ? '/' : ''}${item.state ? ` [${item.state}]` : ''}`,
  )
  return [
    path, ...rows,
    ...(offset + limit < children.length ? [`More entries: ctx.ls(${JSON.stringify(path)}, { offset: ${offset + limit} })`] : []),
  ].join('\n')
}

export function readVfs(entries: readonly VfsEntry[], args: unknown[]): { text: string; observation: VfsReadObservation } {
  if (args.length < 1 || args.length > 2) throw vfsError('vfs.invalid_arguments', 'Use ctx.read(path, { startLine?, endLine? }?).')
  const path = vfsPath(args[0])
  const options = record(args[1], ['startLine', 'endLine'])
  const entry = find(entries, path)
  if (entry.state === 'locked') throw vfsError('vfs.locked', 'This resource is visible but not readable in the current scope.')
  if (entry.kind !== 'file') throw vfsError('vfs.not_file', 'List the directory before choosing a file.')
  const lines = entry.content!.split('\n')
  const startLine = integer(options.startLine, 1, 1, lines.length)
  const requestedEnd = integer(options.endLine, lines.length, startLine, lines.length)
  const selected: string[] = []
  let size = 0
  for (let line = startLine; line <= requestedEnd; line++) {
    const text = lines[line - 1]!
    if (size + text.length + (selected.length ? 1 : 0) > maxReadChars) break
    size += text.length + (selected.length ? 1 : 0)
    selected.push(text)
  }
  if (!selected.length) throw vfsError('vfs.line_too_large', 'This line exceeds the read budget. Narrow the resource upstream; no partial line was returned.')
  return {
    text: selected.join('\n'),
    observation: {
      path, startLine, endLine: startLine + selected.length - 1, totalLines: lines.length,
      ...(entry.binding ? { binding: entry.binding } : {}),
    },
  }
}

export function searchVfs(entries: readonly VfsEntry[], args: unknown[]): string {
  if (args.length !== 1) throw vfsError('vfs.invalid_arguments', 'Use ctx.search({ path, terms, match?, limit? }).')
  const options = record(args[0], ['path', 'terms', 'match', 'limit'])
  const path = vfsPath(options.path ?? '/')
  const target = find(entries, path)
  if (!Array.isArray(options.terms) || !options.terms.length || options.terms.length > 8
    || !options.terms.every(term => typeof term === 'string' && term.length > 0 && term.length <= 128)) {
    throw vfsError('vfs.invalid_terms', 'Provide 1-8 nonempty literal terms, each at most 128 characters.')
  }
  const terms = (options.terms as string[]).map(term => term.toLocaleLowerCase())
  const match = options.match ?? 'all'
  if (match !== 'all' && match !== 'any') throw vfsError('vfs.invalid_match', 'match must be all or any.')
  const limit = integer(options.limit, 5, 1, 20)
  const hits: string[] = []
  let more = false
  const prefix = path === '/' ? '/' : `${path}/`
  for (const entry of entries) {
    if (entry.kind !== 'file' || entry.state === 'locked'
      || (target.kind === 'file' ? entry.path !== path : !entry.path.startsWith(prefix))) continue
    const content = entry.content!.toLocaleLowerCase()
    if (!(match === 'all' ? terms.every(term => content.includes(term)) : terms.some(term => content.includes(term)))) continue
    const lines = entry.content!.split('\n')
    const lineIndex = lines.findIndex(line => terms.some(term => line.toLocaleLowerCase().includes(term)))
    const start = Math.max(0, lineIndex - 1)
    const end = Math.min(lines.length, lineIndex + 2)
    if (hits.length >= limit) {
      more = true
      break
    }
    const reference = formatVfsReference({
      path: entry.path, startLine: start + 1, endLine: end, totalLines: lines.length,
      ...(entry.binding ? { binding: entry.binding } : {}),
    })
    hits.push(`${entry.path}:${start + 1}-${end}\n${lines.slice(start, end).map((line, index) =>
      `${start + index + 1}: ${line.slice(0, 240)}${line.length > 240 ? ' [line truncated]' : ''}`).join('\n')}`)
    if (reference) hits[hits.length - 1] += `\nReference: [打开引用](${reference})`
  }
  return [`Scope: ${path}`, ...(hits.length ? hits : ['No matches in the accessible view.']),
    ...(more ? ['More matching files; narrow path or terms.'] : [])].join('\n')
}
