// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useAttachmentDrafts } from '../../../apps/studio-client/src/features/attachments/use-attachment-drafts.js'

const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); vi.unstubAllGlobals(); localStorage.clear() })
async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let scope = 'session-a:discussion'
  let current!: ReturnType<typeof useAttachmentDrafts>
  function Harness() { current = useAttachmentDrafts(scope); return null }
  const root = createRoot(document.createElement('div')); roots.push(root)
  const render = () => act(async () => root.render(createElement(Harness)))
  await render()
  return { get current() { return current }, change: async (key: string) => { scope = key; await render() } }
}
it('publishes late uploads only to their original Session and entry draft', async () => {
  const response = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn(() => response.promise))
  const f = await mount()
  let upload!: Promise<void>
  await act(async () => { upload = f.current.add([new File(['hello'], 'notes.md', { type: 'text/markdown' })]) })
  expect(f.current.ready).toBe(false)
  await f.change('session-b:discussion')
  await act(async () => { response.resolve(new Response(JSON.stringify({ asset: { id: 'asset' } }))); await upload })
  expect(f.current.items).toEqual([])
  await f.change('session-a:discussion')
  expect(f.current.values).toMatchObject([{ assetId: 'asset', kind: 'text', name: 'notes.md' }])
  const accepted = f.current.clear
  await act(async () => { accepted() })
  expect(f.current.items).toEqual([])
})
it('keeps failed uploads visible and blocks sending until removed', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Upload rejected' } }), { status: 413 })))
  const f = await mount()
  await act(async () => { await f.current.add([new File(['hello'], 'notes.txt')]) })
  expect(f.current.ready).toBe(false)
  expect(f.current.items[0]?.error).toBe('Upload rejected')
  await act(async () => { f.current.remove(f.current.items[0]!.id) })
  expect(f.current.ready).toBe(true)
})

it('restores uploaded references after remount and persists removal', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ asset: { id: 'saved' } }))))
  const first = await mount()
  await act(async () => { await first.current.add([new File(['hello'], 'notes.md')]) })
  await act(async () => { roots.pop()!.unmount() })
  const restored = await mount()
  expect(restored.current.values).toMatchObject([{ assetId: 'saved', name: 'notes.md' }])
  await act(async () => { restored.current.moveTo('session-new') })
  await restored.change('session-new')
  expect(restored.current.values).toHaveLength(1)
  await act(async () => { restored.current.clear() })
  const empty = await mount()
  await empty.change('session-new')
  expect(empty.current.items).toEqual([])
})
it('restores unfinished uploads as actionable errors', async () => {
  localStorage.setItem('loom:attachment-draft:v1:session-a:discussion', JSON.stringify([{ id: 'pending', name: 'image.png' }]))
  const restored = await mount()
  expect(restored.current.ready).toBe(false)
  expect(restored.current.items[0]?.error).toContain('上传已中断')
})

it('rejects invalid and surplus files before inserting cards without blocking valid uploads', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ asset: { id: 'saved' } })))
  vi.stubGlobal('fetch', fetch)
  const f = await mount()
  await act(async () => { await f.current.add([new File(['x'], 'invalid.pdf'), ...Array.from({ length: 22 }, (_, i) => new File(['x'], `${i}.txt`))]) })
  expect(fetch).toHaveBeenCalledTimes(20)
  expect(f.current.items).toHaveLength(20)
  expect(f.current.ready).toBe(true)
  expect(f.current.notice).toContain('未加入 3 个文件')
})
it('retries a failed file without duplicating the card', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ asset: { id: 'retried' } })))
  vi.stubGlobal('fetch', fetch)
  const f = await mount()
  await act(async () => { await f.current.add([new File(['x'], 'notes.txt')]) })
  const id = f.current.items[0]!.id
  expect(f.current.items[0]?.retryable).toBe(true)
  await act(async () => { await f.current.retry(id) })
  expect(f.current.items).toHaveLength(1)
  expect(f.current.items[0]?.id).toBe(id)
  expect(f.current.values[0]?.assetId).toBe('retried')
})
it('aborts removed uploads and ignores late completion', async () => {
  const response = Promise.withResolvers<Response>()
  const fetch = vi.fn(() => response.promise)
  vi.stubGlobal('fetch', fetch)
  const f = await mount()
  let pending!: Promise<void>
  await act(async () => { pending = f.current.add([new File(['x'], 'notes.txt')]) })
  const signal = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!
  await act(async () => { f.current.remove(f.current.items[0]!.id) })
  expect(signal.aborted).toBe(true)
  await act(async () => { response.resolve(new Response(JSON.stringify({ asset: { id: 'late' } }))); await pending })
  expect(f.current.items).toEqual([])
})
it('publishes an in-flight upload to a draft moved to a new session', async () => {
  const response = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn(() => response.promise))
  const f = await mount()
  let pending!: Promise<void>
  await act(async () => { pending = f.current.add([new File(['x'], 'notes.txt')]) })
  await act(async () => { f.current.moveTo('new-session') })
  await f.change('new-session')
  await act(async () => { response.resolve(new Response(JSON.stringify({ asset: { id: 'moved' } }))); await pending })
  expect(f.current.values[0]?.assetId).toBe('moved')
})
it('shows a local image preview while uploading without persisting its blob URL', async () => {
  const response = Promise.withResolvers<Response>()
  vi.stubGlobal('fetch', vi.fn(() => response.promise))
  const f = await mount()
  let pending!: Promise<void>
  await act(async () => { pending = f.current.add([new File(['image'], 'photo.png', { type: 'image/png' })]) })
  expect(f.current.items[0]?.previewUrl).toMatch(/^blob:/)
  expect(localStorage.getItem('loom:attachment-draft:v1:session-a:discussion')).not.toContain('blob:')
  await act(async () => { response.resolve(new Response(JSON.stringify({ asset: { id: 'image' } }))); await pending })
  expect(f.current.items[0]?.previewUrl).toBeUndefined()
  expect(f.current.values[0]?.kind).toBe('image')
})
