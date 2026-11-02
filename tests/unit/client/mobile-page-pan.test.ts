// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MasterDetailWorkbench } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/master-detail-workbench.js'
import type { MobilePagePanRequest } from '../../../apps/studio-client/src/shared/ui/master-detail-workbench/mobile-page-pan.js'

it('keeps detail mounted while dragging and commits back only after the release animation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function View() {
    const [pane, setPane] = useState<'master' | 'detail'>('detail')
    return createElement(MasterDetailWorkbench, { drilldown: true, mobilePane: pane, onMobilePaneChange: setPane, navigationScope: 'local', master: '目录', children: createElement('p', { id: 'detail-text' }, '详情') })
  }
  try {
    await act(async () => root.render(createElement(View)))
    const container = host.querySelector<HTMLElement>('[data-mobile-master-detail]')!
    Object.defineProperty(container, 'clientWidth', { value: 400 })
    const detail = host.querySelector<HTMLElement>('[data-column-id="detail"]')!
    const master = host.querySelector<HTMLElement>('[data-column-id="master"]')!
    let finish!: () => void
    const finished = new Promise<void>(resolve => { finish = resolve })
    const animate = vi.spyOn(detail, 'animate').mockReturnValue({ finished, cancel: vi.fn() } as unknown as Animation)
    const request: MobilePagePanRequest = {}
    host.querySelector('#detail-text')!.dispatchEvent(new CustomEvent('loom:mobile-page-pan', { bubbles: true, detail: request }))
    expect(request.controller).toBeDefined()
    request.controller!.move(120)
    expect(detail.style.transform).toBe('translate3d(120px, 0, 0)')
    expect(master.style.transform).toBe('')
    expect(container.dataset.mobilePanning).toBe('true')
    expect(container.dataset.pane).toBe('detail')
    request.controller!.move(240)
    request.controller!.end(0)
    expect(container.dataset.pane).toBe('detail')
    expect(animate.mock.calls[0]![0]).toEqual([{ transform: 'translate3d(240px,0,0)' }, { transform: 'translate3d(400px,0,0)' }])
    await act(async () => { finish(); await finished })
    expect(container.dataset.pane).toBe('master')
    expect(host.querySelector('#detail-text')).not.toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})
