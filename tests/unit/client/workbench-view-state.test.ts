// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { StudioRail } from '../../../apps/studio-client/src/pages/studio/studio-rail.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { useWorkbenchView } from '../../../apps/studio-client/src/shared/studio-shell/use-workbench-view.js'
import { createDefaultStudioLayout, useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'
import { useStudioNavigation } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.js'
import { studioHistoryState } from '../../../apps/studio-client/src/shared/studio-shell/studio-workspace.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const host = document.createElement('div')
let root = createRoot(host)
afterEach(async () => {
  await act(async () => root.unmount())
  root = createRoot(host)
  useStudioLayoutStore.setState({ ...createDefaultStudioLayout(), panelPositions: {} })
})
it('restores a view after remount and rejects an unavailable saved tab', async () => {
  function View({ choices = ['first', 'second'] }: { choices?: string[] }) {
    const [view, setView] = useWorkbenchView('test.view', 'first', choices)
    return h('button', { onClick: () => setView('second') }, view)
  }
  await act(async () => root.render(h(View)))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => root.render(null))
  await act(async () => root.render(h(View)))
  expect(host.textContent).toBe('second')
  await act(async () => root.render(h(View, { choices: ['first'] })))
  expect(host.textContent).toBe('first')
  await act(async () => root.render(h(View)))
  expect(host.textContent).toBe('second')
})
it('remembers independently mounted tabs at four depths', async () => {
  function Level({ depth }: { depth: number }): ReturnType<typeof h> {
    const [view, setView] = useWorkbenchView(`test.level.${depth}`, 'first', ['first', 'second'])
    return h('div', null,
      h('button', { 'data-depth': depth, onClick: () => setView(current => current === 'first' ? 'second' : 'first') }, view),
      view === 'second' && depth < 4 ? h(Level, { depth: depth + 1 }) : null)
  }
  await act(async () => root.render(h(Level, { depth: 1 })))
  for (let depth = 1; depth <= 4; depth++) {
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-depth="${depth}"]`)!.click())
  }
  await act(async () => host.querySelector<HTMLButtonElement>('[data-depth="1"]')!.click())
  expect(host.querySelectorAll('button')).toHaveLength(1)
  await act(async () => host.querySelector<HTMLButtonElement>('[data-depth="1"]')!.click())
  await act(async () => root.render(null))
  await act(async () => root.render(h(Level, { depth: 1 })))
  expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['second', 'second', 'second', 'second'])
})
it('restores ordinary panel and overlay navigation without changing the active card', async () => {
  let nav: ReturnType<typeof useStudioNavigation>
  const api = {} as StudioApi
  function Harness() { nav = useStudioNavigation({ endpoint: '/test', api }); return null }
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [{ pathname: '/studio', state: studioHistoryState('/test', { panel: 'logs', cardId: 'card-a', search: 'logView=model' }) }] }, h(Harness))))
  await act(async () => { await nav!.openPanel('macro') })
  await act(async () => { await nav!.openPanel('logs') })
  expect(nav!.searchParams.get('logView')).toBe('model')
  expect(nav!.route.cardId).toBe('card-a')
  await act(async () => { await nav!.closePanel() })
  await act(async () => { await nav!.openPanel('logs') })
  expect(nav!.searchParams.get('logView')).toBe('model')
  await act(async () => { await nav!.openPanel('settings') })
  await act(async () => { await nav!.setToolSearchParams(new URLSearchParams('category=appearance')) })
  await act(async () => { await nav!.closeTool() })
  await act(async () => { await nav!.openPanel('settings') })
  expect(nav!.route.tool).toBe('settings')
  expect(nav!.toolSearchParams.get('category')).toBe('appearance')
  await act(async () => { await nav!.openPanel('macro', { cardId: 'card-b' }) })
  await act(async () => { await nav!.openPanel('logs') })
  expect(nav!.searchParams.get('logView')).toBeNull()
  await act(async () => { await nav!.openResource('agent', 'explicit-preset', 'explicit-node') })
  expect(nav!.route.resourceId).toBe('explicit-preset')
  await act(async () => { await nav!.openPanel('logs') })
  await act(async () => { await nav!.openPanel('agent') })
  expect(nav!.route.resourceId).toBe('explicit-preset')
  expect(nav!.route.assetId).toBe('explicit-node')
})

it('keeps rail history expanded across tool overlays and restores it after compact mode or remount', async () => {
  const t = createTranslator('zh-CN')
  const props = { compact: false, activePanel: null, recentSessions: h('span', null, 'recent story'), t, onOpenDashboard() {}, togglePanel() {} }
  const toggle = () => host.querySelector<HTMLButtonElement>(`[aria-label="${t('recentCharacters.title')}"]`)!
  const disclosure = () => host.querySelector('[data-open]')!
  await act(async () => root.render(h(StudioRail, props)))
  await act(async () => toggle().click())
  for (const activePanel of ['extensions', null, 'settings', null] as const) {
    await act(async () => root.render(h(StudioRail, { ...props, activePanel })))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(disclosure().getAttribute('data-open')).toBe('true')
    expect(disclosure().hasAttribute('inert')).toBe(false)
  }
  await act(async () => root.render(h(StudioRail, { ...props, compact: true, activePanel: 'resource' })))
  expect(disclosure().getAttribute('data-open')).toBe('false')
  await act(async () => root.render(null))
  await act(async () => root.render(h(StudioRail, props)))
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  await act(async () => toggle().click())
  await act(async () => root.render(null))
  await act(async () => root.render(h(StudioRail, props)))
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
})
