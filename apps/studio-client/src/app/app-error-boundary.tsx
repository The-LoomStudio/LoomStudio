import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../shared/i18n/index.js'
import { AppStatusPage } from './app-status-page.js'

type AppErrorBoundaryProps = {
  children: ReactNode
  onError(error: Error, info: ErrorInfo): void
}

type AppErrorBoundaryState = {
  error?: Error
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {}

  static getDerivedStateFromError(caught: unknown): AppErrorBoundaryState {
    return { error: normalizeRenderError(caught) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info)
  }

  render(): ReactNode {
    const error = this.state.error
    if (!error) return this.props.children

    return (
      <div data-loom-component="app-error-boundary" role="alert">
        <AppStatusPage
          actions={(
            <>
            <button type="button" onClick={() => globalThis.location.reload()}>{t('appError.reload')}</button>
            <a href="/studio/chat">{t('appError.returnChat')}</a>
            </>
          )}
          description={t('appError.description')}
          eyebrow={t('appError.eyebrow')}
          title={t('appError.title')}
        >
          {import.meta.env.DEV ? <details><summary>{t('appError.details')}</summary><pre>{error.stack ?? error.message}</pre></details> : null}
        </AppStatusPage>
      </div>
    )
  }
}

export function normalizeRenderError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught))
}
