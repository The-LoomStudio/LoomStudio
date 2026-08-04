import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type MutableRefObject, type PointerEvent } from 'react'
import { movedBeyondLongPressThreshold } from './context-menu-model.js'
import { useContextMenu, type ContextMenuItem } from './context-menu.js'

const LONG_PRESS_DELAY = 520
const CLICK_SUPPRESSION_TIME = 800

type LongPressSession = {
  pointerId: number
  startX: number
  startY: number
  target: HTMLElement
  timer: ReturnType<typeof setTimeout>
}

type ContextMenuTrigger = {
  openFromElement(element: HTMLElement): void
  triggerProps: Pick<HTMLAttributes<HTMLElement>,
    'onClickCapture' | 'onContextMenu' | 'onKeyDown' | 'onPointerCancel' | 'onPointerDown' | 'onPointerMove' | 'onPointerUp'>
}

export function useContextMenuTrigger(items: ContextMenuItem[]): ContextMenuTrigger {
  const { openMenu } = useContextMenu()
  const itemsRef = useRef(items)
  const longPressRef = useRef<LongPressSession | undefined>(undefined)
  const suppressClickRef = useRef(false)
  const suppressionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  itemsRef.current = items

  useEffect(() => () => {
    clearLongPress(longPressRef)
    if (suppressionTimerRef.current) clearTimeout(suppressionTimerRef.current)
  }, [])

  function openAt(element: HTMLElement, x: number, y: number) {
    openMenu({ items: itemsRef.current, returnFocus: element, x, y })
  }

  function openFromElement(element: HTMLElement) {
    const bounds = element.getBoundingClientRect()
    openAt(element, bounds.right, bounds.bottom)
  }

  function handleContextMenu(event: MouseEvent<HTMLElement>) {
    if (!hasMenuItems(itemsRef.current)) return
    event.preventDefault()
    event.stopPropagation()
    clearLongPress(longPressRef)
    openAt(event.currentTarget, event.clientX, event.clientY)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!hasMenuItems(itemsRef.current)) return
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    event.stopPropagation()
    openFromElement(event.currentTarget)
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (!hasMenuItems(itemsRef.current) || event.pointerType === 'mouse' || event.button !== 0) return
    clearLongPress(longPressRef)
    const target = event.currentTarget
    longPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
      timer: setTimeout(() => {
        const session = longPressRef.current
        if (!session) return
        suppressClickRef.current = true
        if (suppressionTimerRef.current) clearTimeout(suppressionTimerRef.current)
        suppressionTimerRef.current = setTimeout(() => {
          suppressClickRef.current = false
        }, CLICK_SUPPRESSION_TIME)
        openAt(session.target, session.startX, session.startY)
        longPressRef.current = undefined
      }, LONG_PRESS_DELAY),
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>) {
    const session = longPressRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (movedBeyondLongPressThreshold(
      { x: session.startX, y: session.startY },
      { x: event.clientX, y: event.clientY },
    )) clearLongPress(longPressRef)
  }

  function handlePointerEnd(event: PointerEvent<HTMLElement>) {
    if (longPressRef.current?.pointerId === event.pointerId) clearLongPress(longPressRef)
  }

  return {
    openFromElement,
    triggerProps: {
      onClickCapture: event => {
        if (!suppressClickRef.current) return
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
      },
      onContextMenu: handleContextMenu,
      onKeyDown: handleKeyDown,
      onPointerCancel: handlePointerEnd,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
    },
  }
}

function clearLongPress(ref: MutableRefObject<LongPressSession | undefined>) {
  if (!ref.current) return
  clearTimeout(ref.current.timer)
  ref.current = undefined
}

function hasMenuItems(items: ContextMenuItem[]): boolean {
  return items.some(item => item.type !== 'separator')
}
