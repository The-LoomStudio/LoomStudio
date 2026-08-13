import { createInMemoryDiagnosticsRegistry } from '../packages/diagnostics/src/index.js'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '../packages/document-store/src/index.js'
import { createExtensionHost } from '../packages/extension-sdk/extension-host/src/index.js'
import { createKernel, type Kernel } from '../packages/kernel/src/index.js'
import { createMemoryLogSink, createRootLogger } from '../packages/logging/src/index.js'
import { createLoomRunner } from '../packages/loom-runner/src/index.js'
import type { JsonValue } from '../packages/shared/src/index.js'
import { createInMemoryTraceAuditStore } from '../packages/trace-audit/src/index.js'
import type { StudioEvent } from '../packages/transport/src/index.js'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

let checks = 0

type WeatherStatus = {
  extensionId: string
  instanceId: string
  aborted: boolean
  grantedEventCapabilities: string[]
  documentVersion: number
  state: { temperatureC: number; revision: number } | null
  counters: {
    documentChanges: number
    publicEvents: number
    privateEvents: number
  }
}

const diagnostics = createInMemoryDiagnosticsRegistry()
const documents = createInMemoryDocumentStore()
const traceAudit = createInMemoryTraceAuditStore()
const loomRunner = createLoomRunner({ traceAudit })
const logs = createMemoryLogSink({ capacity: 200 })
const rootLogger = createRootLogger({ service: 'extension-verifier', instanceId: 'verifier-1', sinks: [logs] })
const observedEvents: StudioEvent[] = []
let kernel: Kernel

const extensionHost = createExtensionHost({
  documents,
  diagnostics,
  logger: rootLogger.child('extension.loader'),
  mode: 'test',
  grantEventCapabilities: manifest => manifest.capabilities?.['events.subscribe'] ?? [],
  callRpc: (method, params, context) => kernel.callRpc(method, params, context),
  registerRpc: (name, ownerExtensionId, handler, ownerInstanceId) => {
    const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler, ownerInstanceId)
    return { name, ownerExtensionId, ownerInstanceId, handler, dispose: handle.dispose }
  },
  registerEventDefinition: (definition, registeredBy) => kernel.getEventBus().registerDefinition(definition, registeredBy),
  emitEvent: (name, payload, publisher) => kernel.getEventBus().emit(name, payload, {
    publisher,
    source: publisher.kind === 'extension' ? `extension:${publisher.extensionId}` : publisher.kind,
  }),
  subscribeEvents: (patterns, handler, subscriber) => kernel.getEventBus().subscribe(patterns, handler, { subscriber }),
})

kernel = createKernel({
  documents,
  dataCommits: createDocumentDataCommitSource(documents),
  diagnostics,
  traceAudit,
  extensionHost,
  loomRunner,
  environment: 'test',
})

await kernel.start()
kernel.getEventBus().subscribe(['example.weatherStation.*', 'docs.changed'], event => observedEvents.push(event))

const extensionDirectory = resolve('extensions/weather-station')
const discovered = await extensionHost.discover(extensionDirectory)
assert(discovered.state === 'manifestValidated', 'extension discovery validates the manifest')

const firstActivation = await extensionHost.activate('example.weatherStation')
assert(firstActivation.state === 'active', 'extension activates without degradation')
const firstInstanceId = required(firstActivation.instance?.instanceId, 'first instanceId')

await flushEventHandlers()
const firstStatus = await kernel.callRpc<WeatherStatus>('example.weatherStation.status')
assert(firstStatus.extensionId === 'example.weatherStation', 'RPC receives trusted extension identity')
assert(firstStatus.instanceId === firstInstanceId, 'RPC receives current instance identity')
assert(firstStatus.aborted === false, 'activation AbortSignal remains active')
assert(firstStatus.grantedEventCapabilities.includes('documents'), 'manifest event capability is granted')
assert(firstStatus.grantedEventCapabilities.includes('extension:example.weatherStation'), 'private extension event capability is granted')
assert(firstStatus.state?.temperatureC === 20, 'extension initialized its owned document')
assert(firstStatus.counters.documentChanges === 1, 'extension consumed the platform docs.changed event')

const document = await documents.get('example.weatherStation:state')
assert(document?.meta.ownerExtensionId === 'example.weatherStation', 'document owner is bound by the Host')
assert(document?.meta.createdBy.kind === 'extension', 'document actor is bound by the Host')

const update = await kernel.callRpc<{
  state: { temperatureC: number; revision: number }
  eventId: string
  definitionVersion: number
}>('example.weatherStation.update', { temperatureC: 24 })
assert(update.state.temperatureC === 24 && update.state.revision === 2, 'extension RPC updates persisted state')
assert(update.definitionVersion === 1, 'published event carries definition version')

