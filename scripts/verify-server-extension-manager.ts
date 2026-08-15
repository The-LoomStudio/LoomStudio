import { createStudioServer } from '../apps/studio-server/src/main.js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  const initial = await listPackages(firstEndpoint)
  const multi = required(initial.find(item => item.packageId === 'example.multi'), 'example.multi package')
  const alpha = required(multi.modules.find(item => item.moduleId === 'alpha'), 'alpha module')
  const beta = required(multi.modules.find(item => item.moduleId === 'beta'), 'beta module')
  assert(!alpha.desired.enabled && !beta.desired.enabled, 'new server modules default to disabled independently')
  assert(!alpha.runtime?.instance && !beta.runtime?.instance, 'disabled server modules have no runtime instance')
  assert(initial.some(item => item.packageId === 'example.clientOnly' && item.modules[0]?.runtimeKind === 'client'), 'client-only package is discovered')
  const resourceOnly = required(initial.find(item => item.packageId === 'example.resourceOnly'), 'resource-only package')
  assert(resourceOnly.modules.length === 0 && resourceOnly.resources.transformRules.length === 1, 'resource-only package exposes resources without runtime modules')
  assert(!initial.some(item => item.packageId === 'example.escape'), 'package with an escaping module entry is rejected')
  assert(!initial.some(item => item.packageId === 'example.duplicateModule'), 'package with duplicate module ids is rejected')
  assert(required(initial.find(item => item.packageId === 'example.conflict'), 'conflicting package').available === false, 'duplicate package source is unavailable')

  await expectRpcError(firstEndpoint, 'extensions.enableModule', {
    packageId: 'example.multi',
    moduleId: 'alpha',
    grants: { 'events.subscribe': ['documents'] },
  }, 'unrequested event grant is rejected per module')

  const enabledAlpha = await enableModule(firstEndpoint, 'alpha', ['diagnostics'])
  const alphaInstanceId = required(enabledAlpha.runtime?.instance?.instanceId, 'alpha instanceId')
  assert(enabledAlpha.desired.enabled && enabledAlpha.desired.grants['events.subscribe'][0] === 'diagnostics', 'alpha state and grant are persisted')
  assert((await callRpc<{ moduleId: string }>(firstEndpoint, 'example.multi.alpha')).moduleId === 'alpha', 'alpha RPC is callable')
  await expectRpcError(firstEndpoint, 'example.multi.beta', {}, 'enabling alpha does not activate beta')

  const enabledBeta = await enableModule(firstEndpoint, 'beta', ['documents'])
  const betaInstanceId = required(enabledBeta.runtime?.instance?.instanceId, 'beta instanceId')
  assert(enabledBeta.desired.grants['events.subscribe'][0] === 'documents', 'sibling module keeps an independent grant')
  assert((await callRpc<{ moduleId: string }>(firstEndpoint, 'example.multi.beta')).moduleId === 'beta', 'beta RPC is callable after independent enable')

  const failedSibling = await enableModule(firstEndpoint, 'broken', [])
  assert(failedSibling.runtime?.instance?.state === 'activation_failed', 'one sibling can preserve an activation failure state')
  assert((await callRpc<{ moduleId: string }>(firstEndpoint, 'example.multi.beta')).moduleId === 'beta', 'sibling activation failure does not interrupt an active module')

  const reloadedAlpha = await callRpc<{ module: ManagedModule }>(firstEndpoint, 'extensions.reloadModule', {
    packageId: 'example.multi',
    moduleId: 'alpha',
  })
  assert(reloadedAlpha.module.runtime?.instance?.instanceId !== alphaInstanceId, 'reload creates a fresh alpha instance')
  const afterReload = required((await listPackages(firstEndpoint)).find(item => item.packageId === 'example.multi'), 'reloaded package')
  assert(required(afterReload.modules.find(item => item.moduleId === 'beta'), 'beta after alpha reload').runtime?.instance?.instanceId === betaInstanceId, 'reloading alpha does not replace beta instance')

  await callRpc(firstEndpoint, 'extensions.disableModule', { packageId: 'example.multi', moduleId: 'alpha' })
  await expectRpcError(firstEndpoint, 'example.multi.alpha', {}, 'disabling alpha removes only alpha RPC')
  assert((await callRpc<{ moduleId: string }>(firstEndpoint, 'example.multi.beta')).moduleId === 'beta', 'disabling alpha leaves beta RPC active')
  await firstServer.close()

  const secondServer = createStudioServer({
    sqlitePath: ':memory:',
    extensionRootDirectory: extensionDirectory,
    extensionStateDirectory: stateDirectory,
  })
  const secondAddress = await secondServer.listen(0)
  const secondEndpoint = `http://127.0.0.1:${secondAddress.port}/rpc`
  const restored = required((await listPackages(secondEndpoint)).find(item => item.packageId === 'example.multi'), 'restored package')
  const restoredAlpha = required(restored.modules.find(item => item.moduleId === 'alpha'), 'restored alpha')
  const restoredBeta = required(restored.modules.find(item => item.moduleId === 'beta'), 'restored beta')
  assert(!restoredAlpha.desired.enabled && !restoredAlpha.runtime?.instance, 'disabled alpha state survives restart')
  assert(restoredBeta.desired.enabled && restoredBeta.runtime?.instance?.state === 'active', 'enabled beta state restores and activates after restart')
  assert(restoredBeta.desired.grants['events.subscribe'][0] === 'documents', 'beta grant survives restart independently')
  await callRpc(secondEndpoint, 'example.multi.beta')
  assert(true, 'restored beta RPC is callable')
  await secondServer.close()

  console.log(`Server extension manager verification passed: ${checks} checks`)
} finally {
  rmSync(stateDirectory, { recursive: true, force: true })
  rmSync(extensionDirectory, { recursive: true, force: true })
}

