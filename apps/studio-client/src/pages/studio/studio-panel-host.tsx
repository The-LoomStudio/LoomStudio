import { memo, Suspense, useEffect, useState, type ReactNode } from 'react'
import { STUDIO_PANEL_IDS, type StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import { SkeletonText } from '@loom-studio/ui'
import styles from './studio-page.module.scss'

type StudioPanelHostProps = {
  activePanel: StudioPanelId | null
  historyMotion?: { direction: 'back' | 'forward'; panel: StudioPanelId | null } | null
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
}

export function StudioPanelHost(props: StudioPanelHostProps) {
  return (
    <div className={styles.workspaceBody}>
        {STUDIO_PANEL_IDS.map(panel => {
          if (props.activePanel === 'play' && (panel === 'character' || panel === 'sessions')) return null
          return <StudioPanelStage
            key={panel}
            active={props.activePanel === panel}
            historyDirection={props.historyMotion?.panel === panel ? props.historyMotion.direction : undefined}
            panel={panel}
            render={props.panels[panel]}
          />
        })}
    </div>
  )
}

const StudioPanelStage = memo(function StudioPanelStage(props: {
  active: boolean
  historyDirection?: 'back' | 'forward'
  panel: StudioPanelId
  render(active: boolean): ReactNode
}) {
  const [visited, setVisited] = useState(props.active)

  useEffect(() => {
    if (props.active) setVisited(true)
  }, [props.active])

  return (
    <div
      className={styles.panelStage}
      id={`studio-${props.panel}-panel`}
      aria-hidden={!props.active}
      hidden={!props.active}
      style={{ display: props.active ? undefined : 'none' }}
      data-loom-component={`overlay-${props.panel}-layer`}
      data-loom-object={`${props.panel}-panel`}
      data-history-direction={props.active ? props.historyDirection : undefined}
    >
      {visited || props.active ? (
        <Suspense fallback={<div aria-busy="true" className={styles.panelLoading}><SkeletonText lines={6} /></div>}>
          {props.render(props.active)}
        </Suspense>
      ) : null}
    </div>
  )
}, (previous, next) => previous.panel === next.panel && !previous.active && !next.active)
