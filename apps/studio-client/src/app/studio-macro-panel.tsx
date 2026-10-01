import { useState, type ReactNode } from 'react'
import { MacroAuthoringWorkbench } from '../features/state-variables/ui/macro-authoring-panel.js'
import { MacroInspectorPanel } from '../features/state-variables/ui/macro-inspector-panel.js'
import type { Translator } from '../shared/i18n/index.js'
import { PanelTabs } from '../shared/ui/panel-tabs/index.js'
import styles from './studio-state-panel.module.scss'

export type MacroView = 'authoring' | 'preview'

export type StudioMacroPanelProps = {
  macroTargetKey: string
  macroInspection: Parameters<typeof MacroInspectorPanel>[0]['inspection']
  macroInspectionLoading: boolean
  macroInspectionError?: string
  macroSelections: Parameters<typeof MacroInspectorPanel>[0]['selections']
  sources: import('../features/state-variables/ui/macro-authoring-panel.js').MacroAuthoringSource[]
  t: Translator
  onSelectSource: Parameters<typeof MacroInspectorPanel>[0]['onSelectSource']
  onRefresh: Parameters<typeof MacroInspectorPanel>[0]['onRefresh']
}

export function StudioMacroPanel(props: StudioMacroPanelProps): ReactNode {
  const [activeTab, setActiveTab] = useState<MacroView>('authoring')

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <PanelTabs<MacroView>
          activeId={activeTab}
          ariaLabel={props.t('rail.macro')}
          items={[
            { id: 'authoring', label: props.t('context.authoring.macros') },
            { id: 'preview', label: props.t('macroInspector.preview') },
          ]}
          onChange={setActiveTab}
        />
      </header>
      <div className={styles.content}>
        {activeTab === 'authoring' ? (
          <MacroAuthoringWorkbench
            sources={props.sources}
            t={props.t}
          />
        ) : (
          <MacroInspectorPanel
            key={`${props.macroTargetKey}:${activeTab}`}
            inspection={props.macroInspection}
            loading={props.macroInspectionLoading}
            error={props.macroInspectionError}
            selections={props.macroSelections}
            onSelectSource={props.onSelectSource}
            onRefresh={props.onRefresh}
            t={props.t}
          />
        )}
      </div>
    </div>
  )
}
