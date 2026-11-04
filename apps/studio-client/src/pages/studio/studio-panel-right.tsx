import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Dialog } from '@loom-studio/ui'
import styles from './studio-panel-right.module.scss'

export type StudioPanelRightProps = {
  children: ReactNode
  footer?: ReactNode
  id?: string
  open: boolean
  mobile?: boolean
  showMobileHandle?: boolean
  onOpen?(): void
  width?: number
  onClose(): void
  onWidthChange?(width: number): void
}

export function StudioPanelRight(props: StudioPanelRightProps) {
  const panelRef = useRef<HTMLElement>(null)
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)

  useEffect(() => {
    isResizingRef.current = false
  }, [props.open, props.mobile])

  const [measuredWidth, setMeasuredWidth] = useState(props.width ?? 320)
  const [maximumWidth, setMaximumWidth] = useState(320)
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measure = () => {
      setMeasuredWidth(panel.getBoundingClientRect().width)
      setMaximumWidth(Math.max(320, window.innerWidth * 0.85 - 12))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    window.addEventListener('resize', measure)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [props.mobile])
  const changeWidth = (width: number) => props.onWidthChange?.(Math.max(320, Math.min(maximumWidth, width)))
  const currentWidth = () => panelRef.current?.getBoundingClientRect().width || props.width || 420

  const handleResizePointerDown = (e: React.PointerEvent) => {
    isResizingRef.current = true
    resizeStartXRef.current = e.clientX
    resizeStartWidthRef.current = currentWidth()
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is best effort when the native target has already changed.
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current) return
    const deltaX = resizeStartXRef.current - e.clientX
    changeWidth(resizeStartWidthRef.current + deltaX)
  }

  const handleResizePointerUp = (e: React.PointerEvent) => {
    if (isResizingRef.current) {
      isResizingRef.current = false
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // Pointer capture is best effort when the native target has already changed.
      }
    }
  }

  const style: CSSProperties | undefined = props.width ? { width: `${props.width}px` } : undefined

  if (props.mobile) return (
    <Dialog id={props.id ?? 'studio-panel-right'} open={props.open} onClose={props.onClose}
      title="Agent Session" layout="workbench" mobileOpenHandle={props.showMobileHandle} onOpen={props.onOpen} className={styles.mobileSession}>
      <div className={styles.body}>{props.children}</div>
      {props.footer ? <footer className={styles.footer}>{props.footer}</footer> : null}
    </Dialog>
  )

  return (
    <aside
      ref={panelRef}
      id={props.id ?? 'studio-panel-right'}
      className={styles.panelRight}
      data-loom-component="studio-panel-right"
      data-open={props.open}
      aria-hidden={!props.open}
      inert={!props.open}
      style={style}
    >
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧面板宽度"
        tabIndex={0}
        aria-valuemin={320}
        aria-valuemax={Math.round(maximumWidth)}
        aria-valuenow={Math.round(measuredWidth)}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft') changeWidth(currentWidth() + 16)
          else if (event.key === 'ArrowRight') changeWidth(currentWidth() - 16)
          else if (event.key === 'Home') changeWidth(320)
          else if (event.key === 'End') changeWidth(maximumWidth)
          else return
          event.preventDefault()
        }}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        onPointerCancel={handleResizePointerUp}
        onLostPointerCapture={() => { isResizingRef.current = false }}
      />

      <div className={styles.body}>{props.children}</div>

      {props.footer ? <footer className={styles.footer}>{props.footer}</footer> : null}
    </aside>
  )
}
