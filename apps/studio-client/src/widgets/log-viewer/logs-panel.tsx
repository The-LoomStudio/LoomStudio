import { MobileTabPages } from '../../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import type { ComponentProps } from 'react'
import { Tabs } from '@loom-studio/ui'
import { ObservabilityPanel } from './observability-panel.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { LogViewer } from './log-viewer.js'
import styles from './logs-panel.module.scss'

export function LogsPanel(props: ComponentProps<typeof LogViewer> & { observationApi: StudioApi; endpoint: string }) {
  const view = props.searchParams.get('logView') === 'model' ? 'model' : 'application'
  const changeView = (value: 'application' | 'model') => {
    const params = new URLSearchParams(props.searchParams)
    if (value === 'model') params.set('logView', 'model')
    else params.delete('logView')
    props.onSearchParamsChange(params)
  }
  return <section data-loom-mobile-tab-scope="" className={styles.panel}>
    <Tabs className={styles.tabs} ariaLabel={props.t('observation.logCategory')} activeId={view} items={[
      { id: 'application', label: props.t('observation.applicationLogs') },
      { id: 'model', label: props.t('observation.title') },
    ]} onChange={changeView} />
    <MobileTabPages activeId={view} onChange={changeView} pages={[{ id: 'application', content: (
    <div className={styles.content}>
      <LogViewer {...props} referenceApi={props.observationApi} referenceEndpoint={props.endpoint} active={props.active && view === 'application'} />
    </div>
    ) }, { id: 'model', content: (<div className={styles.content}>
      <ObservabilityPanel key={props.endpoint} api={props.observationApi} endpoint={props.endpoint} t={props.t} searchParams={props.searchParams} onSearchParamsChange={props.onSearchParamsChange} />
    </div>) }]} />
  </section>
}
