import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClientExtensionActivationContext } from '../../../packages/extension-sdk/src/index.js'
import { createFrameRequestClient } from '../../../packages/extension-sdk/src/iframe-context.js'
import { createClientWorkerModule } from '../../../apps/studio-client/src/shared/worker-runtime/client-worker-module.js'
import { createWorkerContext } from '../../../apps/studio-client/src/shared/worker-runtime/worker-context.js'
import { createWorkerHostBridge } from '../../../apps/studio-client/src/shared/worker-runtime/host-bridge.js'

const resources: Array<() => void> = []
afterEach(() => { for (const dispose of resources.splice(0)) dispose(); vi.unstubAllGlobals(); vi.useRealTimers() })
function fixture() {
  const controller = new AbortController()
  const logger = { log: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() }
  logger.child.mockReturnValue(logger)
  const subscriptionDispose = vi.fn()
  const context = {
    extension: { packageId: 'test', moduleId: 'worker', instanceId: crypto.randomUUID(), displayName: 'Test', version: '1' },
    signal: controller.signal, logger, timeline: { target: undefined },
    notifications: { show: vi.fn(async () => {}) },
    state: { get: vi.fn(async () => ({ revisionId: '1' })), subscribe: vi.fn(() => ({ dispose: subscriptionDispose })) },
    configs: { subscribe: vi.fn(() => ({ dispose: subscriptionDispose })) },
    rpc: { call: vi.fn(async () => 'ok') },
  } as unknown as ClientExtensionActivationContext
  return { controller, context, subscriptionDispose, logger }
}
function connected() {
  const fixtureValue = fixture()
  const channel = new MessageChannel()
  const host = createWorkerHostBridge(channel.port1, fixtureValue.context)
  const guest = createWorkerContext(channel.port2, fixtureValue.context.extension)
  resources.push(() => { host.dispose(); guest.dispose(); channel.port1.close(); channel.port2.close() })
  return { ...fixtureValue, channel, host, guest }
}
class StubWorker extends EventTarget {
  static instances: StubWorker[] = []
  port?: MessagePort
  input?: unknown
  terminate = vi.fn()
  constructor(_url: URL, readonly options: WorkerOptions) { super(); StubWorker.instances.push(this) }
  postMessage(message: { input: unknown }, ports: MessagePort[]) {
    this.input = message.input
    this.port = ports[0]
    resources.push(() => this.port?.close())
  }
  ready() { this.port!.postMessage({ type: 'loom:worker.ready' }) }
}
function workerFixture() {
  StubWorker.instances = []
  vi.stubGlobal('Worker', StubWorker)
  return fixture()
}

