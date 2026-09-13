import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { WindowColumnLayout, type WindowColumnDefinition } from '../window-column-layout/window-column-layout.js'
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
}

export function MasterDetailWorkbench(props: MasterDetailWorkbenchProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [internalMobilePane, setInternalMobilePane] = useState<'master' | 'detail'>('master')

  const parsedDefaultWidth = typeof props.masterWidth === 'number'
    ? props.masterWidth
    : (props.defaultMasterWidth ?? 280)

  const [internalMasterWidth, setInternalMasterWidth] = useState(parsedDefaultWidth)

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
  const showDetailOnly = isNarrow && mobilePane === 'detail'

  const currentMasterWidth = typeof props.masterWidth === 'number'
    ? props.masterWidth
    : internalMasterWidth

  function handleMasterWidthChange(size: number) {
    setInternalMasterWidth(size)
    props.onMasterWidthChange?.(size)
  }

  const masterPane = (
    <aside className={styles.masterPane} data-loom-slot="master">
      {props.master}
    </aside>
  )

  const detailPane = (
    <section className={styles.detailPane} data-loom-slot="detail">
      {isNarrow ? (
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

  const columns: WindowColumnDefinition[] = isNarrow
    ? (showDetailOnly
        ? [{ content: detailPane, fill: true, id: 'detail', minSize: 0 }]
        : [{ content: masterPane, fill: true, id: 'master', minSize: 0 }])
    : [
        {
          content: masterPane,
          id: 'master',
          minSize: props.masterMinWidth ?? 180,
          resizeLabel: props.resizeLabel ?? '调整侧栏宽度',
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
      className={`${styles.container} ${isNarrow ? styles.narrow : ''} ${props.className ?? ''}`}
      data-loom-component={props.dataComponent ?? 'master-detail-workbench'}
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
