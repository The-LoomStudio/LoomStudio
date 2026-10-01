import type { ReactNode } from 'react'
import { StateAuthoringPanel } from '../features/state-variables/ui/state-authoring-panel.js'
import { StateVariablesPanel } from '../features/state-variables/ui/state-variables-panel.js'
import type { Translator } from '../shared/i18n/index.js'
import { PanelTabs } from '../shared/ui/panel-tabs/index.js'
import styles from './studio-state-panel.module.scss'

export type VariableView = 'state' | 'authoring'

type StudioStatePanelProps = {
  hasTimeline: boolean
  variableView: VariableView
  card?: Parameters<typeof StateAuthoringPanel>[0]['card']
  statesApi: Parameters<typeof StateVariablesPanel>[0]['api']
  timelineTarget?: Parameters<typeof StateVariablesPanel>[0]['timelineTarget']
  refreshToken?: string
  t: Translator
  onSaveCard: Parameters<typeof StateAuthoringPanel>[0]['onSaveCard']
  onOpenSource: (scope: 'global' | 'timeline') => void
  onViewChange: (view: VariableView) => void
  onStateMutated: Parameters<typeof StateVariablesPanel>[0]['onStateMutated']
}

export function StudioStatePanel(props: StudioStatePanelProps): ReactNode {
  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <PanelTabs<VariableView>
          activeId={props.variableView}
          ariaLabel={props.t('character.stateVariables')}
          items={[
            { id: 'authoring', label: props.t('stateAuthoring.tab') },
            { id: 'state', label: props.t('stateVariables.title') },
          ]}
          onChange={props.onViewChange}
        />
      </header>
      <div className={styles.content}>
        {!props.hasTimeline && props.variableView === 'state' ? (
          <p>{props.t('stateVariables.noTimeline')}</p>
        ) : props.variableView === 'authoring' ? (
          <StateAuthoringPanel card={props.card} t={props.t} onSaveCard={props.onSaveCard} />
        ) : (
          <StateVariablesPanel
            api={props.statesApi}
            t={props.t}
            canOpenTimelineSource={props.hasTimeline}
            onOpenSource={props.onOpenSource}
            refreshToken={props.refreshToken}
            timelineTarget={props.timelineTarget}
            onStateMutated={props.onStateMutated}
          />
        )}
      </div>
    </div>
  )
}
