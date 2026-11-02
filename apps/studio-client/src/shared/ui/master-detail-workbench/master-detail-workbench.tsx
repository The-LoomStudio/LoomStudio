import { MobileTabPageActive } from '../mobile-tab-pages/mobile-tab-pages.js'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { mobileMotionDuration, mobileMotionEasing, mobileReleaseTarget, mobileResistance } from '@loom-studio/ui'
import type { MobilePagePanRequest } from './mobile-page-pan.js'
import { ChevronLeft } from 'lucide-react'
import { WindowColumnLayout, type WindowColumnDefinition } from '../window-column-layout/window-column-layout.js'
import { useStudioLayoutStore } from '../../studio-shell/studio-layout-store.js'
import styles from './master-detail-workbench.module.scss'

const NARROW_BREAKPOINT = 640

export type MasterDetailWorkbenchProps = {
  master: ReactNode
  children: ReactNode
  mobilePane?: 'master' | 'detail'
  onMobilePaneChange?: (pane: 'master' | 'detail') => void
  onBack?: () => void
  backLabel?: string
  className?: string
  masterWidth?: number | string
  defaultMasterWidth?: number
  onMasterWidthChange?: (width: number) => void
  masterMinWidth?: number
  detailMinWidth?: number
  resizeLabel?: string
  dataComponent?: string
  drilldown?: boolean
  hasSelection?: boolean
  hideBackBar?: boolean
  navigationScope?: 'workspace' | 'local'
}

