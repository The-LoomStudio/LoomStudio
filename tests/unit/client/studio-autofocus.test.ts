// @vitest-environment happy-dom
import { act, createElement as h, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStudioAutofocus } from '../../../apps/studio-client/src/shared/studio-shell/use-studio-autofocus.js'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  // happy-dom has no layout; hidden/inert semantics are still checked by the hook.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  // happy-dom does not track the browser's modal top layer for :modal queries.
  const queryAll = document.querySelectorAll.bind(document)
  vi.spyOn(document, 'querySelectorAll').mockImplementation((selector: string) =>
    queryAll(selector === 'dialog:modal' ? 'dialog[open]' : selector))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function Sample({ panel = false, loading = false, disabled = false, revision = 0, enabled = true, ready = true }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useStudioAutofocus(ready, input, enabled)
  return h('div', null,
    h('textarea', { ref: input, id: 'composer', disabled }),
    h('button', { id: 'other' }, 'Other'),
    h('section', { hidden: !panel, 'data-loom-component': 'overlay-resource-layer' },
      loading ? h('div', { 'aria-busy': true }, 'Loading') : h('input', { type: 'search', id: 'search' })),
    h('span', null, revision))
}
async function render(props: Parameters<typeof Sample>[0] = {}) {
  await act(async () => root.render(h(Sample, props)))
}
async function focused(id: string) {
  await act(async () => { await vi.waitFor(() => expect(document.activeElement?.id).toBe(id)) })
}
it('focuses the composer initially and does not steal focus on ordinary updates', async () => {
  await render()
  await focused('composer')
  host.querySelector<HTMLButtonElement>('#other')!.focus()
  await render({ revision: 1 })
  expect(document.activeElement?.id).toBe('other')
})
it('does not focus panels or reclaim Composer focus after closing them', async () => {
  await render()
  await focused('composer')
  const other = host.querySelector<HTMLButtonElement>('#other')!
  other.focus()
  await render({ panel: true })
  expect(document.activeElement).toBe(other)
  await render({ panel: false })
  expect(document.activeElement).toBe(other)
})
it('skips startup focus when a panel is already open', async () => {
  await render({ panel: true })
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
  await render({ panel: false })
  expect(document.activeElement?.id).not.toBe('composer')
})
it('keeps the startup preference off when enabled later in settings', async () => {
  await render({ enabled: false })
  await render({ enabled: true })
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
  expect(document.activeElement?.id).not.toBe('composer')
})
it('does not steal focus if interaction happened before startup was ready', async () => {
  await render({ ready: false })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  await render({ ready: true })
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
  expect(document.activeElement?.id).not.toBe('composer')
})
it('waits for the composer to become enabled', async () => {
  await render({ disabled: true })
  expect(document.activeElement?.id).not.toBe('composer')
  await render({ disabled: false })
  await focused('composer')
})
it('cancels deferred focus if the user has moved elsewhere', async () => {
  await render({ disabled: true })
  // Let the initial frame discover the disabled composer.
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
  const other = host.querySelector<HTMLButtonElement>('#other')!
  other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  other.focus()
  await render({ disabled: false })
  expect(document.activeElement).toBe(other)
})
