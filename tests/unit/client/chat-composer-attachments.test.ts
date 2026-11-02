// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatComposer } from '../../../apps/studio-client/src/widgets/chat-composer/chat-composer.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const add = vi.fn(), change = vi.fn()
  await act(async () => root.render(createElement(ChatComposer, {
    canPreviewPrompt: false, canSend: true, input: 'before after', onChangeInput: change,
    onAddAttachments: add, onSubmit: vi.fn(), moreLabel: '更多', previewLabel: '预览',
    retryLabel: '重试', sendLabel: '发送', textareaDisabled: false, textareaLabel: '输入',
  })))
  return { host, add, change }
}
it('preserves plain text alongside pasted files at the current selection', async () => {
  const f = await mount()
  const input = f.host.querySelector('textarea')!
  input.setSelectionRange(7, 7)
  const clipboard = new DataTransfer()
  const file = new File(['image'], 'image.png', { type: 'image/png' })
  clipboard.items.add(file)
  clipboard.setData('text/plain', 'pasted ')
  await act(async () => { input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard })) })
  expect(f.add).toHaveBeenCalledWith([file])
  expect(f.change).toHaveBeenCalledWith('before pasted after')
})
it('accepts dropped files over the entire composer surface and clears its hint', async () => {
  const f = await mount()
  const surface = f.host.querySelector('[data-loom-anchor="narrative-composer-surface"]')!
  const transfer = new DataTransfer()
  const file = new File(['notes'], 'notes.md')
  transfer.items.add(file)
  Object.defineProperty(transfer, 'types', { value: ['Files'] })
  const drag = (type: string) => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: transfer }); return event }
  await act(async () => { surface.dispatchEvent(drag('dragover')) })
  expect(surface.hasAttribute('data-dragging')).toBe(true)
  await act(async () => { surface.dispatchEvent(drag('drop')) })
  expect(f.add).toHaveBeenCalledWith([file])
  expect(surface.hasAttribute('data-dragging')).toBe(false)
})
