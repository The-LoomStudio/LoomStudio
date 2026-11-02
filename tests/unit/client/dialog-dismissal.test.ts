// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Dialog, type DialogProps } from '@loom-studio/ui'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function mount(overrides: Partial<DialogProps> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onClose = vi.fn()
  act(() => root.render(createElement(Dialog, { open: true, title: 'Resources', onClose, ...overrides }, createElement('p', null, 'Content'))))
  const dialog = container.querySelector('dialog')!
  Object.defineProperty(dialog, 'clientHeight', { value: 200 })
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 400, top: 100, bottom: 300 } as DOMRect)
  function click(startX: number, endX = startX) {
    act(() => {
      dialog.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: startX, clientY: 150, button: 0 }))
      dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: endX, clientY: 150, button: 0 }))
    })
  }
  return { container, dialog, onClose, click, dispose() { act(() => root.unmount()); container.remove() } }
}

describe('shared Dialog dismissal', () => {
  it('provides a visible close control and responds to Escape cancellation', () => {
    const f = mount()
    try {
      act(() => { f.container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click() })
      expect(f.onClose).toHaveBeenCalledOnce()
      act(() => { f.dialog.dispatchEvent(new Event('cancel', { cancelable: true })) })
      expect(f.onClose).toHaveBeenCalledTimes(2)
    } finally { f.dispose() }
  })

  it.each(['default', 'workbench'] as const)('dismisses a mobile %s sheet only after dragging its handle far enough', layout => {
    const f = mount({ layout })
    try {
      const handle = f.container.querySelector<HTMLButtonElement>('[data-loom-ui-sheet-handle]')!
      handle.setPointerCapture = vi.fn()
      let time = 0
      const pointer = (type: string, y: number) => act(() => {
        const event = new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientY: y })
        Object.defineProperty(event, 'timeStamp', { value: time += 1000 })
        handle.dispatchEvent(event)
      })
      pointer('pointerdown', 100)
      pointer('pointermove', 140)
      expect(f.dialog.style.getPropertyValue('--loom-sheet-offset')).toBe('40px')
      pointer('pointerup', 140)
      expect(f.onClose).not.toHaveBeenCalled()
      expect(f.onClose).not.toHaveBeenCalled()
      pointer('pointerdown', 100)
      pointer('pointermove', 190)
      pointer('pointerup', 190)
      pointer('lostpointercapture', 190)
      expect(f.onClose).toHaveBeenCalledOnce()
      expect(f.dialog.style.getPropertyValue('--loom-sheet-offset')).toBe('90px')
    } finally { f.dispose() }
  })

  it('keeps the release offset while an asynchronous route close is pending', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    const f = mount({ layout: 'workbench', onClose: () => pending })
    const frame = vi.spyOn(window, 'requestAnimationFrame')
    try {
      const handle = f.container.querySelector<HTMLButtonElement>('[data-loom-ui-sheet-handle]')!
      handle.setPointerCapture = vi.fn()
      let time = 0
      const pointer = (type: string, y: number) => act(() => {
        const event = new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId: 1, isPrimary: true, clientY: y })
        Object.defineProperty(event, 'timeStamp', { value: time += 1000 })
        handle.dispatchEvent(event)
      })
      pointer('pointerdown', 100)
      pointer('pointermove', 300)
      pointer('pointerup', 300)
      pointer('lostpointercapture', 300)
      expect(f.dialog.style.getPropertyValue('--loom-sheet-offset')).toBe('200px')
      expect(frame).not.toHaveBeenCalled()
      await act(async () => { finish(); await pending })
      expect(frame).toHaveBeenCalledOnce()
    } finally { f.dispose(); frame.mockRestore() }
  })

  it('closes on a backdrop click, but keeps surface clicks and outward drags open', () => {
    const f = mount()
    try {
      f.click(200)
      f.click(200, 20)
      expect(f.onClose).not.toHaveBeenCalled()
      f.click(20)
      expect(f.onClose).toHaveBeenCalledOnce()
    } finally { f.dispose() }
  })

  it('preserves explicit non-dismissible and backdrop opt-out behavior', () => {
    const locked = mount({ dismissible: false })
    try {
      expect(locked.container.querySelector('button')!.disabled).toBe(true)
      locked.click(20)
      act(() => { locked.dialog.dispatchEvent(new Event('cancel', { cancelable: true })) })
      expect(locked.onClose).not.toHaveBeenCalled()
    } finally { locked.dispose() }
    const explicit = mount({ closeOnBackdrop: false, showCloseButton: false })
    try {
      explicit.click(20)
      expect(explicit.onClose).not.toHaveBeenCalled()
      expect(explicit.container.querySelector('button')).toBeNull()
    } finally { explicit.dispose() }
  })
  it('closes workbench on backdrop clicks by default', () => {
    const f = mount({ layout: 'workbench' })
    try {
      f.click(20)
      expect(f.onClose).toHaveBeenCalledOnce()
    } finally { f.dispose() }
  })

  it('isolates nested cancellation and native close events from the parent workbench', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const closeParent = vi.fn()
    const closeChild = vi.fn()
    act(() => root.render(createElement(Dialog, { open: true, title: 'Models', layout: 'workbench', onClose: closeParent },
      createElement(Dialog, { open: true, title: 'Delete account', onClose: closeChild }, 'Confirm'))))
    try {
      const [parent, child] = container.querySelectorAll('dialog')
      act(() => { child!.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })) })
      expect(closeChild).toHaveBeenCalledOnce()
      expect(closeParent).not.toHaveBeenCalled()
      act(() => { child!.dispatchEvent(new Event('close', { bubbles: true })) })
      expect(closeChild).toHaveBeenCalledTimes(2)
      expect(closeParent).not.toHaveBeenCalled()
      act(() => { parent!.dispatchEvent(new Event('cancel', { cancelable: true })) })
      expect(closeParent).toHaveBeenCalledOnce()
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('closes nested native dialogs when navigation closes their workbench', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const closeChild = vi.fn()
    function render(open: boolean) {
      act(() => root.render(createElement(Dialog, { open, title: 'Models', layout: 'workbench', onClose: vi.fn() },
        createElement(Dialog, { open: true, title: 'Confirm', onClose: closeChild }, 'Confirm'))))
    }
    try {
      render(true)
      expect([...container.querySelectorAll('dialog')].every(dialog => dialog.open)).toBe(true)
      render(false)
      expect([...container.querySelectorAll('dialog')].every(dialog => !dialog.open)).toBe(true)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

})
