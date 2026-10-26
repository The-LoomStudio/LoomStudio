import type { ComponentProps } from 'react'
import { Tabs } from '@loom-studio/ui'
import { ObservabilityPanel } from './observability-panel.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { LogViewer } from './log-viewer.js'
import styles from './logs-panel.module.scss'

export function LogsPanel(props: ComponentProps<typeof LogViewer> & { observationApi: StudioApi; endpoint: string }) {
  const view = props.searchParams.get('logView') === 'model' ? 'model' : 'application'
  return <section className={styles.panel}>
    <Tabs ariaLabel={props.t('observation.logCategory')} activeId={view} items={[
      { id: 'application', label: props.t('observation.applicationLogs') },
      { id: 'model', label: props.t('observation.title') },
    ]} onChange={value => {
      const params = new URLSearchParams(props.searchParams)
      if (value === 'model') params.set('logView', 'model')
      else params.delete('logView')
      props.onSearchParamsChange(params)
    }} bordered />
    <div className={styles.content} hidden={view !== 'application'}>
      <LogViewer {...props} referenceApi={props.observationApi} referenceEndpoint={props.endpoint} active={props.active && view === 'application'} />
    </div>
    {props.active && view === 'model' && <div className={styles.content}>
      <ObservabilityPanel key={props.endpoint} api={props.observationApi} endpoint={props.endpoint} t={props.t} searchParams={props.searchParams} onSearchParamsChange={props.onSearchParamsChange} />
    </div>}
  </section>
}
