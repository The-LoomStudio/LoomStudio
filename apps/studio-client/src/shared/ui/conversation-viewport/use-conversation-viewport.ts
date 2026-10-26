import { readConversationPosition, useConversationPosition, type ConversationPositionScope } from './conversation-position.js'
import { useSmoothFollow } from '../streaming-viewport/use-smooth-follow.js'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'

export function useConversationViewport(options: {
  items: readonly { id: string }[]
  active?: boolean
  scopeId?: string
  pinnedId?: string
  overscan?: number
  followInitially?: boolean
  restoration?: ConversationPositionScope
}) {
  const active = options.active !== false
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const position = useMemo(() => options.followInitially === false ? undefined : readConversationPosition(options.restoration),
    [options.restoration?.view, options.restoration?.scope, options.followInitially])
  const followInitially = position?.following ?? options.followInitially !== false
  const smooth = useSmoothFollow({ scrollRef, contentRef, enabled: active, scopeId: options.scopeId, initially: followInitially })
  const savedScrollOffsetRef = useRef(position?.scrollOffset ?? 0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const pinnedIndex = options.items.findIndex(item => item.id === options.pinnedId)
  const virtualizer = useVirtualizer({
    count: options.items.length,
    enabled: active,
    initialOffset: () => savedScrollOffsetRef.current,
    getScrollElement: () => scrollRef.current,
    getItemKey: useCallback((index: number) => options.items[index].id, [options.items]),
    estimateSize: () => 280,
    overscan: options.overscan ?? 5,
    scrollMargin,
    anchorTo: 'start',
    followOnAppend: false,
    scrollEndThreshold: 48,
    useFlushSync: false,
    rangeExtractor: useCallback(range => {
      const indices = defaultRangeExtractor(range)
      if (pinnedIndex >= 0 && !indices.includes(pinnedIndex)) indices.push(pinnedIndex)
      return indices.sort((a, b) => a - b)
    }, [pinnedIndex]),
  })

  useConversationPosition({ key: options.restoration, initial: position, active, scrollRef, virtualizer, items: options.items, followingRef: smooth.followingRef, interruptionRef: smooth.interruptionRef })

  useLayoutEffect(() => {
    savedScrollOffsetRef.current = position?.scrollOffset ?? 0
  }, [options.scopeId])

  useLayoutEffect(() => {
    if (!active) return
    const update = () => {
      const list = listRef.current
      const scroll = scrollRef.current
      if (list && scroll) setScrollMargin(list.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - scroll.clientTop)
    }
    update()
    const observer = new ResizeObserver(update)
    if (headerRef.current) observer.observe(headerRef.current)
    if (scrollRef.current) observer.observe(scrollRef.current)
    return () => observer.disconnect()
  }, [options.items.length > 0, active])

  function onScroll() {
    if (active && scrollRef.current) savedScrollOffsetRef.current = scrollRef.current.scrollTop
  }

  return { smooth, scrollRef, listRef, headerRef, contentRef, virtualizer, scrollMargin, onScroll }
}
