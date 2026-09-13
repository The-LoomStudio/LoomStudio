import { useRef, type CSSProperties, type ReactNode } from 'react'
import styles from './studio-panel-right.module.scss'

export type StudioPanelRightProps = {
  children: ReactNode
  footer?: ReactNode
  id?: string
  open: boolean
  width?: number
  onClose(): void
  onWidthChange?(width: number): void
}

export function StudioPanelRight(props: StudioPanelRightProps) {
  const isResizingRef = useRef(false)
  const resizeStartXRef = useRef(0)
  const resizeStartWidthRef = useRef(0)

  const handleResizePointerDown = (e: React.PointerEvent) => {
    isResizingRef.current = true
    resizeStartXRef.current = e.clientX
    const currentWidth = props.width ?? 420
    resizeStartWidthRef.current = currentWidth
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is best effort when the native target has already changed.
    }
  }

  const handleResizePointerMove = (e: React.PointerEvent) => {
    if (!isResizingRef.current) return
    const deltaX = resizeStartXRef.current - e.clientX
    const nextWidth = Math.max(320, Math.min(window.innerWidth * 0.85, resizeStartWidthRef.current + deltaX))
    props.onWidthChange?.(nextWidth)
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

  if (!props.open) return null

  const style: CSSProperties | undefined = props.width ? { width: `${props.width}px` } : undefined

  return (
    <aside
      id={props.id ?? 'studio-panel-right'}
      className={styles.panelRight}
      data-loom-component="studio-panel-right"
      style={style}
    >
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整右侧面板宽度"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
      />

      <div className={styles.body}>{props.children}</div>

      {props.footer ? <footer className={styles.footer}>{props.footer}</footer> : null}
    </aside>
  )
}
