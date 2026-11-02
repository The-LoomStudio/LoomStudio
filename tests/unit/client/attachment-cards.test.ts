// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AttachmentCards } from '../../../apps/studio-client/src/features/attachments/attachment-cards.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  const remove = vi.fn()
  await act(async () => root.render(createElement(AttachmentCards, { onRemove: remove, items: [
    { id: 'photo', name: 'photo.png', attachment: { assetId: 'photo', kind: 'image', name: 'photo.png', mediaType: 'image/png', sizeBytes: 12 } },
    { id: 'notes', name: 'review_notes.md', attachment: { assetId: 'notes', kind: 'text', name: 'review_notes.md', mediaType: 'text/markdown', sizeBytes: 20 } },
  ] })))
  return { host, remove, photo: host.querySelector<HTMLButtonElement>('[aria-label="查看图片 photo.png"]')! }
}
it('shows file names below cards without hovering and opens images in the shared viewer', async () => {
  const f = await mount()
  expect(f.host.textContent).toContain('review_notes')
  expect(f.host.textContent).toContain('MD')
  expect(f.host.querySelector('[aria-label="预览文件 review_notes.md"]')).not.toBeNull()
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
  await act(async () => f.photo.click())
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="放大"]')).not.toBeNull()
})
it('reveals touch actions on long press without opening the image or removing it', async () => {
  vi.useFakeTimers()
  const f = await mount()
  await act(async () => {
    f.photo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 }))
    vi.advanceTimersByTime(450)
  })
  expect(f.photo.closest('li')?.getAttribute('data-revealed')).toBe('true')
  await act(async () => { f.photo.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })); f.photo.click() })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(f.remove).not.toHaveBeenCalled()
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="移除 photo.png"]')!.click())
  expect(f.remove).toHaveBeenCalledWith('photo')
})
it('cancels long press when the finger moves to scroll', async () => {
  vi.useFakeTimers()
  const f = await mount()
  await act(async () => {
    f.photo.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', button: 0, clientX: 10, clientY: 10 }))
    f.photo.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: 10, clientY: 35 }))
    vi.advanceTimersByTime(500)
  })
  expect(f.photo.closest('li')?.hasAttribute('data-revealed')).toBe(false)
})

it('loads text only when clicked and previews it as literal content with a download action', async () => {
  const fetch = vi.fn(async () => new Response('# Notes\n<script>not executable</script>'))
  vi.stubGlobal('fetch', fetch)
  const f = await mount()
  expect(fetch).not.toHaveBeenCalled()
  await act(async () => f.host.querySelector<HTMLButtonElement>('[aria-label="预览文件 review_notes.md"]')!.click())
  expect(fetch).toHaveBeenCalledWith('/assets/notes', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  expect(document.querySelector('pre')?.textContent).toBe('# Notes\n<script>not executable</script>')
  expect(document.querySelector('script')).toBeNull()
  expect(document.querySelector<HTMLAnchorElement>('a[download]')?.download).toBe('review_notes.md')
})

it('navigates between images and text with buttons and arrow keys', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('notes')))
  const f = await mount()
  await act(async () => f.photo.click())
  expect(document.querySelector('[aria-label="附件导航"]')?.textContent).toContain('1 / 2')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="下一个附件"]')!.click())
  expect(document.querySelector('[aria-label="review_notes.md 内容"]')?.textContent).toBe('notes')
  expect(document.querySelector('[aria-label="附件导航"]')?.textContent).toContain('2 / 2')
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })) })
  expect(document.querySelector('[aria-label="放大"]')).not.toBeNull()
})
