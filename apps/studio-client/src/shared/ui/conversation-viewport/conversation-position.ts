import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'

type PositionScope = { view: 'timeline' | 'session'; scope: string }
export type ConversationPositionScope = PositionScope & { anchorId?: string }
export type ConversationPosition = {
  scope: string
  itemId: string
  itemOffset: number
  scrollOffset: number
  following: boolean
  anchorId?: string
}

const stateKey = 'loomConversationPosition'

/** Per browser history entry, separate from narrative/Session persistence. */
export function readConversationPosition(key: PositionScope | undefined): ConversationPosition | undefined {
  if (!key || typeof window === 'undefined') return
  const value = window.history.state?.[stateKey]?.[key.view] as ConversationPosition | undefined
  if (value?.scope !== key.scope || typeof value.itemId !== 'string' || !Number.isFinite(value.itemOffset)
    || !Number.isFinite(value.scrollOffset) || value.scrollOffset < 0 || typeof value.following !== 'boolean'
    || value.anchorId !== undefined && typeof value.anchorId !== 'string') return
  return value
}

export function useConversationPosition(input: {
  key?: ConversationPositionScope
  initial?: ConversationPosition
  active: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  virtualizer: Virtualizer<HTMLDivElement, Element>
  items: readonly { id: string }[]
  followingRef: RefObject<boolean>
  interruptionRef: RefObject<number>
}) {
  const pending = useRef(input.initial?.following === false ? input.initial : undefined)
  const requestedAt = useRef(input.interruptionRef.current)
  const latest = useRef(input)
  latest.current = input
  useLayoutEffect(() => {
    pending.current = input.initial?.following === false ? input.initial : undefined
    requestedAt.current = input.interruptionRef.current
  }, [input.initial])

  // Wait for the target row's real measurement, including an asynchronously
  // sized HTML document, rather than treating the virtual estimate as final.
  useLayoutEffect(() => {
    const position = pending.current
    const element = input.scrollRef.current
    if (!position || !element || !input.active) return
    if (input.followingRef.current || input.interruptionRef.current !== requestedAt.current) { pending.current = undefined; return }
    const index = input.items.findIndex(item => item.id === position.itemId)
    if (index < 0) return
    const row = input.virtualizer.getVirtualItems().find(item => item.index === index)
    if (!row || !input.virtualizer.itemSizeCache.has(position.itemId)) {
      input.virtualizer.scrollToIndex(index, { align: 'start' })
      return
    }
    const offset = Math.max(0, row.start + position.itemOffset)
    if (position.itemOffset >= row.size || offset > element.scrollHeight - element.clientHeight + 1) return
    element.scrollTop = offset
    pending.current = undefined
  })

  useLayoutEffect(() => {
    const element = input.scrollRef.current
    if (!input.key || !input.active || !element) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let savedFollowing: boolean | undefined
    const save = () => {
      if (timer) clearTimeout(timer)
      const current = latest.current
      if (!current.key || pending.current || !current.items.length) return
      const top = element.scrollTop
      const rows = current.virtualizer.getVirtualItems()
      const row = rows.find(item => item.start <= top && item.end > top) ?? rows[0]
      if (!row) return
      const value: ConversationPosition = { scope: current.key.scope, itemId: current.items[row.index].id,
        itemOffset: top - row.start, scrollOffset: top, following: current.followingRef.current && element.scrollHeight - element.clientHeight - top <= 48,
        ...(current.key.anchorId ? { anchorId: current.key.anchorId } : {}) }
      const state = window.history.state ?? {}
      savedFollowing = current.followingRef.current
      window.history.replaceState({ ...state, [stateKey]: { ...state[stateKey], [current.key.view]: value } }, '')
    }
    const schedule = () => {
      // Persist entering/leaving reading mode immediately; a refresh can start
      // before the debounced scroll save has run.
      if (latest.current.followingRef.current !== savedFollowing) { save(); return }
      if (timer) clearTimeout(timer)
      timer = setTimeout(save, 120)
    }
    // A real interaction cancels deferred restoration. Native scroll without
    // input events is handled by the main follow controller, not re-locked here.
    const cancelRestore = () => { pending.current = undefined }
    element.addEventListener('scroll', schedule)
    element.addEventListener('wheel', cancelRestore, { passive: true })
    element.addEventListener('touchstart', cancelRestore, { passive: true })
    element.addEventListener('pointerdown', cancelRestore)
    element.addEventListener('keydown', cancelRestore)
    window.addEventListener('beforeunload', save)
    window.addEventListener('pagehide', save)
    return () => {
      if (timer) clearTimeout(timer)
      element.removeEventListener('scroll', schedule)
      element.removeEventListener('wheel', cancelRestore)
      element.removeEventListener('touchstart', cancelRestore)
      element.removeEventListener('pointerdown', cancelRestore)
      element.removeEventListener('keydown', cancelRestore)
      window.removeEventListener('beforeunload', save)
      window.removeEventListener('pagehide', save)
    }
  }, [input.key?.view, input.key?.scope, input.active, input.scrollRef])
}
