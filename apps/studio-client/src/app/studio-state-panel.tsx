import type { ReactNode } from 'react'
import { MacroInspectorPanel } from '../features/state-variables/ui/macro-inspector-panel.js'
import { StateAuthoringPanel } from '../features/state-variables/ui/state-authoring-panel.js'
import { StateVariablesPanel } from '../features/state-variables/ui/state-variables-panel.js'
import type { Translator } from '../shared/i18n/index.js'

type StudioStatePanelProps = {
  hasTimeline: boolean
  variableView: 'state' | 'authoring' | 'preview' | 'build'
  macroTargetKey: string
  macroInspection: Parameters<typeof MacroInspectorPanel>[0]['inspection']
  buildMacroInspection: Parameters<typeof MacroInspectorPanel>[0]['inspection']
  macroInspectionLoading: boolean
  macroInspectionError?: string
  macroSelections: Parameters<typeof MacroInspectorPanel>[0]['selections']
  card?: Parameters<typeof StateAuthoringPanel>[0]['card']
  statesApi: Parameters<typeof StateVariablesPanel>[0]['api']
  timelineTarget?: Parameters<typeof StateVariablesPanel>[0]['timelineTarget']
  refreshToken?: string
  t: Translator
  onSaveCard: Parameters<typeof StateAuthoringPanel>[0]['onSaveCard']
  onOpenSource: (scope: 'global' | 'timeline') => void
  onViewChange: (view: StudioStatePanelProps['variableView']) => void
  onStateMutated: Parameters<typeof StateVariablesPanel>[0]['onStateMutated']
  onSelectSource: Parameters<typeof MacroInspectorPanel>[0]['onSelectSource']
  onRefresh: Parameters<typeof MacroInspectorPanel>[0]['onRefresh']
}

export function StudioStatePanel(props: StudioStatePanelProps): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {(props.variableView === 'state' || props.variableView === 'authoring') && !props.hasTimeline ? (
          <p>{props.t('stateVariables.noTimeline')}</p>
        ) : props.variableView === 'authoring' ? (
          <StateAuthoringPanel card={props.card} t={props.t} onSaveCard={props.onSaveCard} />
        ) : props.variableView === 'state' ? (
          <StateVariablesPanel
            api={props.statesApi}
            t={props.t}
            canOpenTimelineSource={props.hasTimeline}
            onOpenSource={props.onOpenSource}
            refreshToken={props.refreshToken}
            timelineTarget={props.timelineTarget}
            onStateMutated={props.onStateMutated}
          />
        ) : (
          <MacroInspectorPanel
            key={`${props.macroTargetKey}:${props.variableView}`}
            inspection={props.variableView === 'preview' ? props.macroInspection : props.buildMacroInspection}
            loading={props.variableView === 'preview' && props.macroInspectionLoading}
            error={props.variableView === 'preview' ? props.macroInspectionError : undefined}
            selections={props.variableView === 'preview' ? props.macroSelections : {}}
            onSelectSource={props.onSelectSource}
            onRefresh={props.onRefresh}
            readOnly={props.variableView === 'build'}
            t={props.t}
          />
        )}
      </div>
      <div className="loom-page-tabs loom-page-tabs-footer" role="tablist">
        {(['state', 'authoring', 'preview', 'build'] as const).map(view => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={props.variableView === view}
            className={`loom-page-tab${props.variableView === view ? ' loom-page-tab-active' : ''}`}
            onClick={() => props.onViewChange(view)}
          >
            {view === 'state' ? 'State' : view === 'authoring' ? props.t('stateAuthoring.tab') : props.t(`macroInspector.${view}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
