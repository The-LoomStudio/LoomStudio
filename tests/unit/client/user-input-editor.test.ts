// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { UserInputEditor } from '../../../apps/studio-client/src/features/attachments/user-input-editor.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals()
})
async function mount(save = vi.fn(async () => true)) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  const close = vi.fn()
  const attachments = [{ assetId: 'image', name: 'image.png', mediaType: 'image/png', sizeBytes: 12, kind: 'image' as const }]
  await act(async () => root.render(createElement(UserInputEditor, { entryId: 'input', content: '', attachments, onSave: save, onClose: close, pending: true })))
  return { host, save, close, attachments }
}
it('keeps unchanged image-only input disabled and explicitly deletes only after submitting an empty edit', async () => {
  const f = await mount()
  expect(f.host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="移除 image.png"]')!.click())
  expect(f.save).not.toHaveBeenCalled()
  expect(f.host.querySelector('[aria-label="删除这条输入"]')).not.toBeNull()
  await act(async () => { f.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(f.save).toHaveBeenCalledWith('input', '', f.attachments, '', [])
  expect(f.close).toHaveBeenCalledOnce()
})
it('keeps edited attachments on failure, and cancelling never modifies the original message', async () => {
  const save = vi.fn(async () => { throw new Error('input already consumed') })
  const f = await mount(save)
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="移除 image.png"]')!.click())
  await act(async () => { f.host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  expect(f.host.textContent).toContain('input already consumed')
  expect(f.close).not.toHaveBeenCalled()
  await act(async () => Array.from(f.host.querySelectorAll('button')).find(button => button.textContent === '取消')!.click())
  expect(save).toHaveBeenCalledOnce()
  expect(f.attachments).toHaveLength(1)
  expect(f.close).toHaveBeenCalledOnce()
})