// These exercise real MessagePorts and the shared request client, without evaluating guest source on the host.
describe('Dedicated Worker bridge', () => {
  it('propagates host permission errors and denies non-Worker APIs', async () => {
    const { guest, context, channel } = connected()
    vi.mocked(context.rpc.call).mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'permission.denied' }))
    await expect(guest.context.rpc.call('private')).rejects.toMatchObject({ code: 'permission.denied' })
    const raw = createFrameRequestClient(channel.port2)
    resources.push(raw.dispose)
    await expect(raw.request('imports.commit', 'session')).rejects.toMatchObject({ code: 'ctx.denied' })
    await expect(raw.request('state.get', { scope: 'timeline', timelineId: [] })).rejects.toMatchObject({ code: 'ctx.invalid' })
    expect(context.state.get).not.toHaveBeenCalled()
  })

  it('delivers state/config subscriptions, diagnoses callback failures and removes handles once', async () => {
    const { guest, context, subscriptionDispose, channel } = connected()
    const diagnostics: unknown[] = []
    channel.port1.addEventListener('message', event => { if (event.data.type === 'loom:worker.diagnostic') diagnostics.push(event.data) })
    const handler = vi.fn(() => { throw new Error('callback broke') })
    const state = await guest.context.state.subscribe({ scope: 'global' }, handler)
    const configs = await guest.context.configs.subscribe({}, vi.fn())
    const stateCallback = vi.mocked(context.state.subscribe).mock.calls[0][1]
    await stateCallback({ revisionId: '2' } as never)
    await vi.waitFor(() => expect(diagnostics).toEqual([expect.objectContaining({ message: 'callback broke' })]))
    await state.dispose()
    await state.dispose()
    await configs.dispose()
    expect(subscriptionDispose).toHaveBeenCalledTimes(2)
  })

  it('revokes pending calls and subscriptions on abort, dropping late replies', async () => {
    const { guest, context, controller, subscriptionDispose, channel } = connected()
    await guest.context.state.subscribe({ scope: 'global' }, vi.fn())
    const slow = Promise.withResolvers<never>()
    vi.mocked(context.rpc.call).mockImplementation(() => slow.promise)
    const pending = guest.context.rpc.call('slow')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ctx.disposed' })
    await vi.waitFor(() => expect(context.rpc.call).toHaveBeenCalledOnce())
    const send = vi.spyOn(channel.port1, 'postMessage')
    controller.abort()
    await rejected
    slow.resolve('late' as never)
    await Promise.resolve(); await Promise.resolve()
    expect(subscriptionDispose).toHaveBeenCalledOnce()
    expect(send.mock.calls.some(([data]) => data.type === 'loom:ctx.result')).toBe(false)
    await expect(guest.context.rpc.call('new')).rejects.toMatchObject({ code: 'ctx.disposed' })
  })

  it('releases a handle if its registration synchronously aborts the owner', async () => {
    const { guest, context, controller, subscriptionDispose } = connected()
    vi.mocked(context.state.subscribe).mockImplementation(() => { controller.abort(); return { dispose: subscriptionDispose } })
    await expect(guest.context.state.subscribe({ scope: 'global' }, vi.fn())).rejects.toMatchObject({ code: 'ctx.disposed' })
    expect(subscriptionDispose).toHaveBeenCalledOnce()
  })

  it('isolates concurrent instances and their replies', async () => {
    const a = connected(), b = connected()
    vi.mocked(a.context.rpc.call).mockResolvedValue('A' as never)
    vi.mocked(b.context.rpc.call).mockResolvedValue('B' as never)
    expect(await Promise.all([a.guest.context.rpc.call('get'), b.guest.context.rpc.call('get')])).toEqual(['A', 'B'])
  })
})

describe('Dedicated Worker lifecycle', () => {
  it('creates one module Worker, leaves source unevaluated and completes the cleanup handshake', async () => {
    const { context } = workerFixture()
    const source = 'throw new Error("must not execute on main thread")'
    const activation = createClientWorkerModule({ source }).activate(context)
    expect(StubWorker.instances).toHaveLength(1)
    const worker = StubWorker.instances[0]
    expect(worker.options.type).toBe('module')
    expect(worker.input).toEqual({ source })
    worker.ready()
    const handle = await activation
    worker.port!.addEventListener('message', event => { if (event.data.type === 'loom:worker.stop') worker.port!.postMessage({ type: 'loom:worker.stopped' }) })
    worker.port!.start()
    await handle!.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates a Worker that never becomes ready', async () => {
    vi.useFakeTimers()
    const { context } = workerFixture()
    const activation = createClientWorkerModule({ source: 'while (true) {}' }).activate(context)
    const rejected = expect(activation).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await rejected
    expect(StubWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })

  it('bounds a noncooperative cleanup and cancels startup on owner abort', async () => {
    vi.useFakeTimers()
    const { context, controller } = workerFixture()
    const activation = createClientWorkerModule({ source: '' }).activate(context)
    const rejected = expect(activation).rejects.toThrow('cancelled')
    controller.abort()
    await rejected
    expect(StubWorker.instances[0].terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(250)
    expect(StubWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })

  it('diagnoses and reclaims startup failures and malformed messages', async () => {
    const { context, logger } = workerFixture()
    const activation = createClientWorkerModule({ source: '' }).activate(context)
    const rejected = expect(activation).rejects.toThrow('could not be deserialized')
    StubWorker.instances[0].dispatchEvent(new Event('messageerror'))
    await rejected
    expect(logger.error).toHaveBeenCalledOnce()
    expect(StubWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })
})