type ManagedModule = {
  packageId: string
  moduleId: string
  runtimeKind: 'server' | 'client'
  desired: {
    enabled: boolean
    grants: { 'events.subscribe': string[] }
  }
  runtime?: {
    instance?: { instanceId: string; state: string }
  }
}

type ManagedPackage = {
  packageId: string
  available: boolean
  modules: ManagedModule[]
  resources: { transformRules: Array<{ source: string }> }
}

async function listPackages(endpoint: string): Promise<ManagedPackage[]> {
  return (await callRpc<{ items: ManagedPackage[] }>(endpoint, 'extensions.listPackages')).items
}

async function enableModule(endpoint: string, moduleId: string, grants: string[]): Promise<ManagedModule> {
  const result = await callRpc<{ module: ManagedModule }>(endpoint, 'extensions.enableModule', {
    packageId: 'example.multi',
    moduleId,
    grants: { 'events.subscribe': grants },
  })
  return result.module
}

function prepareExtensionSources(directory: string): void {
  writePackage(join(directory, 'multi'), {
    manifestVersion: 2,
    id: 'example.multi',
    version: '0.0.0',
    displayName: 'Multi Module',
    engines: { studio: '^0.1.0' },
    modules: [
      moduleManifest('alpha', './dist/alpha.js', ['diagnostics'], 'example.multi.alpha'),
      moduleManifest('beta', './dist/beta.js', ['documents'], 'example.multi.beta'),
      moduleManifest('broken', './dist/broken.js'),
    ],
  }, {
    'alpha.js': moduleSource('alpha', 'example.multi.alpha'),
    'beta.js': moduleSource('beta', 'example.multi.beta'),
    'broken.js': "export function activate() { throw new Error('intentional sibling activation failure') }\n",
  })
  writePackage(join(directory, 'client-only'), {
    manifestVersion: 2,
    id: 'example.clientOnly',
    version: '0.0.0',
    displayName: 'Client Only',
    engines: { studio: '^0.1.0' },
    modules: [{ id: 'panel', runtime: 'client', entry: './dist/panel.js' }],
  }, { 'panel.js': 'export function activate() {}\n' })
  writePackage(join(directory, 'resource-only'), {
    manifestVersion: 2,
    id: 'example.resourceOnly',
    version: '0.0.0',
    displayName: 'Resource Only',
    engines: { studio: '^0.1.0' },
    contributes: { transformRules: [{ source: './resources/clean.rule.json' }] },
  }, {}, { 'clean.rule.json': '{}\n' })
  writePackage(join(directory, 'conflict-a'), packageManifest('example.conflict'))
  writePackage(join(directory, 'conflict-b'), packageManifest('example.conflict'))
  writePackage(join(directory, 'duplicate-module'), {
    ...packageManifest('example.duplicateModule'),
    modules: [moduleManifest('server', './dist/index.js'), moduleManifest('server', './dist/index.js')],
  }, { 'index.js': 'export function activate() {}\n' })
  writePackage(join(directory, 'escape'), {
    ...packageManifest('example.escape'),
    modules: [moduleManifest('server', '../outside.js')],
  })
  writeFileSync(join(directory, 'outside.js'), 'export function activate() {}\n')
}

function packageManifest(id: string) {
  return { manifestVersion: 2, id, version: '0.0.0', displayName: id, engines: { studio: '^0.1.0' }, modules: [] }
}

function moduleManifest(id: string, entry: string, grants: string[] = [], rpc?: string) {
  return {
    id,
    runtime: 'server',
    entry,
    ...(grants.length ? { capabilities: { 'events.subscribe': grants } } : {}),
    ...(rpc ? { contributes: { rpc: [{ name: rpc }] } } : {}),
  }
}

function moduleSource(moduleId: string, rpc: string): string {
  return `export function activate(ctx) { ctx.rpc.register('${rpc}', () => ({ packageId: ctx.extension.packageId, moduleId: '${moduleId}', instanceId: ctx.extension.instanceId })) }\n`
}

function writePackage(
  directory: string,
  manifest: unknown,
  dist: Record<string, string> = {},
  resources: Record<string, string> = {},
): void {
  mkdirSync(join(directory, 'dist'), { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
  for (const [filename, source] of Object.entries(dist)) writeFileSync(join(directory, 'dist', filename), source)
  if (Object.keys(resources).length) mkdirSync(join(directory, 'resources'), { recursive: true })
  for (const [filename, source] of Object.entries(resources)) writeFileSync(join(directory, 'resources', filename), source)
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
