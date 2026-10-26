import type { ClientExtensionModule, ExtensionRegistrationHandle } from '@loom-studio/extension-sdk'
import { createWorkerHostBridge } from './host-bridge.js'
import { isFrameRecord } from '../iframe-runtime/frame-channel.js'

export type ClientWorkerModuleInput = { entryUrl: string } | { source: string }
// Internal host lifecycle signal; no callable host objects cross the Worker boundary.
export type ClientWorkerHandle = ExtensionRegistrationHandle & { failure: Promise<Error> }

/** One dedicated thread per activation. This isolates execution, not network or storage authority. */
export function createClientWorkerModule(input: ClientWorkerModuleInput): ClientExtensionModule {
  return {
    activate(context) {
      if (context.signal.aborted) return Promise.reject(new Error('Worker activation cancelled'))
      const worker = new Worker(new URL('./worker-entry.ts', import.meta.url), { type: 'module', name: context.extension.instanceId })
      const channel = new MessageChannel()
      const port = channel.port1
      const bridge = createWorkerHostBridge(port, context)
      let stopping = false
      let terminated = false
      let started = false
      let stopTimer: ReturnType<typeof setTimeout> | undefined
      let resolveStopped!: () => void
      const stopped = new Promise<void>(resolve => { resolveStopped = resolve })
      let rejectActivation!: (error: Error) => void
      let resolveFailure!: (error: Error) => void
      const failure = new Promise<Error>(resolve => { resolveFailure = resolve })
      let resolveActivation!: (handle: ClientWorkerHandle) => void
      const activation = new Promise<ClientWorkerHandle>((resolve, reject) => { resolveActivation = resolve; rejectActivation = reject })
      const startTimer = setTimeout(() => fail(new Error('Worker activation timed out')), 10_000)
      function diagnostic(error: unknown) {
        context.logger.error('Worker runtime failed', { error: error instanceof Error ? error.message : String(error) })
      }
      function terminate() {
        if (terminated) return
        terminated = true
        clearTimeout(startTimer)
        clearTimeout(stopTimer)
        bridge.dispose()
        context.signal.removeEventListener('abort', stop)
        worker.removeEventListener('error', onError)
        worker.removeEventListener('messageerror', onMessageError)
        port.removeEventListener('message', receive)
        port.removeEventListener('messageerror', onMessageError)
        port.close()
        channel.port2.close()
        worker.terminate()
        resolveStopped()
      }
      function stop() {
        if (stopping || terminated) return stopped
        stopping = true
        clearTimeout(startTimer)
        // Reject and revoke host calls before asking guest code to clean up.
        bridge.dispose()
        if (!started) rejectActivation(new Error('Worker activation cancelled'))
        stopTimer = setTimeout(terminate, 250)
        try { port.postMessage({ type: 'loom:worker.stop' }) } catch (error) { diagnostic(error); terminate() }
        return stopped
      }
      function fail(error: Error) {
        if (terminated) return
        diagnostic(error)
        if (!started) rejectActivation(error)
        else if (!stopping) resolveFailure(error)
        // Startup failure and crashed threads cannot be trusted to run a cleanup handshake.
        terminate()
      }
      function onError(event: ErrorEvent) { event.preventDefault(); fail(new Error(event.message || 'Worker execution failed')) }
      function onMessageError() { fail(new Error('Worker message could not be deserialized')) }
      function receive(event: MessageEvent) {
        const message: unknown = event.data
        if (!isFrameRecord(message) || terminated) return
        switch (message.type) {
          case 'loom:worker.ready':
            if (stopping || started) return
            started = true
            clearTimeout(startTimer)
            resolveActivation({ failure, dispose: async () => { await stop() } })
            break
          case 'loom:worker.stopped': if (stopping) terminate(); break
          case 'loom:worker.failed': fail(new Error(typeof message.message === 'string' ? message.message : 'Worker activation failed')); break
          case 'loom:worker.diagnostic': diagnostic(typeof message.message === 'string' ? message.message : 'Invalid Worker diagnostic'); break
        }
      }
      worker.addEventListener('error', onError)
      worker.addEventListener('messageerror', onMessageError)
      port.addEventListener('message', receive)
      port.addEventListener('messageerror', onMessageError)
      context.signal.addEventListener('abort', stop, { once: true })
      try {
        const resolvedInput = 'entryUrl' in input ? { entryUrl: new URL(input.entryUrl, globalThis.location.href).href } : input
        worker.postMessage({ type: 'loom:worker.connect', input: resolvedInput, extension: context.extension, scriptSettings: context.scriptSettings }, [channel.port2])
        if (context.signal.aborted) void stop()
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
      return activation
    },
  }
}
