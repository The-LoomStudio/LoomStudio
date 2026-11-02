import { memo, Suspense, useEffect, useState, type ReactNode } from 'react'
import { STUDIO_PANEL_IDS, type StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import { StudioPanelLoading } from './studio-panel-loading.js'
import styles from './studio-page.module.scss'

type StudioPanelHostProps = {
  activePanel: StudioPanelId | null
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
}

export function StudioPanelHost(props: StudioPanelHostProps) {
  return (
    <div className={styles.workspaceBody}>
        {STUDIO_PANEL_IDS.filter(panel => panel !== 'model' && panel !== 'settings' && panel !== 'recent' && panel !== 'sessions').map(panel => {
          return <StudioPanelStage
            key={panel}
            active={props.activePanel === panel}
            panel={panel}
            render={props.panels[panel]}
          />
        })}
    </div>
  )
}

const StudioPanelStage = memo(function StudioPanelStage(props: {
  active: boolean
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
      id={props.panel === 'extensions' ? 'studio-extension-workspace-panel' : `studio-${props.panel}-panel`}
      aria-hidden={!props.active}
      hidden={!props.active}
      style={{ display: props.active ? undefined : 'none' }}
      data-loom-component={`overlay-${props.panel}-layer`}
      data-loom-object={`${props.panel}-panel`}
    >
      {visited || props.active ? (
        <Suspense fallback={<StudioPanelLoading />}>
          {props.render(props.active)}
        </Suspense>
      ) : null}
    </div>
  )
}, (previous, next) => previous.panel === next.panel && !previous.active && !next.active)
