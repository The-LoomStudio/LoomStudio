import { MobileTabPages } from '../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import type { ReactNode } from 'react'
import { StateAuthoringPanel } from '../features/state-variables/ui/state-authoring-panel.js'
import { StateVariablesPanel } from '../features/state-variables/ui/state-variables-panel.js'
import { StateSourcesPanel } from '../features/state-variables/ui/state-sources-panel.js'
import type { Translator } from '../shared/i18n/index.js'
import { PanelTabs } from '../shared/ui/panel-tabs/index.js'
import styles from './studio-state-panel.module.scss'

export type VariableView = 'state' | 'authoring' | 'sources'

type StudioStatePanelProps = {
  hasTimeline: boolean
  variableView: VariableView
  card?: Parameters<typeof StateAuthoringPanel>[0]['card']
  statesApi: Parameters<typeof StateVariablesPanel>[0]['api']
  timelineTarget?: Parameters<typeof StateVariablesPanel>[0]['timelineTarget']
  focusPath?: string
  refreshToken?: string
  sourceRefreshToken?: string
  t: Translator
  onSaveCard: Parameters<typeof StateAuthoringPanel>[0]['onSaveCard']
  onOpenSource: (scope: 'global' | 'timeline') => void
  onViewChange: (view: VariableView) => void
  onStateMutated: Parameters<typeof StateVariablesPanel>[0]['onStateMutated']
}

export function StudioStatePanel(props: StudioStatePanelProps): ReactNode {
  const tabs = (
    <PanelTabs<VariableView>
      activeId={props.variableView}
      ariaLabel={props.t('character.stateVariables')}
      items={[
        { id: 'sources', label: props.t('stateSources.tab') },
        { id: 'authoring', label: props.t('stateAuthoring.tab') },
        { id: 'state', label: props.t('stateVariables.title') },
      ]}
      onChange={props.onViewChange}
    />
  )

  return (
    <div data-loom-mobile-tab-scope="" className={styles.panel}>
      <MobileTabPages activeId={props.variableView} onChange={props.onViewChange} header={tabs} pages={[{ id: 'sources', content: (
        <StateSourcesPanel
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          api={props.statesApi}
          card={props.card}
          timelineTarget={props.timelineTarget}
          refreshToken={`${props.refreshToken ?? ''}:${props.sourceRefreshToken ?? ''}`}
          t={props.t}
        />
      ) }, { id: 'authoring', content: (
        <StateAuthoringPanel
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          card={props.card}
          t={props.t}
          onSaveCard={props.onSaveCard}
        />
      ) }, { id: 'state', content: (
        <StateVariablesPanel
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          api={props.statesApi}
          t={props.t}
          canOpenTimelineSource={props.hasTimeline}
          onOpenSource={props.onOpenSource}
          refreshToken={props.refreshToken}
          timelineTarget={props.timelineTarget}
          focusPath={props.focusPath}
          onStateMutated={props.onStateMutated}
        />
      ) }]} />
    </div>
  )
}
