import { createConsoleLogSink, createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
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
  const studio = <App clientLogs={clientLogs} transportLogger={rootLogger.child('transport.rpc')} />
  createRoot(root).render(
    <BrowserRouter>
      <Routes>
        <Route path="/studio/chat/:sessionId?/branch/:branchId" element={studio} />
        <Route path="/studio/chat/:sessionId?" element={studio} />
        <Route path="/studio/characters/:cardId?" element={studio} />
        <Route path="/studio/resources/:cardId?/:assetId?" element={studio} />
        <Route path="/studio/presets/:cardId?/:assetId?" element={studio} />
        <Route path="/studio/models" element={studio} />
        <Route path="/studio/debug" element={studio} />
        <Route path="/studio/logs" element={studio} />
        <Route path="/studio/settings" element={studio} />
        <Route path="*" element={<Navigate replace to="/studio/chat" />} />
      </Routes>
    </BrowserRouter>,
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
