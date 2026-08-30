import { describe, expect, it, vi } from 'vitest'
import type { ErrorInfo } from 'react'
import { AppErrorBoundary, normalizeRenderError } from '../../../apps/studio-client/src/app/app-error-boundary.js'

describe('AppErrorBoundary', () => {
  it('normalizes non-Error throws and reports caught render failures', () => {
    expect(normalizeRenderError('broken').message).toBe('broken')
    expect(AppErrorBoundary.getDerivedStateFromError('broken').error?.message).toBe('broken')

    const onError = vi.fn()
    const boundary = new AppErrorBoundary({ children: null, onError })
    const error = new Error('render failed')
    boundary.componentDidCatch(error, { componentStack: '\n at Broken' } as ErrorInfo)

    expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({ componentStack: '\n at Broken' }))
  })
})