export function MasterDetailWorkbench(props: MasterDetailWorkbenchProps) {
  const pageActive = useContext(MobileTabPageActive)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 768)
  const [internalMobilePane, setInternalMobilePane] = useState<'master' | 'detail'>('master')

  const [internalMasterWidth, setInternalMasterWidth] = useState(
    typeof props.masterWidth === 'number' ? props.masterWidth : props.defaultMasterWidth ?? 280,
  )

  // A supplied pane is controlled by the parent; otherwise this workbench owns mobile navigation locally.
  const mobilePane = props.mobilePane ?? internalMobilePane
  const setMobilePane = props.onMobilePaneChange ?? setInternalMobilePane
  const setWorkbenchNavigation = useStudioLayoutStore(state => state.setWorkbenchNavigation)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateNarrow = () => {
      const nextNarrow = window.innerWidth <= 768 || (el.clientWidth > 0 && el.clientWidth < NARROW_BREAKPOINT)
      setIsNarrow(prev => (prev === nextNarrow ? prev : nextNarrow))
    }
    updateNarrow()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateNarrow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const singlePane = isNarrow || props.drilldown === true
  const showDetailOnly = singlePane && mobilePane === 'detail' && props.hasSelection !== false

  const forwardAvailableRef = useRef(false)
  const showDetailOnlyRef = useRef(showDetailOnly)
  showDetailOnlyRef.current = showDetailOnly

  const handleGoBack = useCallback(() => {
    if (showDetailOnlyRef.current) {
      forwardAvailableRef.current = true
      setMobilePane('master')
      props.onBack?.()
      return true
    }
    return false
  }, [setMobilePane, props.onBack])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const back = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-mobile-master-detail]') !== element) return
      if (handleGoBack()) { event.preventDefault(); event.stopPropagation() }
    }
    element.addEventListener('loom:mobile-back', back)
    return () => element.removeEventListener('loom:mobile-back', back)
  }, [handleGoBack])

  const goBackRef = useRef(handleGoBack)
  goBackRef.current = handleGoBack
  useEffect(() => {
    const container = containerRef.current
    if (!container || !singlePane) return
    const detail = container.querySelector<HTMLElement>('[data-column-id="detail"]')!
    let animation: Animation | undefined
    let clearFrame: number | undefined
    let position = 0
    const clear = () => {
      animation?.cancel()
      if (clearFrame !== undefined) cancelAnimationFrame(clearFrame)
      animation = undefined
      detail.style.removeProperty('transform')
      detail.style.removeProperty('transition')
      delete container.dataset.mobilePanning
    }
    const paint = (x: number) => {
      position = x
      detail.style.transform = `translate3d(${x}px, 0, 0)`
    }
    const settle = (back: boolean, velocity: number) => {
      const target = back ? container.clientWidth : 0
      animation = detail.animate([{ transform: `translate3d(${position}px,0,0)` }, { transform: `translate3d(${target}px,0,0)` }],
        { duration: mobileMotionDuration(target - position, velocity), easing: mobileMotionEasing, fill: 'both' })
      const current = animation
      void current.finished.then(() => {
        if (animation !== current) return
        if (back) {
          goBackRef.current()
          clearFrame = requestAnimationFrame(clear)
        } else clear()
      }, () => {})
    }
    const begin = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-mobile-master-detail]') !== container || !showDetailOnlyRef.current) return
      const request = (event as CustomEvent<MobilePagePanRequest>).detail
      // Read the visual position before cancelling an in-flight settle animation.
      const transform = getComputedStyle(detail).transform
      const x = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41
      animation?.cancel()
      if (clearFrame !== undefined) cancelAnimationFrame(clearFrame)
      animation = undefined
      detail.style.transition = 'none'
      container.dataset.mobilePanning = 'true'
      paint(x)
      request.controller = {
        move: distance => paint(mobileResistance(x + distance, 0, container.clientWidth)),
        end: velocity => settle(mobileReleaseTarget(position, container.clientWidth, velocity), velocity),
        cancel: () => settle(false, 0),
      }
      event.stopPropagation()
    }
    container.addEventListener('loom:mobile-page-pan', begin)
    return () => { container.removeEventListener('loom:mobile-page-pan', begin); clear() }
  }, [singlePane])

  const handleGoForward = useCallback(() => {
    if (forwardAvailableRef.current) {
      forwardAvailableRef.current = false
      setMobilePane('detail')
      return true
    }
    return false
  }, [setMobilePane])

  useEffect(() => {
    if (mobilePane === 'detail') {
      forwardAvailableRef.current = false
    }
  }, [mobilePane])

  useEffect(() => {
    if (props.navigationScope === 'local' || !pageActive) return
    const nav = {
      canGoBack: () => showDetailOnlyRef.current,
      goBack: handleGoBack,
      canGoForward: () => forwardAvailableRef.current,
      goForward: handleGoForward,
    }
    setWorkbenchNavigation(nav)
    return () => {
      setWorkbenchNavigation(null)
    }
  }, [handleGoBack, handleGoForward, setWorkbenchNavigation, props.navigationScope, pageActive])

  const currentMasterWidth = typeof props.masterWidth === 'number' ? props.masterWidth : internalMasterWidth

  function handleMasterWidthChange(size: number) {
    setInternalMasterWidth(size)
    props.onMasterWidthChange?.(size)
  }

  const masterPane = (
    <aside className={styles.masterPane} data-loom-slot="master" inert={singlePane && showDetailOnly}>
      {props.master}
    </aside>
  )

  const detailPane = (
    <section className={styles.detailPane} data-loom-slot="detail" inert={singlePane && !showDetailOnly}>
      {singlePane && (props.hideBackBar ?? props.navigationScope !== 'local') === false ? (
        <div className={styles.narrowBackBar}>
          <button
            className={styles.narrowBackButton}
            type="button"
            onClick={() => {
              setMobilePane('master')
              props.onBack?.()
            }}
            aria-label={props.backLabel ?? '返回列表'}
          >
            <ChevronLeft aria-hidden="true" size={16} />
            <span>{props.backLabel ?? '返回列表'}</span>
          </button>
        </div>
      ) : null}
      <div className={styles.detailBody}>
        {props.children}
      </div>
    </section>
  )

  const columns: WindowColumnDefinition[] = [
        {
          content: masterPane,
          id: 'master',
          minSize: props.masterMinWidth ?? 180,
          resizeLabel: singlePane ? undefined : props.resizeLabel ?? '调整侧栏宽度',
          size: currentMasterWidth,
        },
        {
          content: detailPane,
          fill: true,
          id: 'detail',
          minSize: props.detailMinWidth ?? 200,
        },
      ]

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${props.className ?? ''}`}
      data-loom-component={props.dataComponent ?? 'master-detail-workbench'}
      data-mobile-master-detail=""
      data-mobile-workspace-pane={props.navigationScope !== 'local' ? (showDetailOnly ? 'detail' : 'master') : undefined}
      data-single-pane={singlePane}
      data-pane={showDetailOnly ? 'detail' : 'master'}
    >
      <WindowColumnLayout
          className={styles.workbenchColumnLayout}
          columns={columns}
          onColumnSizeChange={(columnId, size) => {
            if (columnId === 'master') handleMasterWidthChange(size)
          }}
      />
    </div>
  )
}
