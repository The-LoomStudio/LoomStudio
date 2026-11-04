// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Dialog } from '@loom-studio/ui'
import { afterEach, expect, it, vi } from 'vitest'
import { ResourceBindings } from '../../../apps/studio-client/src/features/prompt-resources/ui/prompt-resource-toolbar/resource-bindings.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const t = createTranslator('zh-CN')
let root: Root
let host: HTMLDivElement
let client: QueryClient
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  client?.clear()
})

it('loads bindings only on inspection and closes a nested inspector without closing its parent', async () => {
  const getBindings = vi.fn(async () => ({ resourceId: 'lore', cards: [{ id: 'card', name: '测试角色' }], loreMounts: [] }))
  const closeParent = vi.fn()
  host = document.createElement('div'); document.body.append(host)
  root = createRoot(host)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => root.render(h(QueryClientProvider, { client },
    h(Dialog, { open: true, title: '资源', onClose: closeParent },
      h(ResourceBindings, { api: { getBindings }, endpoint: '/test', resourceId: 'lore', resources: [], t })))))
  const parent = host.querySelector('dialog')!
  expect(getBindings).not.toHaveBeenCalled()
  const trigger = parent.querySelector<HTMLButtonElement>(`[aria-label="${t('promptResource.bindings')}"]`)!
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
  await act(async () => { trigger.click(); await new Promise(resolve => setTimeout(resolve, 20)) })
  expect(getBindings).toHaveBeenCalledExactlyOnceWith('lore')
  const inspector = parent.querySelector('dialog')!
  expect(inspector.open).toBe(true)
  expect(inspector.textContent).toContain('测试角色')
  expect(inspector.querySelector('details')).toBeNull()
  await act(async () => inspector.dispatchEvent(new Event('cancel', { cancelable: true })))
  expect(parent.querySelector('dialog')).toBeNull()
  expect(parent.open).toBe(true)
  expect(closeParent).not.toHaveBeenCalled()
})
