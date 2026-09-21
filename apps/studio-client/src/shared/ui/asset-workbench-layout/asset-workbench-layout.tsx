import { useEffect, useRef, useState, type ReactNode } from 'react'
import { WindowColumnLayout, type WindowColumnDefinition } from '../window-column-layout/window-column-layout.js'
import styles from './asset-workbench-layout.module.scss'

const EXPLORER_MIN_WIDTH = 180
const NARROW_BREAKPOINT = 640
type AssetViewMode = 'master-detail' | 'drilldown'

type AssetWorkbenchLayoutProps = {
  children: ReactNode
  explorer: ReactNode
  explorerWidth: number
  header?: ReactNode
  footer?: ReactNode
  hasSelection: boolean
  onExplorerWidthChange(width: number): void
  resizeLabel: string
  toolbar?: ReactNode
  viewMode: AssetViewMode
  mobilePane?: 'explorer' | 'detail'
  onMobilePaneChange?: (pane: 'explorer' | 'detail') => void
}

export function AssetWorkbenchLayout(props: AssetWorkbenchLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  // Drilldown mode and narrow containers share one-pane navigation; selection decides whether detail can replace the explorer.
  const mobilePane = props.mobilePane ?? 'explorer'

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateWidth = () => setContainerWidth(el.clientWidth)
    updateWidth()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const isNarrow = containerWidth > 0 && containerWidth < NARROW_BREAKPOINT
  const isDetailNavigation = isNarrow || props.viewMode === 'drilldown'
  const showDetailOnly = isDetailNavigation && mobilePane === 'detail' && props.hasSelection
  const showExplorerOnly = !props.hasSelection || (isDetailNavigation && mobilePane === 'explorer')

  const explorer = (
    <aside className={styles.explorerPane} data-loom-component="asset-explorer">
      {props.header ? (
        <div className={styles.explorerHeader} data-loom-component="explorer-header">
          {props.header}
        </div>
      ) : null}
      {props.toolbar ? (
        <header className={styles.explorerToolbar}>
          <div className={styles.toolbarContent}>{props.toolbar}</div>
        </header>
      ) : null}
      <div className={styles.explorerBody}>{props.explorer}</div>
      {props.footer ? (
        <div className={styles.floatingExplorerTabs} data-loom-component="floating-explorer-tabs">
          {props.footer}
        </div>
      ) : null}
    </aside>
  )

  const detail = (
    <section className={styles.detailPane} data-loom-component="asset-detail-pane">
      <div className={styles.detailContent}>
        {props.children}
      </div>
    </section>
  )

  const columns: WindowColumnDefinition[] = [
          {
            content: explorer,
            id: 'explorer',
            minSize: EXPLORER_MIN_WIDTH,
            resizeLabel: props.resizeLabel,
            size: props.explorerWidth,
          },
          { content: detail, fill: true, id: 'detail', minSize: 0 },
        ]

  return (
    <div ref={containerRef} className={`${styles.workbenchWrapper} ${isNarrow ? styles.workbenchNarrow : ''}`}>
      {isDetailNavigation ? (
        <div className={styles.mobileViewport} data-pane={showDetailOnly ? 'detail' : 'explorer'}>
          <div className={styles.mobilePane} data-pane="explorer" inert={showDetailOnly}>{explorer}</div>
          <div className={styles.mobilePane} data-pane="detail" inert={showExplorerOnly}>{detail}</div>
        </div>
      ) : (
        <WindowColumnLayout
          className={`${styles.workbench} ${readViewModeClassName(props.viewMode)}`}
          columns={columns}
          onColumnSizeChange={(columnId, size) => {
            if (columnId === 'explorer') props.onExplorerWidthChange(size)
          }}
        />
      )}
    </div>
  )
}

function readViewModeClassName(viewMode: AssetViewMode): string {
  if (viewMode === 'drilldown') return styles.workbenchEditor
  return styles.workbenchSplit
}
