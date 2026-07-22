import { createConsoleLogSink, createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { createRoot } from 'react-dom/client'
import { App } from './app/app.js'

const root = document.getElementById('root')
const clientLogs = createMemoryLogSink({ capacity: 1_000 })
const rootLogger = createRootLogger({
  service: 'studio-client',
  instanceId: `client-${globalThis.crypto.randomUUID()}`,
  sinks: [clientLogs, createConsoleLogSink({ filter: shouldWriteClientConsoleLog })],
})
const systemLogger = rootLogger.child('system')

window.addEventListener('error', event => {
  systemLogger.error('Unhandled browser error', {
    event: 'client.error.unhandled',
    data: {
      source: 'window.error',
      failureType: event.error instanceof Error ? event.error.name : typeof event.error,
      line: event.lineno,
      column: event.colno,
    },
  })
})

window.addEventListener('unhandledrejection', event => {
  systemLogger.error('Unhandled browser promise rejection', {
    event: 'client.promise.unhandled',
    data: {
      source: 'window.unhandledrejection',
      failureType: event.reason instanceof Error ? event.reason.name : typeof event.reason,
    },
  })
})

systemLogger.info('Studio client started', { event: 'client.started' })

if (root) {
  createRoot(root).render(
    <App
      clientLogs={clientLogs}
      transportLogger={rootLogger.child('transport.rpc')}
    />,
  )
} else {
  systemLogger.error('Studio client root element missing', {
    event: 'client.root.missing',
  })
}

window.addEventListener('pagehide', () => {
  systemLogger.info('Studio client stopping', { event: 'client.stopping' })
  void rootLogger.close()
}, { once: true })

function shouldWriteClientConsoleLog(record: { level: string; namespace: string }): boolean {
  return record.level === 'warn' || record.level === 'error' || record.namespace === 'system'
}
