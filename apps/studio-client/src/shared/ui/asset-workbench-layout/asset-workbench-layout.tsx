import type { ReactNode } from 'react'
import { MasterDetailWorkbench } from '../master-detail-workbench/master-detail-workbench.js'
import styles from './asset-workbench-layout.module.scss'

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
  const explorer = (
    <aside className={styles.explorerPane} data-loom-mobile-tab-scope="" data-loom-component="asset-explorer">
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

  return (
    <MasterDetailWorkbench
      master={explorer}
      masterWidth={props.explorerWidth}
      onMasterWidthChange={props.onExplorerWidthChange}
      detailMinWidth={0}
      resizeLabel={props.resizeLabel}
      mobilePane={props.mobilePane === 'detail' ? 'detail' : 'master'}
      onMobilePaneChange={pane => props.onMobilePaneChange?.(pane === 'master' ? 'explorer' : 'detail')}
      drilldown={props.viewMode === 'drilldown'}
      hasSelection={props.hasSelection}
      hideBackBar
    >
      {detail}
    </MasterDetailWorkbench>
  )
}
