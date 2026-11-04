// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { LogEventRow } from '../../../apps/studio-client/src/widgets/log-viewer/log-event-row.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
it('shows severity and source while collapsed and opens raw evidence without expanding the row', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const inspect = vi.fn()
  const t = createTranslator('zh-CN')
  try {
    await act(async () => root.render(h(LogEventRow, {
      record: { timestamp: '2026-11-03T06:00:00.000Z', level: 'info', service: 'studio-server', instanceId: 'test', namespace: 'extension.loader', message: 'Extension ready', data: { outcome: 'completed' } },
      t, onFilterRun: () => {}, onInspect: inspect,
    })))
    const summary = host.querySelector('[data-log-row]')!
    expect(summary.textContent).toContain('INFO')
    expect(summary.textContent).toContain('studio-server / extension.loader')
    expect(summary.textContent).toContain(t('observation.completed'))
    expect(summary.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => (summary.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement).click())
    expect(summary.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('dialog')?.open).toBe(true)
    expect(host.querySelector('dialog')?.textContent).toContain('"instanceId": "test"')
    expect(inspect).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
