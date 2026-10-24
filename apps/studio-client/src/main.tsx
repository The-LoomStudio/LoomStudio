import { createId } from '@loom-studio/shared'
import { StartupReady } from './app/startup-curtain.js'
import { StartupFailurePage } from './app/startup-failure-page.js'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes, matchPath } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppErrorBoundary } from './app/app-error-boundary.js'
import { NotFoundPage } from './app/not-found-page.js'
import { STUDIO_ENTRY_PATHS } from './shared/studio-shell/studio-route.js'
import { syncMobileViewport } from './shared/browser/mobile-viewport.js'
import './styles/global.css'

syncMobileViewport()

const root = document.getElementById('root')
const clientLogs = createMemoryLogSink({ capacity: 1_000 })
const rootLogger = createRootLogger({
  service: 'studio-client',
  instanceId: createId('client'),
  sinks: [clientLogs, createConsoleLogSink({ filter: shouldWriteClientConsoleLog })],
})
const systemLogger = rootLogger.child('system')
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      staleTime: 30_000,
    },
  },
})

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
  const reactRoot = createRoot(rootElement)
  if (import.meta.env.DEV && ['/dev/preview/narrative-session', '/dev/preview/observability', '/dev/preview/scene-card'].includes(window.location.pathname)) {
    const { DevPreview } = await import('./dev-preview/preview-entry.js')
    reactRoot.render(<DevPreview pathname={window.location.pathname} />)
    return
  }
  if (!STUDIO_ENTRY_PATHS.some(path => matchPath(path, window.location.pathname))) {
    reactRoot.render(<><NotFoundPage /><StartupReady /></>)
    return
  }
  try {
    const response = await fetch('/auth/session', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!response.ok) throw new Error(`Application session bootstrap failed (${response.status})`)

    const { App } = await import('./app/app.js')
    systemLogger.info('Studio client started', { event: 'client.started' })
    const studio = (
      <QueryClientProvider client={queryClient}>
        <App clientLogs={clientLogs} transportLogger={rootLogger.child('transport.rpc')} extensionLogger={rootLogger.child('extension.loader')} />
      </QueryClientProvider>
    )
    reactRoot.render(
      <AppErrorBoundary onError={(error, info) => systemLogger.error('React render failed', {
        event: 'client.react.render_failed',
        error,
        data: { componentStack: info.componentStack ?? null },
      })}>
        <BrowserRouter>
          <Routes>
            {STUDIO_ENTRY_PATHS.map(path => <Route key={path} path={path} element={studio} />)}
            <Route path="*" element={<><NotFoundPage /><StartupReady /></>} />
          </Routes>
        </BrowserRouter>
      </AppErrorBoundary>,
    )
  } catch (error) {
    systemLogger.error('Studio client failed to start', {
      event: 'client.start.failed',
      error,
    })
    reactRoot.render(<><StartupFailurePage /><StartupReady /></>)
  }
}

window.addEventListener('pagehide', () => {
  systemLogger.info('Studio client stopping', { event: 'client.stopping' })
  void rootLogger.close()
}, { once: true })

function shouldWriteClientConsoleLog(record: { level: string; namespace: string }): boolean {
  return record.level === 'warn' || record.level === 'error' || record.namespace === 'system'
}