await flushEventHandlers()
const updatedStatus = await kernel.callRpc<WeatherStatus>('example.weatherStation.status')
assert(updatedStatus.counters.documentChanges === 2, 'platform event subscription remains active')
assert(updatedStatus.counters.publicEvents === 1, 'extension consumes its public event')
assert(updatedStatus.counters.privateEvents === 1, 'extension consumes its protected event with grant')
assert(observedEvents.some(event => event.name === 'example.weatherStation.updated'), 'platform subscriber observes extension public event')
assert(observedEvents.some(event => event.name === 'example.weatherStation.privateSnapshot'), 'platform subscriber observes extension protected event')

await kernel.callRpc('example.weatherStation.failSubscriber')
await Promise.resolve()
assert(diagnostics.list().some(item => item.code === 'event.subscriber_failed'), 'subscriber failure is isolated and reported')
const statusAfterFailure = await kernel.callRpc<WeatherStatus>('example.weatherStation.status')
assert(statusAfterFailure.counters.publicEvents === 2, 'failed subscriber did not unregister the extension')

expectThrow(
  () => kernel.getEventBus().emit('example.weatherStation.updated', {
    documentId: 'forged',
    temperatureC: 1,
    revision: 1,
  }),
  'platform cannot publish an extension-owned event',
)
expectThrow(
  () => kernel.getEventBus().emit('missing.event', {}),
  'unregistered event cannot be published',
)
expectThrow(
  () => kernel.getEventBus().emit('example.weatherStation.updated', {
    documentId: 'invalid-json',
    temperatureC: Number.NaN,
    revision: 1,
  }, {
    publisher: {
      kind: 'extension',
      extensionId: 'example.weatherStation',
      instanceId: firstInstanceId,
    },
  }),
  'event payload validator rejects non-finite JSON numbers',
)
await expectReject(
  () => kernel.callRpc('example.weatherStation.publishNote', { note: 'x'.repeat(256) }),
  'extension event enforces maxPayloadBytes at publish boundary',
)
expectThrow(
  () => kernel.getEventBus().subscribe(['docs.changed'], () => {}, {
    subscriber: {
      kind: 'extension',
      extensionId: 'example.untrusted',
      instanceId: 'untrusted-1',
      capabilities: [],
    },
  }),
  'protected platform event rejects an ungranted extension',
)

const firstDefinitions = kernel.getEventBus().definitions().filter(item => item.registeredBy.kind === 'extension')
assert(firstDefinitions.length === 3, 'runtime registry contains all extension event definitions')
assert(firstDefinitions.every(item => item.registeredBy.kind === 'extension' && item.registeredBy.instanceId === firstInstanceId), 'definitions belong to the first instance')

const failingExtensionDirectory = createFailingExtensionFixture()
await extensionHost.discover(failingExtensionDirectory)
const failedActivation = await extensionHost.activate('example.activationFailure')
assert(failedActivation.instance?.state === 'activation_failed', 'activation failure preserves a dedicated instance state')
await expectReject(() => kernel.callRpc('example.activationFailure.ping'), 'activation failure cleans partial RPC registration')
assert(!kernel.getEventBus().eventNames().includes('example.activationFailure.ready'), 'activation failure cleans partial event definition')

process.env.LOOM_WEATHER_TEST_FAIL_DISPOSE = '0'
const reloaded = await extensionHost.reload('example.weatherStation')
assert(reloaded.state === 'active', 'extension reload activates a fresh instance')
const secondInstanceId = required(reloaded.instance?.instanceId, 'second instanceId')
assert(secondInstanceId !== firstInstanceId, 'reload creates a new instanceId')

const secondDefinitions = kernel.getEventBus().definitions().filter(item => item.registeredBy.kind === 'extension')
assert(secondDefinitions.length === 3, 'reload does not duplicate event definitions')
assert(secondDefinitions.every(item => item.registeredBy.kind === 'extension' && item.registeredBy.instanceId === secondInstanceId), 'old cleanup does not remove new definitions')

const secondStatus = await kernel.callRpc<WeatherStatus>('example.weatherStation.status')
assert(secondStatus.instanceId === secondInstanceId, 'RPC points at the reloaded instance')
assert(secondStatus.counters.documentChanges === 0, 'reload does not recreate the existing document')

process.env.LOOM_WEATHER_TEST_FAIL_DISPOSE = '1'
const failingDisposeActivation = await extensionHost.reload('example.weatherStation')
const failingDisposeInstanceId = required(failingDisposeActivation.instance?.instanceId, 'failing dispose instanceId')
assert(failingDisposeInstanceId !== secondInstanceId, 'dispose-failure verification uses a fresh instance')

