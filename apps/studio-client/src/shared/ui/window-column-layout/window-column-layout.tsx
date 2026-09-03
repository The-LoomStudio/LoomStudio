import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import {
  clampColumnSize,
  COLUMN_KEYBOARD_STEP,
  COLUMN_SPLITTER_SIZE,
  commitColumnSize,
  readColumnMaximum,
  resolveColumnSizes,
  type ColumnSizeConstraints,
} from './window-column-layout-model.js'
import styles from './window-column-layout.module.scss'

export type WindowColumnDefinition = ColumnSizeConstraints & {
  className?: string
  content: ReactNode
  divider?: boolean
  fill?: boolean
  id: string
  resizable?: boolean
  resizeLabel?: string
  shrinkPriority?: number
  size?: number
}

type WindowColumnLayoutProps = {
  className?: string
  columns: WindowColumnDefinition[]
  onColumnSizeChange?(columnId: string, size: number): void
}

type ResizeSession = {
  columnIndex: number
  containerWidth: number
  pointerStart: number
  sizeCurrent: number
  sizeStart: number
}

export function WindowColumnLayout(props: WindowColumnLayoutProps) {
  const layoutRef = useRef<HTMLDivElement>(null)
  const resizeSessionRef = useRef<ResizeSession | undefined>(undefined)
  const [containerWidth, setContainerWidth] = useState(0)
  const [previewSizes, setPreviewSizes] = useState<Record<string, number>>({})
  const [resizing, setResizing] = useState(false)
  const fillColumnIndex = Math.max(0, props.columns.findIndex(column => column.fill))
  const requestedColumnSizes = props.columns.map(column => previewSizes[column.id] ?? column.size ?? column.minSize)
  const columnSizes = resolveColumnSizes(props.columns.map((column, index) => ({
    ...column,
    size: requestedColumnSizes[index] ?? column.minSize,
  })), containerWidth)
  const columnMinimums = props.columns.map(column => column.minSize)

  useEffect(() => {
    const layout = layoutRef.current
    if (!layout) return
    const observer = new ResizeObserver(() => setContainerWidth(layout.clientWidth))
    observer.observe(layout)
    setContainerWidth(layout.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!resizing) setPreviewSizes({})
  }, [props.columns, resizing])

  const gridTemplateColumns = props.columns.flatMap((column, index) => {
    const track = column.fill
      ? `minmax(${column.minSize}px, 1fr)`
      : `${columnSizes[index]}px`
    return index === props.columns.length - 1 ? [track] : [track, `${COLUMN_SPLITTER_SIZE}px`]
  }).join(' ')

  function readMaximum(columnIndex: number, width = containerWidth): number {
    return Math.min(
      props.columns[columnIndex]?.maxSize ?? Number.MAX_SAFE_INTEGER,
      readColumnMaximum(columnIndex, columnSizes, columnMinimums, fillColumnIndex, width),
    )
  }

  function commitResize() {
    const session = resizeSessionRef.current
    if (!session) return
    const column = props.columns[session.columnIndex]
    const size = commitColumnSize(
      session.sizeCurrent,
      column,
      readMaximum(session.columnIndex, session.containerWidth),
    )
    resizeSessionRef.current = undefined
    setPreviewSizes({})
    setResizing(false)
    props.onColumnSizeChange?.(column.id, size)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const session = resizeSessionRef.current
    if (!session) return
    const column = props.columns[session.columnIndex]
    const size = clampColumnSize(
      session.sizeStart + event.clientX - session.pointerStart,
      column,
      readMaximum(session.columnIndex, session.containerWidth),
    )
    session.sizeCurrent = size
    setPreviewSizes({ [column.id]: size })
  }

  function handleKeyboard(columnIndex: number, event: KeyboardEvent<HTMLDivElement>) {
    const column = props.columns[columnIndex]
    const current = columnSizes[columnIndex]
    const maximum = readMaximum(columnIndex)
    let size: number
    if (event.key === 'ArrowLeft') {
      size = column.collapsedSize !== undefined && current <= column.minSize
        ? column.collapsedSize
        : commitColumnSize(current - COLUMN_KEYBOARD_STEP, column, maximum)
    } else if (event.key === 'ArrowRight') {
      size = column.collapsedSize !== undefined && current === column.collapsedSize
        ? column.minSize
        : commitColumnSize(current + COLUMN_KEYBOARD_STEP, column, maximum)
    } else if (event.key === 'Home') size = column.collapsedSize ?? column.minSize
    else if (event.key === 'End') size = maximum
    else return
    event.preventDefault()
    props.onColumnSizeChange?.(column.id, size)
  }

  return (
    <div
      ref={layoutRef}
      className={[styles.layout, resizing ? styles.layoutResizing : '', props.className ?? ''].filter(Boolean).join(' ')}
      data-loom-component="window-column-layout"
      style={{ gridTemplateColumns } as CSSProperties}
    >
      {props.columns.flatMap((column, index) => {
        const maximum = readMaximum(index)
        const size = columnSizes[index]
        const columnElement = (
          <div className={`${styles.column} ${column.className ?? ''}`} data-column-id={column.id} key={column.id}>
            {column.content}
          </div>
        )
        if (index === props.columns.length - 1 || (!column.resizeLabel && !column.divider) || column.fill) return [columnElement]
        if (column.resizable === false || !column.resizeLabel) {
          return [
            columnElement,
            <div
              className={styles.splitterStatic}
              key={`${column.id}-splitter`}
              role="separator"
              aria-hidden="true"
            >
              <span className={styles.splitterLine} aria-hidden="true" />
            </div>,
          ]
        }
        return [
          columnElement,
          <div
            aria-label={column.resizeLabel}
            aria-orientation="vertical"
            aria-valuemax={Math.round(maximum)}
            aria-valuemin={Math.round(column.collapsedSize ?? column.minSize)}
            aria-valuenow={Math.round(size)}
            className={styles.splitter}
            key={`${column.id}-splitter`}
            role="separator"
            tabIndex={0}
            onKeyDown={event => handleKeyboard(index, event)}
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId)
              resizeSessionRef.current = {
                columnIndex: index,
                containerWidth: containerWidth || event.currentTarget.parentElement?.clientWidth || 0,
                pointerStart: event.clientX,
                sizeCurrent: size,
                sizeStart: size,
              }
              setResizing(true)
            }}
            onPointerMove={handlePointerMove}
            onPointerUp={event => {
              commitResize()
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={commitResize}
            onLostPointerCapture={commitResize}
          >
            <span className={styles.splitterLine} aria-hidden="true" />
          </div>,
        ]
      })}
    </div>
  )
}
