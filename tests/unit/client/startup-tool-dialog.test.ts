// @vitest-environment happy-dom
import { act, createElement as h, lazy, useCallback, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { StartupReady, dismissStartupCurtain } from '../../../apps/studio-client/src/app/startup-curtain.js'
import { StudioToolDialog } from '../../../apps/studio-client/src/pages/studio/studio-tool-dialog.js'

let root: Root
let host: HTMLDivElement
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  document.getElementById('loom-startup')?.remove()
})

it('restores the requested tool only after startup effects finish, then shows its loading state inside the dialog', async () => {
  const curtain = document.createElement('div')
  curtain.id = 'loom-startup'
  document.body.append(curtain)
  const theme = Promise.withResolvers<void>()
  const exit = Promise.withResolvers<void>()
  Object.assign(curtain, { getAnimations: vi.fn(() => [{
    effect: { getComputedTiming: () => ({ iterations: 1 }) },
    finished: curtain.hasAttribute('data-leaving') ? exit.promise : theme.promise,
  }]) })
  const module = Promise.withResolvers<{ default(): ReturnType<typeof h> }>()
  const LazyPanel = lazy(() => module.promise)
  const close = vi.fn()
  function Shell() {
    const [ready, setReady] = useState(false)
    const onDismissed = useCallback(() => setReady(true), [])
    return h('main', null, h<{ onDismissed?(): void }>(StartupReady, { onDismissed }), h(StudioToolDialog, {
      id: 'extensions', open: true, ready, title: '扩展', icon: null, closeLabel: '关闭', onClose: close, onReturnToReading: vi.fn(),
      render: () => h(LazyPanel),
    }))
  }
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(h(Shell)))
  const dialog = host.querySelector('dialog')!
  expect(dialog.open).toBe(false)
  expect(host.querySelector('[aria-busy="true"]')).toBeNull()
  const completed = dismissStartupCurtain()
  expect(dismissStartupCurtain()).toBe(completed)
  await act(async () => { theme.resolve(); await theme.promise })
  expect(curtain.hasAttribute('data-leaving')).toBe(true)
  expect(dialog.open).toBe(false)
  await act(async () => { exit.resolve(); await completed })
  expect(document.getElementById('loom-startup')).toBeNull()
  expect(dialog.open).toBe(true)
  const placeholder = dialog.querySelector('[aria-busy="true"]')!
  expect(placeholder.closest('[data-loom-ui-dialog-body]')).not.toBeNull()
  expect(placeholder.className).toContain('panelLoading')
  expect(placeholder.querySelector('[role="status"]')?.textContent).toBe('读取中…')
  await act(async () => { module.resolve({ default: () => h('div', null, '扩展已加载') }); await module.promise })
  expect(dialog.querySelector('[aria-busy="true"]')).toBeNull()
  expect(dialog.textContent).toContain('扩展已加载')
  expect(close).not.toHaveBeenCalled()
})
