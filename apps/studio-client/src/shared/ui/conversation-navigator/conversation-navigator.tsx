import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import {
  readConversationPreview,
  readConversationTickWidth,
  readConversationTrackOffset,
  readConversationWheelStep,
  type ConversationMarker,
} from './conversation-navigator-model.js'
import styles from './conversation-navigator.module.scss'

export type ConversationNavigatorItem = {
  id: string
  meta: string
  preview: string
  role: string
}

type ConversationNavigatorProps = {
  activeId?: string
  items: ConversationNavigatorItem[]
  label: string
  markers?: ConversationMarker[]
  onNavigate(id: string): void
}

export function ConversationNavigator(props: ConversationNavigatorProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number>()
  const [browsingIndex, setBrowsingIndex] = useState<number>()
  const [visibleCapacity, setVisibleCapacity] = useState(60)
  const [tickStep, setTickStep] = useState(11)
  const navigatorRef = useRef<HTMLElement>(null)
  const wheelDeltaRef = useRef(0)
  const activeIndex = Math.max(0, props.items.findIndex(item => item.id === props.activeId))
  const trackCenterIndex = browsingIndex ?? activeIndex
  const previewIndex = hoveredIndex ?? activeIndex
  const previewItem = props.items[previewIndex]
  const markerByEntryId = new Map(props.markers?.map(marker => [marker.entryId, marker.kind]))
  const visibleSlotCount = Math.min(visibleCapacity, Math.max(12, props.items.length))
  const trackOffset = readConversationTrackOffset(visibleSlotCount, trackCenterIndex, tickStep)

  useLayoutEffect(() => {
    const navigatorElement = navigatorRef.current
    if (!navigatorElement) return

    function updateCapacity() {
      const currentElement = navigatorRef.current
      if (!currentElement) return
      const styles = getComputedStyle(currentElement)
      const nextTickStep = Number.parseFloat(styles.getPropertyValue('--conversation-tick-step')) || 11
      const nextCapacity = Math.min(100, Math.max(12, Math.floor(currentElement.clientHeight * 0.78 / nextTickStep)))
      setTickStep(nextTickStep)
      setVisibleCapacity(nextCapacity)
    }

    updateCapacity()
    const observer = new ResizeObserver(updateCapacity)
    observer.observe(navigatorElement)
    return () => observer.disconnect()
  }, [])

  function updateHoveredIndex(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const index = Math.floor((event.clientY - bounds.top - trackOffset) / tickStep)
    setHoveredIndex(props.items[index] ? index : undefined)
  }

  function browseTimeline(event: WheelEvent<HTMLElement>) {
    event.preventDefault()
    wheelDeltaRef.current += event.deltaY
    const step = readConversationWheelStep(wheelDeltaRef.current)
    if (step === 0) return
    wheelDeltaRef.current = 0
    const nextIndex = Math.min(props.items.length - 1, Math.max(0, (browsingIndex ?? activeIndex) + step))
    setBrowsingIndex(nextIndex)
    setHoveredIndex(current => current === undefined
      ? nextIndex
      : Math.min(props.items.length - 1, Math.max(0, current + step)))
  }

  function navigateByKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.items.length - 1
        : Math.min(props.items.length - 1, Math.max(0, activeIndex + (event.key === 'ArrowUp' ? -1 : 1)))
    const item = props.items[nextIndex]
    if (item) props.onNavigate(item.id)
  }

  if (props.items.length === 0) return null

  const previewPosition = `${((previewIndex + 0.5) * tickStep + trackOffset) / (visibleSlotCount * tickStep) * 100}%`

  return (
    <nav
      aria-label={props.label}
      className={styles.navigator}
      data-hovering={hoveredIndex === undefined ? 'false' : 'true'}
      ref={navigatorRef}
      onKeyDown={navigateByKeyboard}
      onPointerLeave={() => {
        wheelDeltaRef.current = 0
        setHoveredIndex(undefined)
        setBrowsingIndex(undefined)
      }}
      onWheel={browseTimeline}
    >
      <div
        className={styles.scale}
        style={{ height: `${visibleSlotCount * tickStep}px` }}
        onPointerMove={updateHoveredIndex}
      >
        <div className={styles.ticksViewport}>
          <div
            className={styles.ticks}
            style={{ transform: `translateY(${trackOffset}px)` }}
          >
          {props.items.map((item, index) => {
            const distance = hoveredIndex === undefined ? Number.POSITIVE_INFINITY : Math.abs(index - hoveredIndex)
            const marker = markerByEntryId.get(item.id)
            return (
              <button
                aria-label={`${item.meta} · ${item.role}`}
                aria-current={item.id === props.activeId ? 'true' : undefined}
                className={styles.tick}
                data-active={item.id === props.activeId ? 'true' : 'false'}
                data-marker={marker}
                key={item.id}
                style={{ '--conversation-tick-scale': readConversationTickWidth(distance) / 6 } as CSSProperties}
                tabIndex={item.id === props.activeId ? 0 : -1}
                type="button"
                onClick={() => props.onNavigate(item.id)}
                onFocus={() => setHoveredIndex(index)}
              >
                <span className={styles.tickMark} />
              </button>
            )
          })}
          </div>
        </div>
        {hoveredIndex !== undefined && previewItem ? (
          <aside className={styles.preview} style={{ top: previewPosition }}>
            <strong>{previewItem.meta}</strong>
            <span>{previewItem.role}</span>
            <p>{readConversationPreview(previewItem.preview)}</p>
          </aside>
        ) : null}
      </div>
    </nav>
  )
}
