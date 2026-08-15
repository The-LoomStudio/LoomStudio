import type { ReactNode } from 'react'
import { WindowColumnLayout, type WindowColumnDefinition } from '../window-column-layout/window-column-layout.js'
import styles from './asset-workbench-layout.module.scss'

const EXPLORER_MIN_WIDTH = 180
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
}

export function AssetWorkbenchLayout(props: AssetWorkbenchLayoutProps) {
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
      {props.children}
    </section>
  )
  const columns: WindowColumnDefinition[] = props.viewMode === 'explorer'
    ? [{ content: explorer, fill: true, id: 'explorer', minSize: 0 }]
    : props.viewMode === 'editor'
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
    <WindowColumnLayout
      className={`${styles.workbench} ${readViewModeClassName(props.viewMode)}`}
      columns={columns}
      onColumnSizeChange={(columnId, size) => {
        if (columnId === 'explorer') props.onExplorerWidthChange(size)
      }}
    />
  )
}

function readViewModeClassName(viewMode: AssetViewMode): string {
  if (viewMode === 'explorer') return styles.workbenchExplorer
  if (viewMode === 'editor') return styles.workbenchEditor
  return styles.workbenchSplit
}
