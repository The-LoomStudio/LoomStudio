// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MobileTabPages, type MobileTabPanRequest } from '../../../apps/studio-client/src/shared/ui/mobile-tab-pages/mobile-tab-pages.js'

it('keeps the header outside the moving siblings and commits a swipe only after settling', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('innerWidth', 400)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function View() {
    const [activeId, onChange] = useState('one')
    return createElement(MobileTabPages, { activeId, onChange,
      header: createElement('nav', { id: 'primary-tabs' }, '一级 Tab'),
      pages: [{ id: 'one', content: createElement('p', { id: 'first' }, '一') },
        { id: 'two', content: createElement('p', { id: 'second' }, '二') }],
    })
  }
  try {
    await act(async () => root.render(createElement(View)))
    const viewport = host.querySelector<HTMLElement>('[data-mobile-tab-pages]')!
    Object.defineProperty(viewport, 'clientWidth', { value: 400 })
    const track = host.querySelector('#first')!.parentElement!.parentElement!
    expect(track.contains(host.querySelector('#primary-tabs'))).toBe(false)
    expect(track.contains(host.querySelector('#second'))).toBe(true)
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    vi.spyOn(track, 'animate').mockReturnValue({ finished, cancel: vi.fn() } as unknown as Animation)
    // happy-dom does not resolve percentage transforms to the browser's computed matrix.
    track.style.transform = 'matrix(1,0,0,1,0,0)'
    const request: MobileTabPanRequest = { direction: 'next' }
    host.querySelector('#first')!.dispatchEvent(new CustomEvent('loom:mobile-tab-pan', { bubbles: true, detail: request }))
    request.controller!.move(-200)
    expect(track.style.transform).toBe('translate3d(-200px,0,0)')
    expect(host.querySelector('#first')!.parentElement!.dataset.active).toBe('true')
    request.controller!.end(0)
    await act(async () => { finish(); await finished })
    expect(host.querySelector('#second')!.parentElement!.dataset.active).toBe('true')
    expect(track.style.transform).toBe('translate3d(-100%,0,0)')
    expect(host.querySelector('#first')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
