import { mobileHaptic } from '../mobile-haptics.js'
import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { mobileMotionDuration, mobileMotionEasing, mobileReleaseTarget, mobileResistance } from '@loom-studio/ui'
import type { MobilePagePan } from '../master-detail-workbench/mobile-page-pan.js'
import styles from './mobile-tab-pages.module.scss'

export const MobileTabPageActive = createContext(true)
export type MobileTabPanRequest = { direction: 'previous' | 'next'; controller?: MobilePagePan; boundary?: boolean }

/** Real sibling panes stay mounted; a drag moves one shared track, never overlays pages. */
export function MobileTabPages<T extends string>(props: {
  activeId: T
  header?: ReactNode
  onChange(id: T): void
  pages: Array<{ id: T; content: ReactNode }>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<Animation | undefined>(undefined)
  const pendingRef = useRef<T | undefined>(undefined)
  const current = useRef(props)
  current.current = props
  const index = Math.max(0, props.pages.findIndex(page => page.id === props.activeId))
  useLayoutEffect(() => {
    if (pendingRef.current === undefined || pendingRef.current === props.activeId) {
      animationRef.current?.cancel()
      animationRef.current = undefined
      pendingRef.current = undefined
      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-index * 100}%,0,0)`
        delete trackRef.current.dataset.dragging
      }
    }
  }, [index, props.activeId])
  useEffect(() => {
    const container = containerRef.current!, track = trackRef.current!
    const begin = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('dialog') !== container.closest('dialog') || container.parentElement?.closest('[data-mobile-tab-pages]') || window.innerWidth > 768) return
      const request = (event as CustomEvent<MobileTabPanRequest>).detail
      const { pages, activeId, onChange } = current.current
      const active = pages.findIndex(page => page.id === activeId)
      const direction = request.direction === 'next' ? 1 : -1
      const next = active + direction
      if (!pages[next]) { request.boundary = direction === -1; event.stopPropagation(); return }
      const width = container.clientWidth
      const transform = getComputedStyle(track).transform
      const initial = transform === 'none' ? -active * width : new DOMMatrixReadOnly(transform).m41
      animationRef.current?.cancel()
      animationRef.current = undefined
      pendingRef.current = undefined
      track.dataset.dragging = 'true'
      let position = initial
      const paint = (distance: number) => {
        position = mobileResistance(initial + distance, -Math.max(active, next) * width, -Math.min(active, next) * width)
        track.style.transform = `translate3d(${position}px,0,0)`
      }
      const settle = (commit: boolean, velocity: number) => {
        const target = -(commit ? next : active) * width
        const animation = track.animate([{ transform: `translate3d(${position}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }], {
          duration: mobileMotionDuration(target - position, velocity), easing: mobileMotionEasing, fill: 'both',
        })
        animationRef.current = animation
        void animation.finished.then(() => {
          if (animationRef.current !== animation) return
          if (commit) {
            pendingRef.current = pages[next]!.id
            onChange(pages[next]!.id)
            mobileHaptic()
          } else {
            track.style.transform = `translate3d(${-active * 100}%,0,0)`
            animation.cancel()
            animationRef.current = undefined
            delete track.dataset.dragging
          }
        }, () => {})
      }
      request.controller = {
        move: paint,
        end: velocity => settle(mobileReleaseTarget(-(position + active * width) * direction, width, -velocity * direction), velocity),
        cancel: () => settle(false, 0),
      }
      event.stopPropagation()
    }
    const primaryTabs = (props.header ? container.firstElementChild?.querySelector('[data-loom-ui-tabs]') : [...(container.parentElement?.querySelectorAll('[data-loom-ui-tabs]') ?? [])].find(tabs => !container.contains(tabs)))
    const confirmTab = (event: Event) => {
      const tab = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[role="tab"]') : null
      if (tab && !tab.disabled && tab.getAttribute('aria-selected') !== 'true') mobileHaptic()
    }
    primaryTabs?.addEventListener('click', confirmTab, true)
    container.addEventListener('loom:mobile-tab-pan', begin)
    return () => { primaryTabs?.removeEventListener('click', confirmTab, true); container.removeEventListener('loom:mobile-tab-pan', begin); animationRef.current?.cancel() }
  }, [])
  return <div ref={containerRef} className={styles.viewport} data-mobile-tab-pages="">
    {props.header ? <div className={styles.header}>{props.header}</div> : null}
    <div ref={trackRef} className={styles.track} style={{ transform: `translate3d(${-index * 100}%,0,0)` }}>
      {props.pages.map(page => <MobileTabPageActive.Provider key={page.id} value={page.id === props.activeId}>
        <div className={styles.page} data-active={page.id === props.activeId} inert={page.id !== props.activeId} aria-hidden={page.id !== props.activeId}>
          {page.content}
        </div>
      </MobileTabPageActive.Provider>)}
    </div>
  </div>
}
