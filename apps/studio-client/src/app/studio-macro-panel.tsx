import { MobileTabPages } from '../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import { useWorkbenchView } from '../shared/studio-shell/use-workbench-view.js'
import { type ReactNode } from 'react'
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
  const [activeTab, setActiveTab] = useWorkbenchView<MacroView>('macro.tab', 'authoring', ['authoring', 'preview'])

  const tabs = (
    <PanelTabs<MacroView>
      activeId={activeTab}
      ariaLabel={props.t('rail.macro')}
      items={[
        { id: 'authoring', label: props.t('context.authoring.macros') },
        { id: 'preview', label: props.t('macroInspector.preview') },
      ]}
      onChange={setActiveTab}
    />
  )

  return (
    <div data-loom-mobile-tab-scope="" className={styles.panel}>
      <MobileTabPages<MacroView> activeId={activeTab} onChange={setActiveTab} header={tabs} pages={[{ id: 'authoring', content: (
        <MacroAuthoringWorkbench
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          sources={props.sources}
          t={props.t}
        />
      ) }, { id: 'preview', content: (
        <MacroInspectorPanel
          key={props.macroTargetKey}
          header={<div data-mobile-tab-inline-header="">{tabs}</div>}
          inspection={props.macroInspection}
          loading={props.macroInspectionLoading}
          error={props.macroInspectionError}
          selections={props.macroSelections}
          onSelectSource={props.onSelectSource}
          onRefresh={props.onRefresh}
          t={props.t}
          hideHeader={true}
        />
      ) }]} />
    </div>
  )
}
