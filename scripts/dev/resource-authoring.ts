import { parseArgs } from 'node:util'
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { watch } from 'node:fs'
import { resolve, join } from 'node:path'
import { authoringStateSchema, type AuthoringState, type AuthoringResource } from '../../packages/shared/src/resource-authoring-contracts.js'
import { loadResourceAuthoring, writeResourceAuthoring } from '../../apps/studio-server/src/codecs/resource-authoring.js'

type Snapshot = { resource: AuthoringResource; version: number; digest: string }
class CommandError extends Error { constructor(message: string, readonly exitCode = 1) { super(message) } }
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  endpoint: { type: 'string' }, resource: { type: 'string' }, create: { type: 'boolean' }, json: { type: 'boolean' },
} })
const [command, ...paths] = positionals
const directories = paths.map(path => resolve(path))
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, values.json ? undefined : 2)}\n`)
function exitCode(error: unknown): number {
  return error instanceof CommandError ? error.exitCode : (error instanceof Error && (error.name === 'ZodError' || /resource.yaml|composition\.xml|frontmatter|authoring/i.test(error.message))) ? 2 : 1
}
function report(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write((values.json ? JSON.stringify({ error: { message, exitCode: exitCode(error) } }) : message) + '\n')
}
const statePath = (directory: string) => join(directory, '.loom', 'authoring-state.json')
async function readState(directory: string): Promise<AuthoringState | undefined> {
  try { return authoringStateSchema.parse(JSON.parse(await readFile(statePath(directory), 'utf8'))) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function saveState(directory: string, endpoint: string, snapshot: Snapshot) {
  const filename = statePath(directory)
  await mkdir(join(directory, '.loom'), { recursive: true })
  const state: AuthoringState = { schemaVersion: 1, endpoint, resources: [{ directory: '.', resourceId: snapshot.resource.id, version: snapshot.version, digest: snapshot.digest }] }
  await writeFile(`${filename}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  await rename(`${filename}.tmp`, filename)
}
function endpointUrl(value: string) {
  if (!value) throw new CommandError('Supply --endpoint for an unbound directory', 2)
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new CommandError('Endpoint must be a loopback HTTP origin')
  return url.origin
}
async function connect(endpoint: string) {
  const headers: Record<string, string> = { Origin: endpoint, 'Content-Type': 'application/json' }
  const session = await fetch(`${endpoint}/auth/session`, { method: 'POST', headers, redirect: 'error' })
  if (!session.ok) throw new CommandError(`Authentication failed: ${session.status}`)
  const cookie = session.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new CommandError('Authentication did not return a session cookie')
  headers.Cookie = cookie
  return async <T>(method: string, input: unknown): Promise<T> => {
    const response = await fetch(`${endpoint}/trpc/application.${method}`, { method: 'POST', headers, body: JSON.stringify(input), redirect: 'error' })
    const body = await response.json() as { result?: { data: T }; error?: { message?: string; data?: { code?: string; domainCode?: string } } }
    if (!response.ok || body.error) {
      const message = body.error?.message ?? `RPC failed: ${response.status}`
      const conflict = response.status === 409 || /conflict|stale/i.test(body.error?.data?.domainCode ?? '') || /conflict|snapshot changed/i.test(message)
      throw new CommandError(message, conflict ? 3 : 1)
    }
    if (!body.result) throw new CommandError('Invalid RPC response')
    return body.result.data
  }
}
async function main() {
  if (!['check', 'export', 'diff', 'apply', 'watch'].includes(command ?? '') || !directories.length) {
    throw new CommandError('Usage: resource-authoring <check|export|diff|apply|watch> <directory...> [--endpoint http://127.0.0.1:18010] [--resource ID] [--create] [--json]', 2)
  }
  if (new Set(directories).size !== directories.length) throw new CommandError('Duplicate directory', 2)
  if (command === 'check') {
    for (const directory of directories) { const resource = await loadResourceAuthoring(directory); output({ directory, resourceId: resource.id, valid: true, scope: 'offline-structure' }) }
    return
  }
  const states = await Promise.all(directories.map(readState))
  const endpoint = endpointUrl(values.endpoint ?? states[0]?.endpoint ?? '')
  if (states.some(state => state && endpointUrl(state.endpoint) !== endpoint)) throw new CommandError('Directory is bound to a different endpoint', 2)
  const rpc = await connect(endpoint)
  if (command === 'export') {
    if (directories.length !== 1 || !values.resource) throw new CommandError('export requires one directory and --resource ID', 2)
    const snapshot = await rpc<Snapshot>('captureResourceAuthoring', { resourceId: values.resource })
    await writeResourceAuthoring(directories[0]!, snapshot.resource)
    await saveState(directories[0]!, endpoint, snapshot)
    output({ directory: directories[0], resourceId: snapshot.resource.id, version: snapshot.version })
    return
  }
  if (values.create && command !== 'apply') throw new CommandError('--create is only allowed for apply', 2)
  const run = async () => {
    const resources = await Promise.all(directories.map(async directory => {
      const resource = await loadResourceAuthoring(directory)
      const state = await readState(directory)
      if (values.create) {
        if (state) throw new CommandError('--create refuses an already bound directory', 2)
        return { resource, create: true as const }
      }
      const binding = state?.resources.find(item => item.directory === '.' && item.resourceId === resource.id)
      if (!binding || !state || endpointUrl(state.endpoint) !== endpoint) throw new CommandError(`Directory is not bound to this resource and endpoint: ${directory}`, 2)
      return { resource, expectedVersion: binding.version, expectedDigest: binding.digest }
    }))
    if (command === 'diff') { output(await rpc('diffResourceAuthoring', { resources })); return }
    const result = await rpc<{ resources: Snapshot[] }>('applyResourceAuthoring', { resources })
    try {
      for (const [index, item] of resources.entries()) {
        const snapshot = result.resources.find(value => value.resource.id === item.resource.id)
        if (!snapshot) throw new Error(`Missing committed resource: ${item.resource.id}`)
        await saveState(directories[index]!, endpoint, snapshot)
      }
    } catch (error) {
      throw new CommandError(`Database committed but local binding could not be saved. Do not repeat --create; export committed IDs to a new directory to recover. ${String(error)}`)
    }
    output({ applied: result.resources.map(({ resource, version, digest }) => ({ resourceId: resource.id, version, digest })) })
  }
  if (command !== 'watch') { await run(); return }
  let stopped = false, pending = false, running = false, timer: ReturnType<typeof setTimeout> | undefined
  const watchers: ReturnType<typeof watch>[] = []
  const close = () => { stopped = true; if (timer) clearTimeout(timer); for (const watcher of watchers) watcher.close() }
  const drain = async () => {
    if (running || stopped) return
    running = true
    try {
      while (pending && !stopped) {
        pending = false
        try { await run() } catch (error) {
          report(error)
          if (error instanceof CommandError && error.exitCode === 3) { process.exitCode = 3; close() }
        }
      }
    } finally { running = false }
  }
  for (const directory of directories) watchers.push(watch(directory, { recursive: true }, (_event, filename) => {
    if (filename?.toString().split(/[\\/]/).includes('.loom')) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { pending = true; void drain() }, 250)
  }))
  for (const watcher of watchers) watcher.on('error', error => { report(error); process.exitCode = 1; close() })
  process.once('SIGINT', close); process.once('SIGTERM', close)
  pending = true
  await drain()
}
main().catch(error => {
  report(error)
  process.exitCode = exitCode(error)
})
