import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { WindowColumnLayout, type WindowColumnDefinition } from '../window-column-layout/window-column-layout.js'
import styles from './asset-workbench-layout.module.scss'

const EXPLORER_MIN_WIDTH = 180
const NARROW_BREAKPOINT = 640
type AssetViewMode = 'explorer' | 'split' | 'editor'

type AssetWorkbenchLayoutProps = {
  children: ReactNode
  explorer: ReactNode
  explorerWidth: number
  footer?: ReactNode
  onExplorerWidthChange(width: number): void
  resizeLabel: string
  toolbar?: ReactNode
  viewMode: AssetViewMode
  mobilePane?: 'explorer' | 'detail'
  onMobilePaneChange?: (pane: 'explorer' | 'detail') => void
  hasSelection?: boolean
  onBack?: () => void
  backLabel?: string
}

export function AssetWorkbenchLayout(props: AssetWorkbenchLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [internalMobilePane, setInternalMobilePane] = useState<'explorer' | 'detail'>('explorer')

  const mobilePane = props.mobilePane ?? internalMobilePane
  const setMobilePane = props.onMobilePaneChange ?? setInternalMobilePane

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
  const showDetailOnly = isNarrow && (props.mobilePane !== undefined
    ? props.mobilePane === 'detail'
    : (props.hasSelection !== undefined ? props.hasSelection : internalMobilePane === 'detail'))
  const showExplorerOnly = isNarrow && !showDetailOnly

  const explorer = (
    <aside className={styles.explorerPane} data-loom-component="asset-explorer">
      {props.toolbar ? (
        <>
          <header className={styles.explorerToolbar}>
            <div className={styles.toolbarContent}>{props.toolbar}</div>
          </header>
          <span className="loom-divider" aria-hidden="true" />
        </>
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
      {isNarrow ? (
        <div className={styles.narrowBackBar}>
          <button
            className={styles.narrowBackButton}
            type="button"
            onClick={() => {
              setMobilePane('explorer')
              props.onBack?.()
            }}
            aria-label={props.backLabel ?? '返回列表'}
          >
            <ChevronLeft aria-hidden="true" size={16} />
            <span>{props.backLabel ?? '返回列表'}</span>
          </button>
        </div>
      ) : null}
      <div className={styles.detailContent}>
        {props.children}
      </div>
    </section>
  )

  const columns: WindowColumnDefinition[] = (props.viewMode === 'explorer' || showExplorerOnly)
    ? [{ content: explorer, fill: true, id: 'explorer', minSize: 0 }]
    : (props.viewMode === 'editor' || showDetailOnly)
      ? [{ content: detail, fill: true, id: 'detail', minSize: 0 }]
      : [
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
      <WindowColumnLayout
        className={`${styles.workbench} ${readViewModeClassName(props.viewMode)}`}
        columns={columns}
        onColumnSizeChange={(columnId, size) => {
          if (columnId === 'explorer') props.onExplorerWidthChange(size)
        }}
      />
    </div>
  )
}

function readViewModeClassName(viewMode: AssetViewMode): string {
  if (viewMode === 'explorer') return styles.workbenchExplorer
  if (viewMode === 'editor') return styles.workbenchEditor
  return styles.workbenchSplit
}
