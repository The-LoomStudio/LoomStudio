import type { ExtensionRegistrationHandle, WorkerExtensionModule } from '@loom-studio/extension-sdk'
import { createWorkerContext } from './worker-context.js'

// This module is only loaded by a module Worker. Guest imports must stay in this thread.
self.addEventListener('message', function connect(event: MessageEvent) {
  if (event.data?.type !== 'loom:worker.connect' || !event.ports[0]) return
  self.removeEventListener('message', connect)
  const port = event.ports[0]
  const { context, dispose } = createWorkerContext(port, event.data.extension)
  let guest: ExtensionRegistrationHandle | void
  let stopping = false
  let blobUrl: string | undefined
  const fatal = (error: unknown) => {
    port.postMessage({ type: 'loom:worker.failed', message: error instanceof Error ? error.message : String(error) })
    dispose()
  }
  self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => { event.preventDefault(); fatal(event.reason) })
  self.addEventListener('messageerror', () => fatal(new Error('Worker message could not be deserialized')))
  port.addEventListener('messageerror', () => fatal(new Error('Worker context message could not be deserialized')))
  port.addEventListener('message', async (event: MessageEvent) => {
    if (event.data?.type !== 'loom:worker.stop' || stopping) return
    stopping = true
    dispose()
    try {
      // The host bounds this wait: a pending activate may still return its cleanup handle.
      await activationTask
      await guest?.dispose()
    } catch (error) {
      port.postMessage({ type: 'loom:worker.diagnostic', message: error instanceof Error ? error.message : String(error) })
    } finally { port.postMessage({ type: 'loom:worker.stopped' }) }
  })
  const activationTask = (async () => {
    try {
      let url: string
      if ('source' in event.data.input) {
        blobUrl = URL.createObjectURL(new Blob([event.data.input.source], { type: 'text/javascript' }))
        url = blobUrl
      } else {
        const entry = new URL(event.data.input.entryUrl)
        // Preserve the package directory for relative imports while forcing a fresh entry module.
        entry.searchParams.set('loomWorkerInstance', context.extension.instanceId)
        url = entry.href
      }
      const module = await import(/* @vite-ignore */ url) as WorkerExtensionModule
      if (stopping) return
      if (typeof module.activate !== 'function') throw new Error('Worker module must export activate(context)')
      guest = await module.activate(context)
      if (stopping) return
      port.postMessage({ type: 'loom:worker.ready' })
    } catch (error) { if (!stopping) fatal(error) }
    finally { if (blobUrl) URL.revokeObjectURL(blobUrl) }
  })()
})