const thirdActivation = await verifyKernelStopCleanup(extensionHost, kernel)
assert(thirdActivation.instance?.instanceId !== failingDisposeInstanceId, 'kernel-stop verification creates a fresh recovery instance')

const disposeDiagnostics = diagnostics.list({ extensionId: 'example.weatherStation' }).filter(item => (
  item.instanceId === failingDisposeInstanceId
  && item.code.startsWith('example.weatherStation.dispose.')
))
assert(disposeDiagnostics.map(item => item.code).slice(-3).join(',') === [
  'example.weatherStation.dispose.last',
  'example.weatherStation.dispose.failure',
  'example.weatherStation.dispose.first',
].join(','), 'disposers execute in reverse order and continue after failure')
assert(disposeDiagnostics.every(item => item.instanceId === failingDisposeInstanceId), 'dispose diagnostics retain failing instance identity')
assert(diagnostics.list().some(item => item.code === 'extension.dispose_failed' && item.instanceId === failingDisposeInstanceId), 'dispose failure is aggregated and reported')

let finalDisposeRejected = false
try {
  await extensionHost.dispose('example.weatherStation')
} catch {
  finalDisposeRejected = true
}
assert(finalDisposeRejected, 'explicit dispose reports aggregated cleanup failure')
await expectReject(() => kernel.callRpc('example.weatherStation.status'), 'disposed RPC is removed')
assert(kernel.getEventBus().definitions().every(item => item.registeredBy.kind !== 'extension'), 'disposed event definitions are removed')
assert(extensionHost.list().find(item => item.id === 'example.weatherStation')?.instance?.state === 'dispose_failed', 'instance state preserves cleanup failure')

await extensionHost.dispose('example.weatherStation')
await kernel.stop()
await rootLogger.close()

const runtimeLogs = logs.list().filter(item => item.event === 'extension.runtime.log')
assert(runtimeLogs.some(item => item.data?.instanceId === firstInstanceId), 'extension logger includes first instance identity')
assert(runtimeLogs.some(item => item.data?.instanceId === secondInstanceId), 'extension logger includes reloaded instance identity')

console.log(`Server extension verification passed: ${checks} checks`)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${message}`)
  checks += 1
  console.log(`✓ ${message}`)
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Verification failed: missing ${label}`)
  return value
}

function expectThrow(callback: () => unknown, message: string): void {
  let threw = false
  try {
    callback()
  } catch {
    threw = true
  }
  assert(threw, message)
}

async function expectReject(callback: () => Promise<JsonValue>, message: string): Promise<void> {
  let rejected = false
  try {
    await callback()
  } catch {
    rejected = true
  }
  assert(rejected, message)
}

async function flushEventHandlers(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function createFailingExtensionFixture(): string {
  const directory = resolve('.loomstudio-dev/server-extension-verifier/activation-failure')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(join(directory, 'dist'), { recursive: true })
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 1,
    id: 'example.activationFailure',
    version: '0.0.0',
    displayName: 'Activation Failure Test Extension',
    engines: { studio: '^0.1.0' },
    server: { entry: './dist/index.js' },
    contributes: {
      rpc: [{ name: 'example.activationFailure.ping' }],
      events: [{ name: 'example.activationFailure.ready', version: 1, visibility: 'public' }],
    },
  }))
  writeFileSync(join(directory, 'dist/index.js'), `
export function activate(ctx) {
  ctx.events.define({
    name: 'example.activationFailure.ready',
    version: 1,
    visibility: 'public',
    summary: 'Partial activation event',
    stability: 'experimental'
  })
  ctx.rpc.register('example.activationFailure.ping', () => ({ ok: true }))
  throw new Error('intentional activation failure')
}
`)
  return directory
}

async function verifyKernelStopCleanup(
  host: typeof extensionHost,
  activeKernel: Kernel,
): Promise<Awaited<ReturnType<typeof host.reload>>> {
  let disposeRejected = false
  try {
    await activeKernel.stop()
  } catch {
    disposeRejected = true
  }
  assert(disposeRejected, 'kernel stop surfaces extension cleanup failure')
  await expectReject(() => activeKernel.callRpc('example.weatherStation.status'), 'kernel stop removes extension RPC')
  assert(activeKernel.getEventBus().definitions().every(item => item.registeredBy.kind !== 'extension'), 'kernel stop removes extension event definitions')

  await activeKernel.start()
  const activation = await host.activate('example.weatherStation')
  assert(activation.state === 'active', 'kernel can start and reactivate an extension after failed cleanup')
  return activation
}
