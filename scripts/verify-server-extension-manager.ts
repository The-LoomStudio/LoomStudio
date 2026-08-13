import { createStudioServer } from '../apps/studio-server/src/main.js'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let checks = 0
const stateDirectory = mkdtempSync(join(tmpdir(), 'loom-extension-manager-'))
const extensionDirectory = mkdtempSync(join(tmpdir(), 'loom-extension-manager-sources-'))

try {
  prepareExtensionSources(extensionDirectory)
  const firstServer = createStudioServer({
    sqlitePath: ':memory:',
    extensionRootDirectory: extensionDirectory,
    extensionStateDirectory: stateDirectory,
  })
  const firstAddress = await firstServer.listen(0)
  const firstEndpoint = `http://127.0.0.1:${firstAddress.port}/rpc`

  const initial = await callRpc<{ items: ManagedExtension[] }>(firstEndpoint, 'extensions.list')
  const initialEcho = required(initial.items.find(item => item.id === 'example.echo'), 'initial example.echo summary')
  assert(initialEcho.desired.enabled === false, 'newly discovered extension defaults to disabled')
  assert(initialEcho.runtime?.instance === undefined, 'disabled extension is not activated during startup')
  assert(!initial.items.some(item => item.id === 'example.escape'), 'extension with an escaping server entry is rejected')
  const conflicting = required(initial.items.find(item => item.id === 'example.conflict'), 'conflicting extension summary')
  assert(conflicting.available === false, 'duplicate extension id from different directories is unavailable')

  await expectRpcError(firstEndpoint, 'extensions.enable', {
    extensionId: 'example.echo',
    grants: { 'events.subscribe': ['documents'] },
  }, 'unrequested event grant is rejected')

  const enabled = await callRpc<{ extension: ManagedExtension }>(firstEndpoint, 'extensions.enable', {
    extensionId: 'example.echo',
  })
  const firstInstanceId = required(enabled.extension.runtime?.instance?.instanceId, 'first instanceId')
  assert(enabled.extension.desired.enabled === true, 'enable persists desired state')
  assert(enabled.extension.runtime?.instance?.state === 'active', 'enable activates the extension')

  const enabledAgain = await callRpc<{ extension: ManagedExtension }>(firstEndpoint, 'extensions.enable', {
    extensionId: 'example.echo',
  })
  assert(enabledAgain.extension.runtime?.instance?.instanceId === firstInstanceId, 'repeated enable with unchanged grants does not reload')

  const echo = await callRpc<{ extensionId: string; echo: { value: string } }>(firstEndpoint, 'example.echo.echo', {
    value: 'hello',
  })
  assert(echo.extensionId === 'example.echo' && echo.echo.value === 'hello', 'enabled extension RPC is callable')

  const reloaded = await callRpc<{ extension: ManagedExtension }>(firstEndpoint, 'extensions.reload', {
    extensionId: 'example.echo',
  })
  const secondInstanceId = required(reloaded.extension.runtime?.instance?.instanceId, 'reloaded instanceId')
  assert(secondInstanceId !== firstInstanceId, 'reload creates a new extension instance')

  const disabled = await callRpc<{ extension: ManagedExtension }>(firstEndpoint, 'extensions.disable', {
    extensionId: 'example.echo',
  })
  assert(disabled.extension.desired.enabled === false, 'disable persists desired state')
  await expectRpcError(firstEndpoint, 'example.echo.echo', {}, 'disable removes extension RPC registrations')

  await callRpc(firstEndpoint, 'extensions.enable', { extensionId: 'example.echo' })
  await firstServer.close()

  const secondServer = createStudioServer({
    sqlitePath: ':memory:',
    extensionRootDirectory: resolve('extensions'),
    extensionStateDirectory: stateDirectory,
  })
  const secondAddress = await secondServer.listen(0)
  const secondEndpoint = `http://127.0.0.1:${secondAddress.port}/rpc`
  const restored = await callRpc<{ items: ManagedExtension[] }>(secondEndpoint, 'extensions.list')
  const restoredEcho = required(restored.items.find(item => item.id === 'example.echo'), 'restored example.echo summary')
  assert(restoredEcho.desired.enabled === true, 'enabled state survives server recreation')
  assert(restoredEcho.runtime?.instance?.state === 'active', 'enabled extension activates on the next startup')
  await callRpc(secondEndpoint, 'example.echo.echo', { persisted: true })
  assert(true, 'restored extension RPC is callable')
  await secondServer.close()

  console.log(`Server extension manager verification passed: ${checks} checks`)
} finally {
  rmSync(stateDirectory, { recursive: true, force: true })
  rmSync(extensionDirectory, { recursive: true, force: true })
}

type ManagedExtension = {
  id: string
  available: boolean
  desired: {
    enabled: boolean
  }
  runtime?: {
    instance?: {
      instanceId: string
      state: string
    }
  }
}

function prepareExtensionSources(directory: string): void {
  copyExtension(resolve('extensions/example-echo'), join(directory, 'example-echo'))
  writeExtension(join(directory, 'conflict-a'), 'example.conflict')
  writeExtension(join(directory, 'conflict-b'), 'example.conflict')
  const escapeDirectory = join(directory, 'escape')
  mkdirSync(escapeDirectory, { recursive: true })
  writeFileSync(join(escapeDirectory, 'manifest.json'), JSON.stringify({
    manifestVersion: 1,
    id: 'example.escape',
    version: '0.0.0',
    displayName: 'Escape',
    engines: { studio: '^0.1.0' },
    server: { entry: '../outside.js' },
  }))
  writeFileSync(join(directory, 'outside.js'), 'export const activate = () => {}\n')
}

function copyExtension(source: string, destination: string): void {
  mkdirSync(join(destination, 'dist'), { recursive: true })
  writeFileSync(join(destination, 'manifest.json'), readText(join(source, 'manifest.json')))
  writeFileSync(join(destination, 'dist/index.js'), readText(join(source, 'dist/index.js')))
}

function writeExtension(directory: string, id: string): void {
  mkdirSync(join(directory, 'dist'), { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 1,
    id,
    version: '0.0.0',
    displayName: id,
    engines: { studio: '^0.1.0' },
    server: { entry: './dist/index.js' },
  }))
  writeFileSync(join(directory, 'dist/index.js'), 'export const activate = () => {}\n')
}

function readText(filename: string): string {
  return readFileSync(filename, 'utf8')
}

async function callRpc<T = unknown>(endpoint: string, method: string, params?: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${method}-${checks}`, method, params }),
  })
  const body = await response.json() as { result?: T; error?: { message?: string } }
  if (body.error) throw new Error(body.error.message ?? `RPC failed: ${method}`)
  return body.result as T
}

async function expectRpcError(endpoint: string, method: string, params: unknown, message: string): Promise<void> {
  let rejected = false
  try {
    await callRpc(endpoint, method, params)
  } catch {
    rejected = true
  }
  assert(rejected, message)
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Verification failed: missing ${label}`)
  return value
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${message}`)
  checks += 1
  console.log(`✓ ${message}`)
}
