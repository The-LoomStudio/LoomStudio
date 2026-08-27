import { createConsoleLogSink, createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './app/app.js'
import { AppErrorBoundary } from './app/app-error-boundary.js'
import { NotFoundPage } from './app/not-found-page.js'

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

if (!root) {
  systemLogger.error('Studio client root element missing', {
    event: 'client.root.missing',
  })
} else {
  void startStudioClient(root)
}

async function startStudioClient(rootElement: HTMLElement): Promise<void> {
  try {
    const response = await fetch('/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`Application session bootstrap failed (${response.status})`)

    systemLogger.info('Studio client started', { event: 'client.started' })
    const studio = <App clientLogs={clientLogs} transportLogger={rootLogger.child('transport.rpc')} />
    createRoot(rootElement).render(
      <AppErrorBoundary onError={(error, info) => systemLogger.error('React render failed', {
        event: 'client.react.render_failed',
        error,
        data: { componentStack: info.componentStack ?? null },
      })}>
        <BrowserRouter>
          <Routes>
            <Route path="/studio/chat/:sessionId?/branch/:branchId" element={studio} />
            <Route path="/studio/chat/:sessionId?" element={studio} />
            <Route path="/studio/characters/:cardId?" element={studio} />
            <Route path="/studio/resources/:cardId?/:assetId?" element={studio} />
            <Route path="/studio/presets/:cardId?/:assetId?" element={studio} />
            <Route path="/studio/models" element={studio} />
            <Route path="/studio/agents" element={studio} />
            <Route path="/studio/history" element={studio} />
            <Route path="/studio/debug" element={studio} />
            <Route path="/studio/logs" element={studio} />
            <Route path="/studio/settings" element={studio} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AppErrorBoundary>,
    )
  } catch (error) {
    systemLogger.error('Studio client failed to start', {
      event: 'client.start.failed',
      error,
    })
    rootElement.textContent = 'Studio client failed to start.'
  }
}

window.addEventListener('pagehide', () => {
  systemLogger.info('Studio client stopping', { event: 'client.stopping' })
  void rootLogger.close()
}, { once: true })

function shouldWriteClientConsoleLog(record: { level: string; namespace: string }): boolean {
  return record.level === 'warn' || record.level === 'error' || record.namespace === 'system'
}
