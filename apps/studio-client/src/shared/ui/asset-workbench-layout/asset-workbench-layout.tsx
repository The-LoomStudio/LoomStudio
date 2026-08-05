import { useEffect, useState, useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import styles from './asset-workbench-layout.module.scss'

const EXPLORER_MIN_WIDTH = 180
const EXPLORER_DEFAULT_WIDTH = 300
const EXPLORER_KEYBOARD_STEP = 16
const SPLITTER_WIDTH = 9
type AssetViewMode = 'explorer' | 'split' | 'editor'

type AssetWorkbenchLayoutProps = {
  children: ReactNode
  explorer: ReactNode
  explorerWidth: number
  onExplorerWidthChange(width: number): void
  resizeLabel: string
  toolbar: ReactNode
  viewMode: AssetViewMode
}

export function AssetWorkbenchLayout(props: AssetWorkbenchLayoutProps) {
  const shellRef = useRef<HTMLElement>(null)
  const explorerWidthRef = useRef(props.explorerWidth)
  const [explorerWidth, setExplorerWidth] = useState(props.explorerWidth)
  const [shellWidth, setShellWidth] = useState(0)
  const [resizing, setResizing] = useState(false)
  const explorerMaximum = shellWidth > 0 ? readExplorerMaximum(shellWidth) : EXPLORER_DEFAULT_WIDTH

  useEffect(() => {
    if (resizing) return
    explorerWidthRef.current = props.explorerWidth
    setExplorerWidth(props.explorerWidth)
  }, [props.explorerWidth, resizing])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const observer = new ResizeObserver(() => {
      const width = shell.clientWidth
      setShellWidth(width)
      setExplorerWidth(current => {
        const next = clampExplorerWidth(current, width)
        explorerWidthRef.current = next
        return next
      })
    })
    observer.observe(shell)
    return () => observer.disconnect()
  }, [])

  function handleResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing || !shellRef.current) return
    const bounds = shellRef.current.getBoundingClientRect()
    updateExplorerWidth(clampExplorerWidth(event.clientX - bounds.left, bounds.width), false)
  }

  function stopResize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    props.onExplorerWidthChange(explorerWidthRef.current)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setResizing(false)
  }

  function updateExplorerWidth(width: number, persist = true) {
    explorerWidthRef.current = width
    setExplorerWidth(width)
    if (persist) props.onExplorerWidthChange(width)
  }

  return (
    <section
      ref={shellRef}
      className={`${styles.shell} ${readViewModeClassName(props.viewMode)} ${resizing ? styles.shellResizing : ''}`}
      style={{ '--loom-explorer-width': `${explorerWidth}px` } as CSSProperties}
      data-loom-component="asset-workbench"
    >
      <aside
        aria-hidden={props.viewMode === 'editor'}
        className={styles.explorerPane}
        data-loom-component="asset-explorer"
      >
        <header className={styles.explorerToolbar}>
          <div className={styles.toolbarContent}>{props.toolbar}</div>
        </header>
        <span className="loom-divider" aria-hidden="true" />
        <div className={styles.explorerBody}>{props.explorer}</div>
      </aside>

      <div
          aria-label={props.resizeLabel}
          aria-hidden={props.viewMode !== 'split'}
          aria-orientation="vertical"
          aria-valuemax={Math.round(explorerMaximum)}
          aria-valuemin={EXPLORER_MIN_WIDTH}
          aria-valuenow={Math.round(explorerWidth)}
          className={`${styles.splitter} ${props.viewMode === 'split' ? '' : styles.splitterHidden}`}
          role="separator"
          tabIndex={props.viewMode === 'split' ? 0 : -1}
          onKeyDown={event => {
            if (props.viewMode !== 'split') return
            if (event.key === 'ArrowLeft') updateExplorerWidth(clampExplorerWidth(explorerWidthRef.current - EXPLORER_KEYBOARD_STEP, shellWidth))
            else if (event.key === 'ArrowRight') updateExplorerWidth(clampExplorerWidth(explorerWidthRef.current + EXPLORER_KEYBOARD_STEP, shellWidth))
            else if (event.key === 'Home') updateExplorerWidth(EXPLORER_MIN_WIDTH)
            else if (event.key === 'End') updateExplorerWidth(explorerMaximum)
            else return
            event.preventDefault()
          }}
          onPointerDown={event => {
            if (props.viewMode !== 'split') return
            event.currentTarget.setPointerCapture(event.pointerId)
            setResizing(true)
          }}
          onPointerMove={handleResize}
          onPointerUp={stopResize}
          onPointerCancel={stopResize}
          onLostPointerCapture={() => {
            props.onExplorerWidthChange(explorerWidthRef.current)
            setResizing(false)
          }}
        >
          <span className={styles.splitterLine} aria-hidden="true" />
        </div>

      <section
        aria-hidden={props.viewMode === 'explorer'}
        className={styles.detailPane}
        data-loom-component="asset-detail-pane"
      >
        {props.children}
      </section>
    </section>
  )
}

function readViewModeClassName(viewMode: AssetViewMode): string {
  if (viewMode === 'explorer') return styles.shellExplorer
  if (viewMode === 'editor') return styles.shellEditor
  return styles.shellSplit
}

export function clampExplorerWidth(width: number, shellWidth?: number): number {
  return Math.min(readExplorerMaximum(shellWidth), Math.max(EXPLORER_MIN_WIDTH, width))
}

function readExplorerMaximum(shellWidth?: number): number {
  if (shellWidth === undefined) return Number.MAX_SAFE_INTEGER
  return Math.max(EXPLORER_MIN_WIDTH, shellWidth - SPLITTER_WIDTH)
}
